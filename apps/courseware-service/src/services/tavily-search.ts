// SPDX-License-Identifier: AGPL-3.0-only
/** Tavily web search — implemented in @ainobi/agent-runtime; this service takes the key from TAVILY_API_KEY. */
import {
  runTavilySearch as runTavilySearchWithSettings,
  type TavilySearchData,
  type TavilySearchRequest,
} from "@ainobi/agent-runtime";

export type {
  TavilySearchData,
  TavilySearchDepth,
  TavilySearchRequest,
  TavilySearchResultItem,
  TavilySearchTopic,
  TavilyTimeRange,
} from "@ainobi/agent-runtime";

const tavilyApiKey = (): string => {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) {
    throw new Error("TAVILY_API_KEY is not configured on the AINOBI host.");
  }
  return key;
};

/** Execute Tavily Search on the host (requires `TAVILY_API_KEY`). */
export function runTavilySearch(request: TavilySearchRequest): Promise<TavilySearchData> {
  return runTavilySearchWithSettings(request, { apiKey: tavilyApiKey });
}
