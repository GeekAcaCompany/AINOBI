// SPDX-License-Identifier: AGPL-3.0-only
import { AinobiCliError } from "./errors.ts";
import type { OutputOptions } from "./output.ts";
import { isSearchHostFlush } from "./runtime.ts";
import { cliEnv } from "./env.ts";
import type { TavilySearchRequest } from "./tavily-types.ts";

export type HostSearchHttpResult = {
  ok: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
};

const searchHostEndpoint = (): string => {
  const raw = cliEnv().AINOBI_SEARCH_HOST_URL?.trim();
  if (!raw) {
    throw new AinobiCliError(
      "USAGE",
      "Agent search requires `AINOBI_SEARCH_HOST_URL` (set by the AINOBI host).",
      {
        hint:
          "Run `ainobi search` from the courseware agent chat environment, or configure the host to inject the search URL.",
      },
    );
  }
  return raw.replace(/\/$/, "");
};

const searchHostTimeoutMs = (): number => {
  const parsed = Number(cliEnv().AINOBI_SEARCH_HOST_TIMEOUT_MS ?? 120_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
};

const uploadAuthHeaders = (): Record<string, string> => {
  const key = cliEnv().AINOBI_AGENT_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
};

const parseHostSearchResponse = async (
  response: Response,
  url: string,
): Promise<HostSearchHttpResult> => {
  const text = await response.text();
  let parsed: HostSearchHttpResult & { error?: string };
  try {
    parsed = JSON.parse(text) as HostSearchHttpResult & { error?: string };
  } catch {
    throw new AinobiCliError(
      "IO_ERROR",
      `Search host returned non-JSON (HTTP ${response.status}).`,
      { hint: `POST ${url}` },
    );
  }

  if (!response.ok) {
    throw new AinobiCliError(
      "IO_ERROR",
      (parsed.error ?? parsed.stderr?.trim()) || `Search host failed (HTTP ${response.status}).`,
      { hint: `POST ${url}` },
    );
  }

  return {
    ok: parsed.ok !== false,
    exit_code: typeof parsed.exit_code === "number" ? parsed.exit_code : parsed.ok === false ? 1 : 0,
    stdout: parsed.stdout ?? "",
    stderr: parsed.stderr ?? "",
  };
};

export const runSearchViaHost = async (
  request: TavilySearchRequest,
  output: OutputOptions,
): Promise<void> => {
  if (!isSearchHostFlush()) {
    throw new AinobiCliError("INTERNAL", "runSearchViaHost called without host flush enabled.");
  }

  const endpoint = searchHostEndpoint();
  const body = {
    ...request,
    pretty: output.pretty,
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
      signal: AbortSignal.timeout(searchHostTimeoutMs()),
    });
  } catch (error) {
    throw new AinobiCliError(
      "IO_ERROR",
      `Search host request failed: ${error instanceof Error ? error.message : String(error)}`,
      {
        hint: `POST ${endpoint}. Ensure the courseware agent service is running.`,
      },
    );
  }

  const result = await parseHostSearchResponse(response, endpoint);
  if (result.stdout) {
    process.stdout.write(result.stdout.endsWith("\n") ? result.stdout : `${result.stdout}\n`);
  }
  if (!result.ok) {
    if (result.stderr) {
      process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);
    }
    process.exitCode = result.exit_code || 1;
  }
};
