// SPDX-License-Identifier: AGPL-3.0-only
import { AinobiCliError } from "./errors.ts";
import { cliEnv } from "./env.ts";
import { isImageGenerateHostFlush } from "./runtime.ts";

export type HostGeneratedImageAsset = {
  fileId: string;
  fileName: string;
  fileUrl: string;
  filePath: string;
  contentType: string;
  fileSize: number;
};

export type ImageGenerateViaHostResult = {
  asset: HostGeneratedImageAsset;
  model: string;
  size: string;
  quality: string;
};

export type ImageGenerateViaHostRequest = {
  prompt: string;
  size?: string;
  quality?: string;
  file_name?: string;
  courseware_id?: string;
  courseware_org_id?: string;
  conversation_id?: string;
};

const imageGenerateHostEndpoint = (): string => {
  const raw = cliEnv().AINOBI_IMAGE_GENERATE_HOST_URL?.trim();
  if (!raw) {
    throw new AinobiCliError(
      "USAGE",
      "Agent image generate requires `AINOBI_IMAGE_GENERATE_HOST_URL` (set by the AINOBI host).",
      {
        hint:
          "Run `ainobi image generate` from the courseware agent chat environment, or configure the host to inject the image generate URL.",
      },
    );
  }
  return raw.replace(/\/$/, "");
};

const imageGenerateHostTimeoutMs = (): number => {
  const parsed = Number(cliEnv().AINOBI_IMAGE_GENERATE_HOST_TIMEOUT_MS ?? 300_000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300_000;
};

const uploadAuthHeaders = (): Record<string, string> => {
  const key = cliEnv().AINOBI_AGENT_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
};

const resolveCoursewareId = (request: ImageGenerateViaHostRequest): string => {
  const fromRequest = request.courseware_id?.trim();
  if (fromRequest) return fromRequest;
  const fromEnv = cliEnv().AINOBI_COURSEWARE_ID?.trim();
  if (fromEnv) return fromEnv;
  throw new AinobiCliError(
    "USAGE",
    "Image generate requires a courseware context (AINOBI_COURSEWARE_ID is not set).",
  );
};

/**
 * The agent sandbox delegates to the host's `/courseware/image/generate`: image generation + saving as a courseware asset + billing.
 */
export const runImageGenerateViaHost = async (
  request: ImageGenerateViaHostRequest,
): Promise<ImageGenerateViaHostResult> => {
  if (!isImageGenerateHostFlush()) {
    throw new AinobiCliError("INTERNAL", "runImageGenerateViaHost called without host flush enabled.");
  }

  const coursewareId = resolveCoursewareId(request);
  const orgId = request.courseware_org_id?.trim() || cliEnv().AINOBI_COURSEWARE_ORG_ID?.trim();
  const endpoint = imageGenerateHostEndpoint();

  const body = {
    prompt: request.prompt,
    ...(request.size?.trim() ? { size: request.size.trim() } : {}),
    ...(request.quality?.trim() ? { quality: request.quality.trim() } : {}),
    ...(request.file_name?.trim() ? { file_name: request.file_name.trim() } : {}),
    courseware_id: coursewareId,
    ...(orgId ? { courseware_org_id: orgId } : {}),
    ...(request.conversation_id?.trim() ? { conversation_id: request.conversation_id.trim() } : {}),
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
      signal: AbortSignal.timeout(imageGenerateHostTimeoutMs()),
    });
  } catch (error) {
    throw new AinobiCliError(
      "IO_ERROR",
      `Image generate host request failed: ${error instanceof Error ? error.message : String(error)}`,
      { hint: `POST ${endpoint}. Ensure the courseware agent service is running.` },
    );
  }

  const text = await response.text();
  let parsed: {
    ok?: boolean;
    error?: string;
    data?: {
      asset?: HostGeneratedImageAsset;
      model?: string;
      size?: string;
      quality?: string;
    };
  };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new AinobiCliError(
      "IO_ERROR",
      `Image generate host returned non-JSON (HTTP ${response.status}).`,
      { hint: `POST ${endpoint}` },
    );
  }

  if (!response.ok || parsed.ok === false || !parsed.data?.asset?.fileUrl) {
    throw new AinobiCliError(
      "IO_ERROR",
      parsed.error?.trim() || `Image generate host failed (HTTP ${response.status}).`,
      { hint: `POST ${endpoint}` },
    );
  }

  const asset = parsed.data.asset;
  return {
    asset,
    model: parsed.data.model ?? "gpt-image-2",
    size: parsed.data.size ?? "auto",
    quality: parsed.data.quality ?? "auto",
  };
};
