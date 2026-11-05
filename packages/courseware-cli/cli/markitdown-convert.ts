// SPDX-License-Identifier: AGPL-3.0-only
import "../polyfill/pdf-node-globals.ts";

import {
  isDocReadExtensionSupported,
  isDocReadImageExtension,
  normalizeDocReadExtension,
} from "./doc-extensions.ts";
import { resolveOpenAiVisionModel } from "./openai-vision.ts";

const DEFAULT_IMAGE_LLM_PROMPT =
  "Describe this image in detail for a courseware authoring assistant: subjects, visible text (verbatim when readable), layout, colors, charts, and any instructional content.";

export type ConvertBufferToMarkdownOptions = {
  file_extension: string;
  llm_prompt?: string;
  /** When false, skip OpenAI vision even if configured (images still get EXIF metadata). */
  use_llm_for_images?: boolean;
};

export type ConvertBufferToMarkdownResult = {
  title: string | null;
  markdown: string;
  llm_used: boolean;
};

/**
 * Convert an in-memory file to Markdown (markitdown-ts). Host and standalone CLI share this entry.
 */
export const convertBufferToMarkdown = async (
  buffer: Buffer,
  options: ConvertBufferToMarkdownOptions,
): Promise<ConvertBufferToMarkdownResult> => {
  const file_extension = normalizeDocReadExtension(options.file_extension);
  if (!isDocReadExtensionSupported(file_extension)) {
    throw new Error(`Unsupported document extension "${file_extension}".`);
  }

  const convertOptions: Record<string, unknown> = { file_extension };
  let llm_used = false;

  if (
    options.use_llm_for_images !== false &&
    isDocReadImageExtension(file_extension)
  ) {
    const llmModel = resolveOpenAiVisionModel();
    if (llmModel) {
      convertOptions.llmModel = llmModel;
      convertOptions.llmPrompt = options.llm_prompt?.trim() || DEFAULT_IMAGE_LLM_PROMPT;
      llm_used = true;
    }
  }

  const { MarkItDown } = await import("markitdown-ts");
  const markitdown = new MarkItDown();
  const result = await markitdown.convertBuffer(buffer, convertOptions as never);
  const markdown = result?.markdown?.trim() ?? result?.text_content?.trim() ?? "";
  if (!markdown) {
    throw new Error("Document conversion produced empty markdown.");
  }

  return {
    title: result?.title ?? null,
    markdown,
    llm_used,
  };
};
