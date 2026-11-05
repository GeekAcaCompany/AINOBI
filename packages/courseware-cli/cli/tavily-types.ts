// SPDX-License-Identifier: AGPL-3.0-only
export type TavilySearchDepth = "advanced" | "basic" | "fast" | "ultra-fast";
export type TavilySearchTopic = "general" | "news" | "finance";
export type TavilyTimeRange = "day" | "week" | "month" | "year" | "d" | "w" | "m" | "y";

export type TavilySearchRequest = {
  query: string;
  search_depth?: TavilySearchDepth;
  max_results?: number;
  topic?: TavilySearchTopic;
  time_range?: TavilyTimeRange;
  include_answer?: boolean | "basic" | "advanced";
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
