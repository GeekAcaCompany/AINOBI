// SPDX-License-Identifier: AGPL-3.0-only
import { basename, dirname, resolve } from "node:path";

import { AinobiCliError, type CliErrorCode, type CliIssue } from "./errors.ts";
import type { OutputOptions } from "./output.ts";
import { isNarrationHostFlush } from "./runtime.ts";
import { cliEnv } from "./env.ts";

/** @deprecated File-queue subdir; host flush now uses HTTP. */
export const PENDING_NARRATION_SUBDIR = "pending-narration";

export type HostNarrationHttpResult = {
  ok: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
};

/** Reverse of `cli/index.ts` exitMap — keep host flush failures semantically accurate. */
const EXIT_CODE_TO_CLI_ERROR: Record<number, CliErrorCode> = {
  1: "INTERNAL",
  2: "USAGE",
  3: "NOT_LOADED",
  4: "NOT_FOUND",
  5: "VALIDATION_ERROR",
  6: "INVALID_INPUT",
  7: "IO_ERROR",
  8: "UNSUPPORTED",
  9: "ALREADY_LOADED",
};

const KNOWN_CLI_ERROR_CODES = new Set<string>(Object.values(EXIT_CODE_TO_CLI_ERROR));

const isHostNarrationRunPayload = (
  parsed: Record<string, unknown>,
): boolean =>
  typeof parsed.exit_code === "number" ||
  typeof parsed.stdout === "string" ||
  typeof parsed.stderr === "string";

/**
 * Recover the original CLI error from host stdout/stderr (JSON envelope) or exit code.
 * Avoids flattening every host failure to IO_ERROR (exit 7).
 */
type ParsedCliErrorEnvelope = {
  ok?: boolean;
  error?: {
    code?: string;
    message?: string;
    hint?: string;
    issues?: CliIssue[];
  };
};

/**
 * Extract the CLI error envelope from a host stream. Diagnostic lines (e.g. the
 * `[tts] japanese kana rewrite …` log) may precede the envelope on stderr, so when the
 * whole blob is not JSON, try every suffix that starts at a line beginning with `{`,
 * last candidate first (the envelope is always written last).
 */
const parseCliErrorEnvelope = (blob: string): ParsedCliErrorEnvelope | null => {
  const starts: number[] = [0];
  const lineStart = /^\{/gm;
  let match: RegExpExecArray | null;
  while ((match = lineStart.exec(blob)) !== null) {
    if (match.index !== 0) starts.push(match.index);
  }
  for (const start of starts.reverse()) {
    try {
      return JSON.parse(blob.slice(start)) as ParsedCliErrorEnvelope;
    } catch {
      // keep scanning earlier candidates
    }
  }
  return null;
};

export const ainobiCliErrorFromHostNarrationFailure = (
  result: HostNarrationHttpResult,
  options: { hint?: string } = {},
): AinobiCliError => {
  const fallbackHint =
    options.hint ??
    "Inspect the host narration response (stderr/stdout) for the underlying CLI error.";
  const blobs = [result.stderr, result.stdout]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean);

  for (const blob of blobs) {
    const parsed = parseCliErrorEnvelope(blob);
    if (!parsed) continue;
    const code = parsed.error?.code?.trim();
    const message = parsed.error?.message?.trim();
    if (parsed.ok === false && code && message && KNOWN_CLI_ERROR_CODES.has(code)) {
      return new AinobiCliError(code as CliErrorCode, message, {
        hint: parsed.error?.hint?.trim() || fallbackHint,
        issues: Array.isArray(parsed.error?.issues) ? parsed.error.issues : [],
      });
    }
  }

  const mapped = EXIT_CODE_TO_CLI_ERROR[result.exit_code];
  const message =
    blobs[0] ||
    `Narration host run failed (exit ${result.exit_code || 1}).`;
  return new AinobiCliError(mapped ?? "IO_ERROR", message, { hint: fallbackHint });
};

const narrationHostEndpoint = (): string => {
  const raw = cliEnv().AINOBI_NARRATION_HOST_URL?.trim();
  if (!raw) {
    throw new AinobiCliError(
      "USAGE",
      "Agent narration requires `AINOBI_NARRATION_HOST_URL` (set by the AINOBI host).",
      {
        hint:
          "Run `ainobi narration insert` from the courseware agent chat environment, or configure the host to inject the narration URL.",
      },
    );
  }
  return raw.replace(/\/$/, "");
};

const narrationHostTimeoutMs = (): number => {
  const parsed = Number(cliEnv().AINOBI_NARRATION_HOST_TIMEOUT_MS ?? 600_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 600_000;
};

const uploadAuthHeaders = (): Record<string, string> => {
  const key = cliEnv().AINOBI_AGENT_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
};

const narrationArgvFromProcess = (): string[] => {
  const idx = process.argv.findIndex((arg, i) => i > 1 && arg === "narration");
  if (idx < 0) {
    return ["narration", "insert"];
  }
  return process.argv.slice(idx);
};

/** Parent of `.ainobi-cli` (agent workspace cwd). Must use dirname/resolve — join(...split) drops a leading `/`. */
export const workspaceDirFromStateDir = (stateDir: string): string => {
  const resolved = resolve(stateDir.trim());
  if (basename(resolved) === ".ainobi-cli") {
    return dirname(resolved);
  }
  return resolved;
};

const parseHostNarrationResponse = async (
  response: Response,
  url: string,
): Promise<HostNarrationHttpResult> => {
  const text = await response.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new AinobiCliError(
      "IO_ERROR",
      `Narration host returned non-JSON (HTTP ${response.status}).`,
      { hint: `POST ${url}` },
    );
  }

  // Host returns HTTP 502 with { ok, exit_code, stdout, stderr } when the CLI
  // subprocess fails — treat that as a structured run result, not transport IO.
  if (isHostNarrationRunPayload(parsed)) {
    return {
      ok: parsed.ok !== false,
      exit_code:
        typeof parsed.exit_code === "number"
          ? parsed.exit_code
          : parsed.ok === false
            ? 1
            : 0,
      stdout: typeof parsed.stdout === "string" ? parsed.stdout : "",
      stderr: typeof parsed.stderr === "string" ? parsed.stderr : "",
    };
  }

  if (!response.ok || parsed.ok === false) {
    const errorMessage =
      typeof parsed.error === "string"
        ? parsed.error
        : `Narration host failed (HTTP ${response.status}).`;
    throw new AinobiCliError("IO_ERROR", errorMessage, { hint: `POST ${url}` });
  }

  return {
    ok: true,
    exit_code: 0,
    stdout: "",
    stderr: "",
  };
};

export const runNarrationInsertViaHost = async (output: OutputOptions): Promise<void> => {
  if (!isNarrationHostFlush()) {
    throw new AinobiCliError("INTERNAL", "runNarrationInsertViaHost called without host flush enabled.");
  }

  const stateDir = cliEnv().AINOBI_STATE_DIR?.trim();
  if (!stateDir) {
    throw new AinobiCliError("USAGE", "Narration host flush requires `AINOBI_STATE_DIR`.");
  }

  const endpoint = narrationHostEndpoint();
  const body = {
    workspace_dir: workspaceDirFromStateDir(stateDir),
    state_dir: stateDir,
    argv: narrationArgvFromProcess(),
    pretty: output.pretty,
    shell_session: cliEnv().AINOBI_SHELL_SESSION?.trim() || undefined,
    session_id: cliEnv().AINOBI_SESSION?.trim() || undefined,
    courseware_org_id: cliEnv().AINOBI_COURSEWARE_ORG_ID?.trim() || undefined,
    conversation_id: cliEnv().AINOBI_CONVERSATION_ID?.trim() || undefined,
  };

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...uploadAuthHeaders(),
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(narrationHostTimeoutMs()),
    });
  } catch (error) {
    throw new AinobiCliError(
      "IO_ERROR",
      `Narration host request failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        hint: `POST ${endpoint}. Ensure the courseware agent service is running.`,
      },
    );
  }

  const result = await parseHostNarrationResponse(response, endpoint);
  const stdout = result.stdout?.trim() ?? "";
  const stderr = result.stderr?.trim() ?? "";
  if (stdout) {
    process.stdout.write(stdout.endsWith("\n") ? stdout : `${stdout}\n`);
  } else if (!result.ok && stderr) {
    process.stdout.write(`${stderr}\n`);
  }
  if (stderr && (!stdout || stderr !== stdout)) {
    process.stderr.write(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
  }
  if (!result.ok) {
    throw ainobiCliErrorFromHostNarrationFailure(result, {
      hint: `POST ${endpoint}. Inspect host logs for TTS/OSS errors.`,
    });
  }
  if (!stdout) {
    throw new AinobiCliError(
      "IO_ERROR",
      "Narration host returned success with empty stdout.",
      {
        hint:
          "The host subprocess may have exited before writing JSON. Check TTS credentials and OSS env on the host, and yarn dev logs for [narration] host TTS/OSS.",
      },
    );
  }
};
