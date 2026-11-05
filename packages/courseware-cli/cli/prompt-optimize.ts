// SPDX-License-Identifier: AGPL-3.0-only
import { createOpenAiClient, readOpenAiEnvConfig, type OpenAiEnvConfig } from "./openai-client.ts";
import { cliEnv } from "./env.ts";

const DEFAULT_OPTIMIZE_SYSTEM_PROMPT = `You are an expert prompt engineer for AI text-to-image generation (OpenAI gpt-image models).
Rewrite the user's draft into ONE improved, self-contained image prompt.

Requirements:
- Output ONLY the improved prompt text. No preamble, no quotes, no markdown, no explanations.
- Keep the user's original language (if the draft is Chinese, answer in Chinese; if English, answer in English).
- Preserve the user's intent and key subjects; do not invent unrelated content.
- Add concrete, useful visual detail: subject, composition, setting, lighting, color palette, art style/medium, mood, and camera/lens or perspective when relevant.
- Prefer describing what SHOULD appear (positive phrasing). Avoid meta words like "generate", "image of", or "a picture of".
- Keep it concise (roughly under 120 words) and suitable for an educational courseware illustration.`;

export type OptimizePromptUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type OptimizePromptResult = {
  optimizedPrompt: string;
  model: string;
  usage: OptimizePromptUsage;
};

export type OptimizePromptOptions = {
  /** Override the default system prompt (optional). */
  system_prompt?: string;
};

export const resolvePromptOptimizeModel = (config: OpenAiEnvConfig): string =>
  cliEnv().OPENAI_PROMPT_OPTIMIZE_MODEL?.trim() || config.model;

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

const stripWrappingQuotes = (text: string): string => {
  const trimmed = text.trim();
  const quoted = /^(["'“”「『])([\s\S]*)(["'“”」』])$/.exec(trimmed);
  return quoted ? quoted[2].trim() : trimmed;
};

/**
 * Use a text LLM to refine a user's draft prompt into one better suited to image generation.
 */
export const optimizeImagePrompt = async (
  rawPrompt: string,
  options: OptimizePromptOptions = {},
): Promise<OptimizePromptResult> => {
  const prompt = rawPrompt?.trim();
  if (!prompt) {
    throw new Error("Prompt to optimize is required.");
  }

  const config = readOpenAiEnvConfig();
  if (!config) {
    throw new Error(
      "Prompt optimization requires OPENAI_API_KEY (and optional OPENAI_API_BASE, OPENAI_PROMPT_OPTIMIZE_MODEL) on the host.",
    );
  }

  const model = resolvePromptOptimizeModel(config);
  const client = createOpenAiClient(config);
  const systemPrompt = options.system_prompt?.trim() || DEFAULT_OPTIMIZE_SYSTEM_PROMPT;

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
  });

  const optimizedPrompt = stripWrappingQuotes(
    messageContentToText(response.choices[0]?.message?.content),
  );
  if (!optimizedPrompt) {
    throw new Error("Prompt optimization model returned empty text.");
  }

  const usage = response.usage;
  const inputTokens = usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;
  const totalTokens = usage?.total_tokens ?? inputTokens + outputTokens;

  return {
    optimizedPrompt,
    model,
    usage: { inputTokens, outputTokens, totalTokens },
  };
};
