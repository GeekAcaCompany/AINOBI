// SPDX-License-Identifier: AGPL-3.0-only
import { createOpenAI } from "@ai-sdk/openai";
import { cliEnv } from "./env.ts";
import type { LanguageModel } from "ai";

/** Shared OpenAI-compatible vision model (`OPENAI_API_KEY`, `OPENAI_API_BASE`, `OPENAI_MODEL`). */
export const resolveOpenAiVisionModel = (): LanguageModel | null => {
  const apiKey = cliEnv().OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const baseURL = cliEnv().OPENAI_API_BASE?.trim();
  const modelId = cliEnv().OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const provider = createOpenAI({
    apiKey,
    ...(baseURL ? { baseURL: baseURL.replace(/\/$/, "") } : {}),
  });
  return provider(modelId);
};
