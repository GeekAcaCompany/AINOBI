// SPDX-License-Identifier: AGPL-3.0-only
import { AinobiCliError } from "./errors.ts";
import { cliEnv } from "./env.ts";
import type { TavilySearchData, TavilySearchRequest } from "./tavily-types.ts";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

const tavilyApiKey = (): string => {
  const key = cliEnv().TAVILY_API_KEY?.trim();
  if (!key) {
    throw new AinobiCliError(
      "USAGE",
      "Tavily search requires `TAVILY_API_KEY` in the environment.",
      {
        hint:
          "Set TAVILY_API_KEY in .env for standalone CLI, or run `ainobi search` from the courseware agent (host delegates search).",
      },
    );
  }
  return key;
};

const normalizeResultItem = (item: Record<string, unknown>) => ({
  title: typeof item.title === "string" ? item.title : "",
  url: typeof item.url === "string" ? item.url : "",
  content: typeof item.content === "string" ? item.content : "",
  score: typeof item.score === "number" ? item.score : undefined,
  raw_content: typeof item.raw_content === "string" ? item.raw_content : null,
});

/** Standalone CLI: call Tavily Search directly (not used in agent host-flush mode). */
export const runTavilySearchLocal = async (
  request: TavilySearchRequest,
): Promise<TavilySearchData> => {
  const query = request.query?.trim();
  if (!query) {
    throw new AinobiCliError("USAGE", "Search query is required.");
  }

  const body: Record<string, unknown> = { query };
  if (request.search_depth) body.search_depth = request.search_depth;
  if (request.topic) body.topic = request.topic;
  if (request.time_range) body.time_range = request.time_range;
  if (request.max_results !== undefined) body.max_results = request.max_results;
  if (request.include_answer !== undefined) body.include_answer = request.include_answer;
  if (request.include_raw_content) body.include_raw_content = request.include_raw_content;

  let response: Response;
  try {
    response = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${tavilyApiKey()}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw new AinobiCliError(
      "IO_ERROR",
      `Tavily search request failed: ${error instanceof Error ? error.message : String(error)}`,
      { hint: "Check network connectivity and TAVILY_API_KEY." },
    );
  }

  const text = await response.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new AinobiCliError(
      "IO_ERROR",
      `Tavily returned non-JSON (HTTP ${response.status}).`,
      { hint: text.slice(0, 200) },
    );
  }

  if (!response.ok) {
    const detail =
      typeof parsed.detail === "object" &&
      parsed.detail !== null &&
      typeof (parsed.detail as { error?: unknown }).error === "string"
        ? (parsed.detail as { error: string }).error
        : `Tavily search failed (HTTP ${response.status}).`;
    throw new AinobiCliError("IO_ERROR", detail);
  }

  const resultsRaw = Array.isArray(parsed.results) ? parsed.results : [];
  const answer =
    typeof parsed.answer === "string" && parsed.answer.trim() ? parsed.answer : null;

  return {
    query: typeof parsed.query === "string" ? parsed.query : query,
    answer,
    results: resultsRaw.map((item) =>
      normalizeResultItem(item && typeof item === "object" ? (item as Record<string, unknown>) : {}),
    ),
    response_time:
      typeof parsed.response_time === "number" ? parsed.response_time : undefined,
  };
};
