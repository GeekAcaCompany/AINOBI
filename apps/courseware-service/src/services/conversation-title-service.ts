// SPDX-License-Identifier: AGPL-3.0-only
import OpenAI from "openai";

import { dataSource } from "../db/db.ts";
import { CoursewareConversation } from "../models/courseware-conversation.ts";

export type TitleLocale = "zh" | "en" | "ja";

const MAX_CONVERSATION_TITLE_LENGTH = 128;
const TITLE_GENERATION_TIMEOUT_MS = Number(
  process.env.COURSEWARE_CONVERSATION_TITLE_TIMEOUT_MS ?? 15_000,
);
const TITLE_REASONING_MAX_COMPLETION_TOKENS = Number(
  process.env.COURSEWARE_CONVERSATION_TITLE_MAX_COMPLETION_TOKENS ?? 1024,
);

function titleModel(): string {
  return (
    process.env.COURSEWARE_CONVERSATION_TITLE_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-4o-mini"
  );
}

function titleApiKey(): string | undefined {
  return (
    process.env.COURSEWARE_CONVERSATION_TITLE_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    undefined
  );
}

function titleBaseUrl(): string | undefined {
  const raw =
    process.env.COURSEWARE_CONVERSATION_TITLE_API_BASE?.trim() ||
    process.env.OPENAI_API_BASE?.trim() ||
    "";
  return raw ? raw.replace(/\/$/, "") : undefined;
}

export function parseTitleLocale(raw: string | null | undefined): TitleLocale | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "zh" || normalized === "en" || normalized === "ja") {
    return normalized;
  }
  return undefined;
}

/** Without a UI language, roughly guess the title language from the user's first line of text. */
export function detectTitleLocaleFromPrompt(prompt: string): TitleLocale {
  const sample = prompt.trim().slice(0, 500);
  if (!sample) return "en";
  if (/[\u3040-\u30ff]/.test(sample)) return "ja";
  if (/[\u3400-\u9fff]/.test(sample)) return "zh";
  return "en";
}

export function resolveTitleLocale(
  prompt: string,
  preferredUiLanguage?: string | null,
): TitleLocale {
  return parseTitleLocale(preferredUiLanguage) ?? detectTitleLocaleFromPrompt(prompt);
}

export function titleSystemPrompt(locale: TitleLocale): string {
  switch (locale) {
    case "ja":
      return "Output only one short chat session title, written in Japanese. No quotes, no explanation.";
    case "zh":
      return "Output only one short chat session title, written in Simplified Chinese. No quotes, no explanation.";
    default:
      return "Output only one short chat session title. No quotes, no explanation.";
  }
}

export type ConversationTitleOptions = {
  preferredUiLanguage?: string | null;
};

/** gpt-5 / o-series and similar don't support temperature or max_tokens; use max_completion_tokens instead. */
export function usesOpenAiReasoningChatParams(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return (
    normalized.startsWith("gpt-5") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4")
  );
}

export function buildOpenAiTitleCompletionBody(
  model: string,
  userPrompt: string,
  locale: TitleLocale = "en",
): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: titleSystemPrompt(locale),
    },
    {
      role: "user",
      content: userPrompt.trim().slice(0, 2000),
    },
  ];

  if (usesOpenAiReasoningChatParams(model)) {
    return {
      model,
      messages,
      max_completion_tokens: TITLE_REASONING_MAX_COMPLETION_TOKENS,
    };
  }

  return {
    model,
    messages,
    temperature: 0.2,
    max_tokens: 48,
  };
}

function fallbackTitleFromPrompt(prompt: string): string {
  const line = prompt.trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (!line) return "";
  return line.length > MAX_CONVERSATION_TITLE_LENGTH
    ? `${line.slice(0, MAX_CONVERSATION_TITLE_LENGTH - 1)}…`
    : line;
}

function normalizeGeneratedTitle(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^["'「『【]+|["'」』】]+$/g, "")
    .trim();
  if (!cleaned) return "";
  return cleaned.length > MAX_CONVERSATION_TITLE_LENGTH
    ? `${cleaned.slice(0, MAX_CONVERSATION_TITLE_LENGTH - 1)}…`
    : cleaned;
}

async function generateTitleWithLlm(
  userPrompt: string,
  locale: TitleLocale,
): Promise<string | null> {
  const apiKey = titleApiKey();
  if (!apiKey) return null;

  const model = titleModel();
  const client = new OpenAI({
    apiKey,
    ...(titleBaseUrl() ? { baseURL: titleBaseUrl() } : {}),
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TITLE_GENERATION_TIMEOUT_MS);
  const body = buildOpenAiTitleCompletionBody(model, userPrompt, locale);

  const parseTitle = (res: OpenAI.Chat.Completions.ChatCompletion): string | null => {
    const choice = res.choices[0];
    const text = choice?.message?.content?.trim() ?? "";
    const title = normalizeGeneratedTitle(text);
    if (title) return title;
    const reasoning = res.usage?.completion_tokens_details?.reasoning_tokens;
    console.warn(
      `[conversation-title] LLM empty (model=${model}, finish=${choice?.finish_reason ?? "unknown"}, reasoningTokens=${reasoning ?? "?"})`,
    );
    return null;
  };

  try {
    const res = await client.chat.completions.create(body, { signal: controller.signal });
    const title = parseTitle(res);
    if (title) return title;

    // Reasoning models such as gpt-5 may exhaust the completion budget; retry once with a larger limit
    if (usesOpenAiReasoningChatParams(model) && body.max_completion_tokens != null) {
      const retryBody = {
        ...body,
        max_completion_tokens: Math.max(body.max_completion_tokens * 2, 2048),
      };
      const retry = await client.chat.completions.create(retryBody, { signal: controller.signal });
      return parseTitle(retry);
    }
    return null;
  } catch (error) {
    console.warn(
      `[conversation-title] LLM failed (model=${model}):`,
      error instanceof Error ? error.message : error,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * When the conversation has no title yet, summarize one from the current user query with an LLM and store it; on failure, a short summary of the query is the fallback.
 * Doesn't block the main chat path; callers should fire-and-forget.
 */
export async function ensureConversationTitleFromPrompt(
  conversation: CoursewareConversation,
  userPrompt: string,
  options?: ConversationTitleOptions,
): Promise<string | null> {
  const prompt = userPrompt.trim();
  if (!prompt) return null;

  const locale = resolveTitleLocale(prompt, options?.preferredUiLanguage);
  const existing = conversation.title?.trim();
  const fallback = fallbackTitleFromPrompt(prompt);
  const canUpgradeFallback = Boolean(existing && fallback && existing === fallback);

  if (existing && !canUpgradeFallback) {
    return existing;
  }

  const model = titleModel();
  console.info(
    `[conversation-title] start conversationId=${conversation.id} model=${model} locale=${locale}${canUpgradeFallback ? " (upgrade fallback)" : ""}`,
  );

  const llmTitle = await generateTitleWithLlm(prompt, locale);
  const title = llmTitle || fallback;
  if (!title.trim()) return null;

  const source = llmTitle ? "llm" : "fallback";
  if (canUpgradeFallback && !llmTitle) {
    return existing!;
  }

  if (!dataSource.isInitialized) {
    conversation.title = title;
    return title;
  }

  const repo = dataSource.getRepository(CoursewareConversation);
  const qb = repo
    .createQueryBuilder()
    .update(CoursewareConversation)
    .set({ title, updatedAt: new Date() })
    .where("id = :id", { id: conversation.id });

  if (!canUpgradeFallback) {
    qb.andWhere("(title IS NULL OR btrim(title) = '')");
  }

  const result = await qb.execute();

  if ((result.affected ?? 0) === 0) {
    const row = await dataSource.getRepository(CoursewareConversation).findOne({
      where: { id: conversation.id },
      select: { id: true, title: true },
    });
    if (row?.title?.trim()) {
      conversation.title = row.title.trim();
      return conversation.title;
    }
  } else {
    conversation.title = title;
    console.info(
      `[conversation-title] saved (${source}) conversationId=${conversation.id} title=${title}`,
    );
  }
  return conversation.title?.trim() || title;
}
