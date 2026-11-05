// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from 'node:http';

import { maybeResumeInterruptedChatTurn } from './chat-agent-turn-runner.ts';

import {
  chatStreamKeyForSession,
  publishRedisStreamEntry,
  readRedisStream,
  REDIS_STREAM_CURSOR_START,
  resolveRedisConfig,
} from '../db/redis-stream.ts';
import { corsHeaders } from '../http/cors.ts';
import { writeSse, writeSseComment } from '../http/request.ts';

/** Comment pings while XREAD blocks so proxies do not idle-timeout the SSE connection. */
export const CHAT_STREAM_SSE_HEARTBEAT_MS = 25_000;

/** @deprecated Import from `../session/transcript-editor-context.ts` */
export { CHAT_STREAM_RECOVERY_USER_PROMPT } from '../session/transcript-editor-context.ts';

export type ChatSseMirror = {
  chatStreamSessionId: string;
  redisEnabled: boolean;
  emit: (event: string, payload: Record<string, unknown>) => Promise<void>;
};

export function createChatSseMirror(args: {
  chatStreamSessionId: string;
  res: ServerResponse;
  isClientConnected: () => boolean;
}): ChatSseMirror {
  const streamKey = chatStreamKeyForSession(args.chatStreamSessionId);
  const redisEnabled = resolveRedisConfig() != null;

  // ★POST stream heartbeat: during long silent periods such as planning/image generation the SDK has no message to send, and with no bytes flowing
  // Cloudflare cuts the connection after ~100s idle (ERR_HTTP2_PROTOCOL_ERROR) — the GET subscription path
  // always had a heartbeat, the POST path was missing one (the root cause of red team R1's underlying stream drops).
  const heartbeat = setInterval(() => {
    if (args.res.writableEnded || args.res.destroyed) {
      clearInterval(heartbeat);
      return;
    }
    try {
      writeSseComment(args.res);
    } catch {
      clearInterval(heartbeat);
    }
  }, CHAT_STREAM_SSE_HEARTBEAT_MS);
  args.res.on('close', () => clearInterval(heartbeat));
  args.res.on('finish', () => clearInterval(heartbeat));

  return {
    chatStreamSessionId: args.chatStreamSessionId,
    redisEnabled,
    async emit(event, payload) {
      let streamEntryId: string | null = null;
      if (redisEnabled) {
        try {
          streamEntryId = await publishRedisStreamEntry(streamKey, event, payload);
        } catch (error) {
          console.warn(
            '[chat-stream] redis publish failed:',
            error instanceof Error ? error.message : error,
          );
        }
      }

      const data: Record<string, unknown> =
        streamEntryId != null ? { ...payload, streamEntryId } : { ...payload };

      if (!args.isClientConnected() || args.res.writableEnded) {
        return;
      }

      try {
        writeSse(args.res, event, data);
      } catch {
        // Client disconnected; agent turn continues and Redis mirror still receives events.
      }
    },
  };
}

/** Mirror to Redis only (no HTTP client); used when resuming an interrupted turn in the background. */
export function createChatSseMirrorPublishOnly(chatStreamSessionId: string): ChatSseMirror {
  const streamKey = chatStreamKeyForSession(chatStreamSessionId);
  const redisEnabled = resolveRedisConfig() != null;

  return {
    chatStreamSessionId,
    redisEnabled,
    async emit(event, payload) {
      if (!redisEnabled) {
        return;
      }
      try {
        await publishRedisStreamEntry(streamKey, event, payload);
      } catch (error) {
        console.warn(
          '[chat-stream] redis publish failed:',
          error instanceof Error ? error.message : error,
        );
      }
    },
  };
}

/**
 * GET `/chat/stream?chatStreamSessionId=...&from=...` — replay / tail Agent chat SSE from Redis.
 */
export async function handleChatStreamSubscribe(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const chatStreamSessionId = url.searchParams.get('chatStreamSessionId')?.trim();
  const from = url.searchParams.get('from')?.trim() || REDIS_STREAM_CURSOR_START;

  if (!chatStreamSessionId) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', ...corsHeaders() });
    res.end(JSON.stringify({ ok: false, error: 'Missing chatStreamSessionId query parameter.' }));
    return;
  }

  if (!resolveRedisConfig()) {
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', ...corsHeaders() });
    res.end(JSON.stringify({ ok: false, error: 'Redis is not configured for chat stream replay.' }));
    return;
  }

  const streamKey = chatStreamKeyForSession(chatStreamSessionId);
  const abortController = new AbortController();

  req.on('close', () => {
    abortController.abort();
  });

  try {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'x-accel-buffering': 'no',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      ...corsHeaders(),
    });

    writeSse(res, 'ready', {
      ok: true,
      chatStreamSessionId,
      from,
    });

    void maybeResumeInterruptedChatTurn(req, chatStreamSessionId);

    const heartbeat = setInterval(() => {
      if (abortController.signal.aborted || res.writableEnded) {
        return;
      }
      try {
        writeSseComment(res);
      } catch {
        abortController.abort();
      }
    }, CHAT_STREAM_SSE_HEARTBEAT_MS);

    try {
      for await (const entry of readRedisStream(streamKey, from, abortController.signal)) {
        const base =
          entry.payload && typeof entry.payload === 'object'
            ? (entry.payload as Record<string, unknown>)
            : {};
        const data: Record<string, unknown> = { ...base, streamEntryId: entry.id };
        writeSse(res, entry.eventType, data);
        if (entry.eventType === 'done' || entry.eventType === 'error') {
          break;
        }
      }
    } finally {
      clearInterval(heartbeat);
    }
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', ...corsHeaders() });
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return;
    }

    writeSse(res, 'error', {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
}
