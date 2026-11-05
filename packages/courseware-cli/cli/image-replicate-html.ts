// SPDX-License-Identifier: AGPL-3.0-only
import { isDocReadImageExtension, normalizeDocReadExtension } from "./doc-extensions.ts";
import { createOpenAiClient, readOpenAiEnvConfig } from "./openai-client.ts";

const DEFAULT_REPLICATE_HTML_PROMPT = `You are a front-end engineer recreating a reference image as standalone HTML for an educational courseware slide.

Requirements:
- Output ONLY valid HTML (no markdown fences, no commentary). Prefer starting with <!DOCTYPE html> and a single clear root wrapper.
- Match layout, typography, colors, spacing, borders, icons, charts, and all readable text as closely as possible.
- Use inline CSS and/or one <style> block in <head>; no external stylesheets, fonts, or images (use CSS/SVG for simple shapes).
- No <script>, no event handlers, no iframes, no external URLs.
- Use flexbox/grid for layout; preserve the image aspect ratio via width/height on html/body or the root wrapper.
- If text is illegible, use concise placeholder copy in the same script/language style.`;

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

export type ReplicateImageToHtmlOptions = {
  file_extension: string;
  llm_prompt?: string;
};

export type ReplicateImageToHtmlResult = {
  html: string;
  model: string;
  prompt_chars: number;
};

export const imageMimeFromExtension = (extension: string): string | null => {
  const ext = normalizeDocReadExtension(extension);
  return IMAGE_MIME[ext] ?? null;
};

/** Strip optional markdown code fences from model output. */
export const extractHtmlFromModelText = (text: string): string => {
  const trimmed = text.trim();
  const fenced = /^```(?:html)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/i.exec(trimmed);
  if (fenced) {
    return fenced[1].trim();
  }
  const openFence = /^```(?:html)?\s*\r?\n?([\s\S]+)$/i.exec(trimmed);
  if (openFence) {
    return openFence[1].replace(/\r?\n?```\s*$/i, "").trim();
  }
  return trimmed;
};

const messageContentToText = (
  content: string | Array<{ type?: string; text?: string }> | null | undefined,
): string => {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
};

export const replicateImageBufferToHtml = async (
  buffer: Buffer,
  options: ReplicateImageToHtmlOptions,
): Promise<ReplicateImageToHtmlResult> => {
  const extension = normalizeDocReadExtension(options.file_extension);
  if (!isDocReadImageExtension(extension)) {
    throw new Error(`Unsupported image extension "${extension}".`);
  }
  const mimeType = imageMimeFromExtension(extension);
  if (!mimeType) {
    throw new Error(`Cannot infer MIME type for "${extension}".`);
  }

  const config = readOpenAiEnvConfig();
  if (!config) {
    throw new Error(
      "Image→HTML replication requires OPENAI_API_KEY (and optional OPENAI_API_BASE, OPENAI_MODEL) on the host.",
    );
  }

  const prompt = options.llm_prompt?.trim() || DEFAULT_REPLICATE_HTML_PROMPT;
  const client = createOpenAiClient(config);
  const imageDataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;

  const response = await client.chat.completions.create({
    model: config.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
  });

  const rawText = messageContentToText(response.choices[0]?.message?.content);
  const html = extractHtmlFromModelText(rawText);
  if (!html) {
    throw new Error("Vision model returned empty HTML.");
  }

  return {
    html,
    model: config.model,
    prompt_chars: prompt.length,
  };
};
