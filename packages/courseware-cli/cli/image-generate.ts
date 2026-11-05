// SPDX-License-Identifier: AGPL-3.0-only
import { createOpenAiClient, readOpenAiEnvConfig } from "./openai-client.ts";
import { cliEnv } from "./env.ts";

/** OpenAI's latest image generation model (override with OPENAI_IMAGE_MODEL). */
export const DEFAULT_IMAGE_MODEL = "gpt-image-2.5-sunburst";

/** Common gpt-image-2 size presets; `auto` and custom `WxH` are accepted too. */
const KNOWN_IMAGE_SIZES = new Set([
  "auto",
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "2048x2048",
  "2048x1152",
  "1152x2048",
]);

const KNOWN_IMAGE_QUALITIES = new Set(["auto", "low", "medium", "high"]);

export type GenerateImageOptions = {
  prompt: string;
  /** Size: auto / 1024x1024 / 1536x1024 / 1024x1536 / custom WxH. */
  size?: string;
  /** Quality: auto / low / medium / high. */
  quality?: string;
};

export type GeneratedImageUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type GeneratedImageResult = {
  /** Base64 of the PNG image (without the data: prefix). */
  base64: string;
  mimeType: string;
  extension: string;
  model: string;
  size: string;
  quality: string;
  usage: GeneratedImageUsage;
};

export const resolveImageModel = (): string =>
  cliEnv().OPENAI_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;

export const normalizeImageSize = (raw?: string): string => {
  const value = raw?.trim().toLowerCase();
  if (!value || value === "auto") {
    return "auto";
  }
  if (KNOWN_IMAGE_SIZES.has(value)) {
    return value;
  }
  // gpt-image-2 supports any WxH (multiples of 16, aspect ratio 1:3 to 3:1); only the format is checked here.
  if (/^\d{2,4}x\d{2,4}$/.test(value)) {
    return value;
  }
  throw new Error(
    `Unsupported image size "${raw}". Use auto, 1024x1024, 1536x1024, 1024x1536, or a custom WxH.`,
  );
};

export const normalizeImageQuality = (raw?: string): string => {
  const value = raw?.trim().toLowerCase();
  if (!value) {
    return "auto";
  }
  if (KNOWN_IMAGE_QUALITIES.has(value)) {
    return value;
  }
  throw new Error(`Unsupported image quality "${raw}". Use auto, low, medium, or high.`);
};

type OpenAiImageUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

type OpenAiImagesResponse = {
  data?: Array<{ b64_json?: string }>;
  usage?: OpenAiImageUsage;
};

/**
 * Generate one image from a text prompt with the OpenAI Images API (gpt-image-2).
 * GPT Image models always return base64 (`data[].b64_json`).
 */
export const generateImageWithOpenAi = async (
  options: GenerateImageOptions,
): Promise<GeneratedImageResult> => {
  const prompt = options.prompt?.trim();
  if (!prompt) {
    throw new Error("Image generation prompt is required.");
  }

  const config = readOpenAiEnvConfig();
  if (!config) {
    throw new Error(
      "Image generation requires OPENAI_API_KEY (and optional OPENAI_API_BASE, OPENAI_IMAGE_MODEL) on the host.",
    );
  }

  const model = resolveImageModel();
  const size = normalizeImageSize(options.size);
  const quality = normalizeImageQuality(options.quality);
  const client = createOpenAiClient(config);

  const response = (await client.images.generate({
    model,
    prompt,
    ...(size !== "auto" ? { size } : {}),
    ...(quality !== "auto" ? { quality } : {}),
  } as Parameters<typeof client.images.generate>[0])) as OpenAiImagesResponse;

  const first = Array.isArray(response.data) ? response.data[0] : undefined;
  const base64 = first?.b64_json;
  if (!base64) {
    throw new Error("Image model returned no image data (missing b64_json).");
  }

  const usage = response.usage;
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  const totalTokens = usage?.total_tokens ?? inputTokens + outputTokens;

  return {
    base64,
    mimeType: "image/png",
    extension: ".png",
    model,
    size,
    quality,
    usage: { inputTokens, outputTokens, totalTokens },
  };
};
