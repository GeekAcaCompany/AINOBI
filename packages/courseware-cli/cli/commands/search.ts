// SPDX-License-Identifier: AGPL-3.0-only
import { flagBool, flagNumber, flagString, type ParsedArgs } from "../args.ts";
import { AinobiCliError } from "../errors.ts";
import { printSuccess, type OutputOptions } from "../output.ts";
import { runSearchViaHost } from "../search-host-job.ts";
import { isSearchHostFlush } from "../runtime.ts";
import { runTavilySearchLocal } from "../tavily-client.ts";
import type {
  TavilySearchDepth,
  TavilySearchRequest,
  TavilySearchTopic,
  TavilyTimeRange,
} from "../tavily-types.ts";

const SEARCH_DEPTHS = new Set<TavilySearchDepth>(["advanced", "basic", "fast", "ultra-fast"]);
const SEARCH_TOPICS = new Set<TavilySearchTopic>(["general", "news", "finance"]);
const TIME_RANGES = new Set<TavilyTimeRange>(["day", "week", "month", "year", "d", "w", "m", "y"]);

const joinQuery = (positionals: string[]): string => positionals.join(" ").trim();

const parseSearchRequest = (args: ParsedArgs): TavilySearchRequest => {
  const query = joinQuery(args.positionals);
  if (!query) {
    throw new AinobiCliError("USAGE", "Search query is required.", {
      hint: "Usage: ainobi search <query> [--max-results N] [--depth basic] [--topic general] [--time-range week] [--answer]",
    });
  }

  const request: TavilySearchRequest = { query };

  const depth = flagString(args, "depth");
  if (depth !== undefined) {
    if (!SEARCH_DEPTHS.has(depth as TavilySearchDepth)) {
      throw new AinobiCliError("USAGE", `Invalid --depth "${depth}".`, {
        hint: "Use basic, advanced, fast, or ultra-fast.",
      });
    }
    request.search_depth = depth as TavilySearchDepth;
  }

  const topic = flagString(args, "topic");
  if (topic !== undefined) {
    if (!SEARCH_TOPICS.has(topic as TavilySearchTopic)) {
      throw new AinobiCliError("USAGE", `Invalid --topic "${topic}".`, {
        hint: "Use general, news, or finance.",
      });
    }
    request.topic = topic as TavilySearchTopic;
  }

  const timeRange = flagString(args, "time-range");
  if (timeRange !== undefined) {
    if (!TIME_RANGES.has(timeRange as TavilyTimeRange)) {
      throw new AinobiCliError("USAGE", `Invalid --time-range "${timeRange}".`, {
        hint: "Use day, week, month, year (or d, w, m, y).",
      });
    }
    request.time_range = timeRange as TavilyTimeRange;
  }

  const maxResults = flagNumber(args, "max-results");
  if (maxResults !== undefined) {
    if (!Number.isFinite(maxResults) || maxResults < 0 || maxResults > 20) {
      throw new AinobiCliError("USAGE", "--max-results must be between 0 and 20.");
    }
    request.max_results = Math.floor(maxResults);
  }

  if (flagBool(args, "answer") === true) {
    request.include_answer = true;
  }

  const answerLevel = flagString(args, "answer-level");
  if (answerLevel !== undefined) {
    if (answerLevel !== "basic" && answerLevel !== "advanced") {
      throw new AinobiCliError("USAGE", '--answer-level must be "basic" or "advanced".');
    }
    request.include_answer = answerLevel;
  }

  if (flagBool(args, "raw-content") === true) {
    request.include_raw_content = true;
  }

  return request;
};

export const handleSearch = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  const request = parseSearchRequest(args);

  if (isSearchHostFlush()) {
    await runSearchViaHost(request, output);
    return;
  }

  const data = await runTavilySearchLocal(request);
  printSuccess(data, output);
};
