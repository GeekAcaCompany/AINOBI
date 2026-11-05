// SPDX-License-Identifier: AGPL-3.0-only
import { tavily } from '@tavily/core';

export type TavilySearchDepth = 'advanced' | 'basic' | 'fast' | 'ultra-fast';
export type TavilySearchTopic = 'general' | 'news' | 'finance';
export type TavilyTimeRange = 'day' | 'week' | 'month' | 'year' | 'd' | 'w' | 'm' | 'y';

export type TavilySearchRequest = {
  query: string;
  search_depth?: TavilySearchDepth;
  max_results?: number;
  topic?: TavilySearchTopic;
  time_range?: TavilyTimeRange;
  include_answer?: boolean | 'basic' | 'advanced';
  include_raw_content?: boolean;
};

export type TavilySearchResultItem = {
  title: string;
  url: string;
  content: string;
  score?: number;
  raw_content?: string | null;
};

export type TavilySearchData = {
  query: string;
  answer: string | null;
  results: TavilySearchResultItem[];
  response_time?: number;
};

/** Host settings: the key is read lazily, after the request is validated. */
export type TavilySearchSettings = {
  /** Returns the API key, or throws a host-specific "not configured" error. */
  apiKey: () => string;
};

const normalizeResultItem = (item: Record<string, unknown>): TavilySearchResultItem => ({
  title: typeof item.title === 'string' ? item.title : '',
  url: typeof item.url === 'string' ? item.url : '',
  content: typeof item.content === 'string' ? item.content : '',
  score: typeof item.score === 'number' ? item.score : undefined,
  raw_content: typeof item.raw_content === 'string' ? item.raw_content : null,
});

/** Execute Tavily Search on the host. */
export async function runTavilySearch(
  request: TavilySearchRequest,
  settings: TavilySearchSettings,
): Promise<TavilySearchData> {
  const query = request.query?.trim();
  if (!query) {
    throw new Error('Search query is required.');
  }

  const client = tavily({ apiKey: settings.apiKey() });
  const response = (await client.search(query, {
    searchDepth: request.search_depth,
    topic: request.topic,
    maxResults: request.max_results,
    timeRange: request.time_range,
    includeAnswer: request.include_answer,
    // The API's boolean `true` means markdown; the SDK only types the explicit format.
    includeRawContent: request.include_raw_content ? 'markdown' : undefined,
  })) as Record<string, unknown>;

  const resultsRaw = Array.isArray(response.results) ? response.results : [];
  const answer =
    typeof response.answer === 'string' && response.answer.trim()
      ? response.answer
      : null;

  return {
    query: typeof response.query === 'string' ? response.query : query,
    answer,
    results: resultsRaw.map((item) =>
      normalizeResultItem(item && typeof item === 'object' ? (item as Record<string, unknown>) : {}),
    ),
    response_time:
      typeof response.response_time === 'number' ? response.response_time : undefined,
  };
}
