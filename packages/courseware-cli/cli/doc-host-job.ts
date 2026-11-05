// SPDX-License-Identifier: AGPL-3.0-only
import { basename } from "node:path";
import { readFile } from "node:fs/promises";

import { AinobiCliError } from "./errors.ts";
import type { OutputOptions } from "./output.ts";
import { extensionFromPath, isDocReadExtensionSupported } from "./doc-extensions.ts";
import { isDocHostFlush } from "./runtime.ts";
import type { ConvertBufferToMarkdownResult } from "./markitdown-convert.ts";
import { cliEnv } from "./env.ts";

export type HostDocReadHttpResult = {
  ok: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
};

const docHostEndpoint = (): string => {
  const raw = cliEnv().AINOBI_DOC_HOST_URL?.trim();
  if (!raw) {
    throw new AinobiCliError(
      "USAGE",
      "Agent document read requires `AINOBI_DOC_HOST_URL` (set by the AINOBI host).",
      {
        hint:
          "Run `ainobi doc read` from the courseware agent chat environment, or configure the host to inject the doc read URL.",
      },
    );
  }
  return raw.replace(/\/$/, "");
};

const docHostTimeoutMs = (): number => {
  const parsed = Number(cliEnv().AINOBI_DOC_HOST_TIMEOUT_MS ?? 300_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
};

const uploadAuthHeaders = (): Record<string, string> => {
  const key = cliEnv().AINOBI_AGENT_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
};

const parseHostDocReadResponse = async (
  response: Response,
  url: string,
): Promise<HostDocReadHttpResult> => {
  const text = await response.text();
  let parsed: HostDocReadHttpResult & { error?: string };
  try {
    parsed = JSON.parse(text) as HostDocReadHttpResult & { error?: string };
  } catch {
    throw new AinobiCliError(
      "IO_ERROR",
      `Document read host returned non-JSON (HTTP ${response.status}).`,
      { hint: `POST ${url}` },
    );
  }

  if (!response.ok) {
    throw new AinobiCliError(
      "IO_ERROR",
      (parsed.error ?? parsed.stderr?.trim()) || `Document read host failed (HTTP ${response.status}).`,
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

export type DocReadViaHostRequest = {
  source_path: string;
  absolute_path?: string;
  /** When set, host loads the courseware asset from OSS/S3 (no local file upload). */
  file_id?: string;
  courseware_id?: string;
  llm_prompt?: string;
  no_llm?: boolean;
  pretty?: boolean;
};

export const runDocReadViaHost = async (
  request: DocReadViaHostRequest,
  output: OutputOptions,
): Promise<ConvertBufferToMarkdownResult & { source_path: string }> => {
  if (!isDocHostFlush()) {
    throw new AinobiCliError("INTERNAL", "runDocReadViaHost called without host flush enabled.");
  }

  const fileId = request.file_id?.trim();
  const endpoint = docHostEndpoint();

  let response: Response;
  try {
    if (fileId) {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          ...uploadAuthHeaders(),
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          file_id: fileId,
          ...(request.courseware_id?.trim()
            ? { courseware_id: request.courseware_id.trim() }
            : {}),
          ...(request.llm_prompt?.trim() ? { llm_prompt: request.llm_prompt.trim() } : {}),
          ...(request.no_llm ? { no_llm: true } : {}),
          pretty: output.pretty !== false,
        }),
        signal: AbortSignal.timeout(docHostTimeoutMs()),
      });
    } else {
      const absolutePath = request.absolute_path?.trim();
      if (!absolutePath) {
        throw new AinobiCliError("USAGE", "doc read via host requires a local path or --file-id.");
      }
      const extension = extensionFromPath(absolutePath);
      if (!isDocReadExtensionSupported(extension)) {
        throw new AinobiCliError("USAGE", `Unsupported file type "${extension}".`, {
          hint: "See `ainobi help doc` for supported extensions.",
        });
      }

      const buffer = await readFile(absolutePath);
      const form = new FormData();
      form.append("file", new Blob([buffer]), basename(absolutePath));
      form.append("file_extension", extension);
      if (request.llm_prompt?.trim()) {
        form.append("llm_prompt", request.llm_prompt.trim());
      }
      if (request.no_llm) {
        form.append("no_llm", "1");
      }
      if (output.pretty === false) {
        form.append("pretty", "false");
      }

      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          ...uploadAuthHeaders(),
          accept: "application/json",
        },
        body: form,
        signal: AbortSignal.timeout(docHostTimeoutMs()),
      });
    }
  } catch (error) {
    if (error instanceof AinobiCliError) throw error;
    throw new AinobiCliError(
      "IO_ERROR",
      `Document read host request failed: ${error instanceof Error ? error.message : String(error)}`,
      { hint: `POST ${endpoint}. Ensure the courseware agent service is running.` },
    );
  }

  const result = await parseHostDocReadResponse(response, endpoint);
  if (!result.ok) {
    if (result.stderr) {
      process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);
    }
    process.exitCode = result.exit_code || 1;
    throw new AinobiCliError("IO_ERROR", "Document read host returned a failure.", {
      hint: result.stderr?.trim() || undefined,
    });
  }

  let envelope: { ok?: boolean; data?: ConvertBufferToMarkdownResult & { source_path?: string } };
  try {
    envelope = JSON.parse(result.stdout.trim()) as typeof envelope;
  } catch {
    throw new AinobiCliError("IO_ERROR", "Document read host stdout was not valid JSON.");
  }

  const data = envelope.data;
  if (!data?.markdown) {
    throw new AinobiCliError("IO_ERROR", "Document read host response missing markdown.");
  }

  return {
    source_path: data.source_path ?? request.source_path,
    title: data.title ?? null,
    markdown: data.markdown,
    llm_used: Boolean(data.llm_used),
  };
};
