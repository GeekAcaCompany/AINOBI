// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from 'node:http';

import { getAuthorizedSession } from '../api-auth.ts';
import { sendJsonWithCors } from '../http/cors.ts';
import { readJsonBody } from '../http/request.ts';
import { billTavilySearchCredits } from './tavily-search-credits.ts';
import {
  runTavilySearch,
  type TavilySearchDepth,
  type TavilySearchRequest,
  type TavilySearchTopic,
  type TavilyTimeRange,
} from './tavily-search.ts';

type SearchRunBody = {
  query?: string;
  search_depth?: TavilySearchDepth;
  max_results?: number;
  topic?: TavilySearchTopic;
  time_range?: TavilyTimeRange;
  include_answer?: boolean | 'basic' | 'advanced';
  include_raw_content?: boolean;
  /** Courseware org for organization credits billing (from agent env). */
  courseware_org_id?: string;
  conversation_id?: string;
};

export type { SearchRunBody };

const SEARCH_DEPTHS = new Set<TavilySearchDepth>(['advanced', 'basic', 'fast', 'ultra-fast']);
const SEARCH_TOPICS = new Set<TavilySearchTopic>(['general', 'news', 'finance']);
const TIME_RANGES = new Set<TavilyTimeRange>(['day', 'week', 'month', 'year', 'd', 'w', 'm', 'y']);

/** Shared by HTTP `/courseware/search/run` and MCP `courseware_search`. */
export function parseSearchRunBody(raw: SearchRunBody): TavilySearchRequest | null {
  const query = raw.query?.trim();
  if (!query) {
    return null;
  }

  const request: TavilySearchRequest = { query };

  if (raw.search_depth !== undefined) {
    if (!SEARCH_DEPTHS.has(raw.search_depth)) {
      return null;
    }
    request.search_depth = raw.search_depth;
  }

  if (raw.topic !== undefined) {
    if (!SEARCH_TOPICS.has(raw.topic)) {
      return null;
    }
    request.topic = raw.topic;
  }

  if (raw.time_range !== undefined) {
    if (!TIME_RANGES.has(raw.time_range)) {
      return null;
    }
    request.time_range = raw.time_range;
  }

  if (typeof raw.max_results === 'number' && Number.isFinite(raw.max_results)) {
    const max = Math.floor(raw.max_results);
    if (max >= 0 && max <= 20) {
      request.max_results = max;
    }
  }

  if (raw.include_answer === true || raw.include_answer === 'basic' || raw.include_answer === 'advanced') {
    request.include_answer = raw.include_answer;
  }

  if (raw.include_raw_content === true) {
    request.include_raw_content = true;
  }

  return request;
}

const formatCliStdout = (data: unknown, pretty: boolean): string => {
  const envelope = { ok: true, data };
  return pretty ? `${JSON.stringify(envelope, null, 2)}\n` : `${JSON.stringify(envelope)}\n`;
};

/**
 * POST `/courseware/search/run` — agent sandbox delegates Tavily search to the host (sync HTTP).
 * Body: `{ query, search_depth?, max_results?, topic?, time_range?, include_answer?, include_raw_content?, pretty? }`.
 */
export async function handleCoursewareSearchRun(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!getAuthorizedSession(req)) {
    sendJsonWithCors(res, 401, { ok: false, error: 'Unauthorized' });
    return;
  }

  let raw: SearchRunBody & { pretty?: boolean };
  try {
    raw = await readJsonBody<SearchRunBody & { pretty?: boolean }>(req);
  } catch (error) {
    sendJsonWithCors(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const payload = parseSearchRunBody(raw);
  if (!payload) {
    sendJsonWithCors(res, 400, {
      ok: false,
      error: 'Invalid body: non-empty query is required; check search_depth, topic, and time_range.',
    });
    return;
  }

  try {
    const data = await runTavilySearch(payload);
    const pretty = raw.pretty !== false;
    const stdout = formatCliStdout(data, pretty);
    const session = getAuthorizedSession(req);
    let creditsBilling: Record<string, unknown> | undefined;
    if (session) {
      const billing = await billTavilySearchCredits({
        session,
        query: payload.query,
        coursewareOrgId: raw.courseware_org_id?.trim() || undefined,
        conversationId: raw.conversation_id?.trim() || undefined,
      });
      if (billing?.kind === 'charged') {
        creditsBilling = {
          creditsTavily: {
            serviceCode: billing.result.serviceCode,
            searchCount: 1,
            creditsConsumed: billing.result.creditsConsumed,
            remainingCredits: billing.result.remainingCredits,
          },
        };
      } else if (billing?.kind === 'failed') {
        creditsBilling = { creditsTavilyError: billing.error };
      }
    }
    sendJsonWithCors(res, 200, { ok: true, exit_code: 0, stdout, stderr: '', ...creditsBilling });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stderr = JSON.stringify({
      ok: false,
      error: { code: 'IO_ERROR', message, issues: [] },
    });
    sendJsonWithCors(res, 200, {
      ok: false,
      exit_code: 1,
      stdout: '',
      stderr: stderr.endsWith('\n') ? stderr : `${stderr}\n`,
      error: message,
    });
  }
}
