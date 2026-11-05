// SPDX-License-Identifier: AGPL-3.0-only
import { basename } from "node:path";
import { readFile } from "node:fs/promises";

import { AinobiCliError } from "./errors.ts";
import { extensionFromPath, isDocReadImageExtension } from "./doc-extensions.ts";
import type { ReplicateImageToHtmlResult } from "./image-replicate-html.ts";
import type { OutputOptions } from "./output.ts";
import { isImageReplicateHostFlush } from "./runtime.ts";
import { cliEnv } from "./env.ts";

export type HostImageReplicateHttpResult = {
  ok: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
};

const imageReplicateHostEndpoint = (): string => {
  const raw = cliEnv().AINOBI_IMAGE_REPLICATE_HOST_URL?.trim();
  if (!raw) {
    throw new AinobiCliError(
      "USAGE",
      "Agent image replicate-html requires `AINOBI_IMAGE_REPLICATE_HOST_URL` (set by the AINOBI host).",
      {
        hint:
          "Run `ainobi image replicate-html` from the courseware agent chat environment, or configure the host to inject the image replicate URL.",
      },
    );
  }
  return raw.replace(/\/$/, "");
};

const imageReplicateHostTimeoutMs = (): number => {
  const parsed = Number(cliEnv().AINOBI_IMAGE_REPLICATE_HOST_TIMEOUT_MS ?? 300_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
};

const uploadAuthHeaders = (): Record<string, string> => {
  const key = cliEnv().AINOBI_AGENT_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
};

const parseHostImageReplicateResponse = async (
  response: Response,
  url: string,
): Promise<HostImageReplicateHttpResult> => {
  const text = await response.text();
  let parsed: HostImageReplicateHttpResult & { error?: string };
  try {
    parsed = JSON.parse(text) as HostImageReplicateHttpResult & { error?: string };
  } catch {
    throw new AinobiCliError(
      "IO_ERROR",
      `Image replicate host returned non-JSON (HTTP ${response.status}).`,
      { hint: `POST ${url}` },
    );
  }

  if (!response.ok) {
    throw new AinobiCliError(
      "IO_ERROR",
      (parsed.error ?? parsed.stderr?.trim()) || `Image replicate host failed (HTTP ${response.status}).`,
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

export type ImageReplicateViaHostRequest = {
  source_path: string;
  absolute_path: string;
  llm_prompt?: string;
  pretty?: boolean;
};

export const runImageReplicateViaHost = async (
  request: ImageReplicateViaHostRequest,
  output: OutputOptions,
): Promise<ReplicateImageToHtmlResult & { source_path: string }> => {
  if (!isImageReplicateHostFlush()) {
    throw new AinobiCliError("INTERNAL", "runImageReplicateViaHost called without host flush enabled.");
  }

  const extension = extensionFromPath(request.absolute_path);
  if (!isDocReadImageExtension(extension)) {
    throw new AinobiCliError("USAGE", `Unsupported image type "${extension}".`, {
      hint: "See `ainobi help image` for supported extensions.",
    });
  }

  const buffer = await readFile(request.absolute_path);
  const endpoint = imageReplicateHostEndpoint();
  const form = new FormData();
  form.append("file", new Blob([buffer]), basename(request.absolute_path));
  form.append("file_extension", extension);
  if (request.llm_prompt?.trim()) {
    form.append("llm_prompt", request.llm_prompt.trim());
  }
  if (output.pretty === false) {
    form.append("pretty", "false");
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...uploadAuthHeaders(),
        accept: "application/json",
      },
      body: form,
      signal: AbortSignal.timeout(imageReplicateHostTimeoutMs()),
    });
  } catch (error) {
    throw new AinobiCliError(
      "IO_ERROR",
      `Image replicate host request failed: ${error instanceof Error ? error.message : String(error)}`,
      { hint: `POST ${endpoint}. Ensure the courseware agent service is running.` },
    );
  }

  const result = await parseHostImageReplicateResponse(response, endpoint);
  if (!result.ok) {
    if (result.stderr) {
      process.stderr.write(result.stderr.endsWith("\n") ? result.stderr : `${result.stderr}\n`);
    }
    process.exitCode = result.exit_code || 1;
    throw new AinobiCliError("IO_ERROR", "Image replicate host returned a failure.", {
      hint: result.stderr?.trim() || undefined,
    });
  }

  let envelope: { ok?: boolean; data?: ReplicateImageToHtmlResult & { source_path?: string } };
  try {
    envelope = JSON.parse(result.stdout.trim()) as typeof envelope;
  } catch {
    throw new AinobiCliError("IO_ERROR", "Image replicate host stdout was not valid JSON.");
  }

  const data = envelope.data;
  if (!data?.html) {
    throw new AinobiCliError("IO_ERROR", "Image replicate host response missing html.");
  }

  return {
    source_path: request.source_path,
    html: data.html,
    model: data.model,
    prompt_chars: data.prompt_chars,
  };
};
