// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Generate an organization content template in Markdown from reference material with an LLM.
 */
import { createOpenAiClient, chatCompletionTokenUsage, readOpenAiEnvConfig } from "./openai-client.ts";
import { cliEnv } from "./env.ts";
import {
  appendLanguageToUserPrompt,
  buildContentTemplateExtractSystemPrompt,
  type TemplateExtractLanguage,
} from "./template-extract-language.ts";

/** @deprecated Use buildContentTemplateExtractSystemPrompt("auto") instead. */
export const DEFAULT_CONTENT_TEMPLATE_EXTRACT_SYSTEM =
  buildContentTemplateExtractSystemPrompt("auto");

export type ExtractContentTemplateFromSourceInput = {
  name: string;
  sourceKind: "courseware" | "asset_doc" | "asset_image";
  sourcePayload: string;
  language?: TemplateExtractLanguage;
};

export type ExtractContentTemplateResult = {
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

function resolveContentTemplateExtractModel(fallbackModel: string): string {
  return (
    cliEnv().OPENAI_CONTENT_TEMPLATE_EXTRACT_MODEL?.trim() ||
    cliEnv().OPENAI_DESIGN_TEMPLATE_EXTRACT_MODEL?.trim() ||
    cliEnv().OPENAI_VISION_MODEL?.trim() ||
    cliEnv().OPENAI_MODEL?.trim() ||
    fallbackModel
  );
}

export async function extractContentTemplateMarkdownFromSource(
  input: ExtractContentTemplateFromSourceInput,
): Promise<ExtractContentTemplateResult> {
  const config = readOpenAiEnvConfig();
  if (!config) {
    throw new Error(
      "Content template extraction requires OPENAI_API_KEY on the host.",
    );
  }

  const language = input.language ?? "auto";
  const model = resolveContentTemplateExtractModel(config.model);
  const client = createOpenAiClient(config);
  const name = input.name.trim() || "Untitled";

  const userPrompt = appendLanguageToUserPrompt(
    language,
    [
      `Template name: ${name}`,
      `Source kind: ${input.sourceKind}`,
      "",
      "Extract a reusable content/outline template from the reference below.",
      "Do NOT extract visual style (colors, fonts, layout chrome, motion).",
      "Focus on learning goals, page structure, pacing, quizzes, and narration rhythm.",
      "",
      "Reference material (content/outline signals):",
      input.sourcePayload.trim(),
    ].join("\n"),
  );

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: buildContentTemplateExtractSystemPrompt(language) },
      { role: "user", content: userPrompt },
    ],
  });

  const raw = messageContentToText(response.choices[0]?.message?.content);
  const markdown = stripMarkdownFence(raw);
  if (!markdown) {
    throw new Error("Content template extraction returned empty content.");
  }

  return { markdown, model, usage: chatCompletionTokenUsage(response.usage) };
}

export async function extractContentTemplateMarkdownFromDocumentSlides(params: {
  name: string;
  slides: ReadonlyArray<{
    buffer: Buffer;
    mimeType: string;
    label: string;
  }>;
  language?: TemplateExtractLanguage;
}): Promise<ExtractContentTemplateResult> {
  const language = params.language ?? "auto";
  const slides = params.slides.filter((s) => s.buffer.byteLength > 0);
  if (slides.length === 0) {
    throw new Error("No slide images available for content template extraction.");
  }
  if (slides.length === 1) {
    return extractContentTemplateMarkdownFromImage({
      name: params.name,
      buffer: slides[0]!.buffer,
      mimeType: slides[0]!.mimeType,
      language,
    });
  }

  const config = readOpenAiEnvConfig();
  if (!config) {
    throw new Error(
      "Content template extraction requires OPENAI_API_KEY on the host.",
    );
  }

  const model = resolveContentTemplateExtractModel(config.model);
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
          "Extract ONE reusable content/outline template from these reference slides.",
          "Do NOT describe colors, typography, or visual chrome; focus on teaching goals, page roles, what each page should contain, quizzes, and narration pacing.",
          "Synthesize a unified outline across all slides (not one section per slide).",
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
      { role: "system", content: buildContentTemplateExtractSystemPrompt(language) },
      { role: "user", content },
    ],
  });

  const raw = messageContentToText(response.choices[0]?.message?.content);
  const markdown = stripMarkdownFence(raw);
  if (!markdown) {
    throw new Error("Content template extraction returned empty content.");
  }

  return { markdown, model, usage: chatCompletionTokenUsage(response.usage) };
}

export async function extractContentTemplateMarkdownFromImage(params: {
  name: string;
  buffer: Buffer;
  mimeType: string;
  imageAnalysis?: string;
  language?: TemplateExtractLanguage;
}): Promise<ExtractContentTemplateResult> {
  const config = readOpenAiEnvConfig();
  if (!config) {
    throw new Error(
      "Content template extraction requires OPENAI_API_KEY on the host.",
    );
  }

  const model = resolveContentTemplateExtractModel(config.model);
  const client = createOpenAiClient(config);
  const language = params.language ?? "auto";
  const name = params.name.trim() || "Untitled";
  const b64 = params.buffer.toString("base64");
  const analysisNote = params.imageAnalysis?.trim()
    ? `\n\nAdditional content analysis:\n${params.imageAnalysis.trim()}`
    : "";

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: buildContentTemplateExtractSystemPrompt(language) },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: appendLanguageToUserPrompt(
              language,
              `Template name: ${name}\nSource kind: asset_image\nExtract a reusable content/outline template from this reference image. Do NOT copy visual style (colors, fonts, chrome); describe teaching intent, page structure, and what content slots the layout implies.${analysisNote}`,
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
    throw new Error("Content template extraction returned empty content.");
  }

  return { markdown, model, usage: chatCompletionTokenUsage(response.usage) };
}
