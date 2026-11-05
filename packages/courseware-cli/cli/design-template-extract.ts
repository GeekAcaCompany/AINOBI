// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Generate an organization design template in Markdown from reference material with an LLM.
 */
import { createOpenAiClient, chatCompletionTokenUsage, readOpenAiEnvConfig } from "./openai-client.ts";
import { cliEnv } from "./env.ts";
import {
  appendLanguageToUserPrompt,
  buildDesignTemplateExtractSystemPrompt,
  type TemplateExtractLanguage,
} from "./template-extract-language.ts";

/** @deprecated Use buildDesignTemplateExtractSystemPrompt("auto") instead. */
export const DEFAULT_DESIGN_TEMPLATE_EXTRACT_SYSTEM =
  buildDesignTemplateExtractSystemPrompt("auto");

export type ExtractDesignTemplateFromSourceInput = {
  name: string;
  sourceKind: "courseware" | "asset_doc" | "asset_image";
  sourcePayload: string;
  language?: TemplateExtractLanguage;
};

export type ExtractDesignTemplateResult = {
  markdown: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
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

const stripMarkdownFence = (text: string): string => {
  const trimmed = text.trim();
  const fenced = /^```(?:markdown|md)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/i.exec(trimmed);
  if (fenced) return fenced[1].trim();
  return trimmed;
};

export async function extractDesignTemplateMarkdownFromSource(
  input: ExtractDesignTemplateFromSourceInput,
): Promise<ExtractDesignTemplateResult> {
  const config = readOpenAiEnvConfig();
  if (!config) {
    throw new Error(
      "Design template extraction requires OPENAI_API_KEY on the host.",
    );
  }

  const language = input.language ?? "auto";
  const model =
    cliEnv().OPENAI_DESIGN_TEMPLATE_EXTRACT_MODEL?.trim() || config.model;
  const client = createOpenAiClient(config);
  const name = input.name.trim() || "Untitled";

  const userPrompt = appendLanguageToUserPrompt(
    language,
    [
      `Template name: ${name}`,
      `Source kind: ${input.sourceKind}`,
      "",
      "Extract a reusable visual design system from the reference below.",
      "Do NOT copy lesson topics, titles, or body text into the template.",
      "",
      "Reference material (layout/style signals only):",
      input.sourcePayload.trim(),
    ].join("\n"),
  );

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: buildDesignTemplateExtractSystemPrompt(language) },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = messageContentToText(response.choices[0]?.message?.content);
  const markdown = stripMarkdownFence(raw);
  if (!markdown) {
    throw new Error("Design template extraction returned empty content.");
  }

  return { markdown, model, usage: chatCompletionTokenUsage(response.usage) };
}

export async function extractDesignTemplateMarkdownFromDocumentSlides(params: {
  name: string;
  slides: ReadonlyArray<{
    buffer: Buffer;
    mimeType: string;
    label: string;
  }>;
  language?: TemplateExtractLanguage;
}): Promise<ExtractDesignTemplateResult> {
  const language = params.language ?? "auto";
  const slides = params.slides.filter((s) => s.buffer.byteLength > 0);
  if (slides.length === 0) {
    throw new Error("No slide images available for design template extraction.");
  }
  if (slides.length === 1) {
    return extractDesignTemplateMarkdownFromImage({
      name: params.name,
      buffer: slides[0]!.buffer,
      mimeType: slides[0]!.mimeType,
      language,
    });
  }

  const config = readOpenAiEnvConfig();
  if (!config) {
    throw new Error(
      "Design template extraction requires OPENAI_API_KEY on the host.",
    );
  }

  const model =
    cliEnv().OPENAI_DESIGN_TEMPLATE_EXTRACT_MODEL?.trim() ||
    cliEnv().OPENAI_VISION_MODEL?.trim() ||
    config.model;
  const client = createOpenAiClient(config);
  const name = params.name.trim() || "Untitled";
  const slideList = slides.map((s, i) => `${i + 1}. ${s.label}`).join("\n");

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [
    {
      type: "text",
      text: appendLanguageToUserPrompt(
        language,
        [
          `Template name: ${name}`,
          "Source kind: asset_document_slides",
          "Extract ONE reusable visual design template from these reference slides.",
          "Do NOT copy subject matter or on-slide text; describe only colors, typography, layout patterns, and component styling.",
          "Synthesize a unified system across all slides (not one section per slide).",
          "",
          "Slides:",
          slideList,
        ].join("\n"),
      ),
    },
  ];

  for (const slide of slides) {
    content.push({
      type: "text",
      text: `Reference slide: ${slide.label}`,
    });
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${slide.mimeType};base64,${slide.buffer.toString("base64")}`,
      },
    });
  }

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: buildDesignTemplateExtractSystemPrompt(language) },
      { role: "user", content },
    ],
  });

  const raw = messageContentToText(response.choices[0]?.message?.content);
  const markdown = stripMarkdownFence(raw);
  if (!markdown) {
    throw new Error("Design template extraction returned empty content.");
  }

  return { markdown, model, usage: chatCompletionTokenUsage(response.usage) };
}

export async function extractDesignTemplateMarkdownFromImage(params: {
  name: string;
  buffer: Buffer;
  mimeType: string;
  imageAnalysis?: string;
  language?: TemplateExtractLanguage;
}): Promise<ExtractDesignTemplateResult> {
  const config = readOpenAiEnvConfig();
  if (!config) {
    throw new Error(
      "Design template extraction requires OPENAI_API_KEY on the host.",
    );
  }

  const model =
    cliEnv().OPENAI_DESIGN_TEMPLATE_EXTRACT_MODEL?.trim() ||
    cliEnv().OPENAI_VISION_MODEL?.trim() ||
    config.model;
  const client = createOpenAiClient(config);
  const language = params.language ?? "auto";
  const name = params.name.trim() || "Untitled";
  const b64 = params.buffer.toString("base64");
  const analysisNote = params.imageAnalysis?.trim()
    ? `\n\nAdditional layout analysis:\n${params.imageAnalysis.trim()}`
    : "";

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: buildDesignTemplateExtractSystemPrompt(language) },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: appendLanguageToUserPrompt(
              language,
              `Template name: ${name}\nSource kind: asset_image\nExtract a reusable visual design template from this reference image. Do NOT copy subject matter or on-image text into the template; describe only colors, typography, layout patterns, and component styling.${analysisNote}`,
            ),
          },
          {
            type: "image_url",
            image_url: { url: `data:${params.mimeType};base64,${b64}` },
          },
        ],
      },
    ],
  });

  const raw = messageContentToText(response.choices[0]?.message?.content);
  const markdown = stripMarkdownFence(raw);
  if (!markdown) {
    throw new Error("Design template extraction returned empty content.");
  }

  return { markdown, model, usage: chatCompletionTokenUsage(response.usage) };
}
