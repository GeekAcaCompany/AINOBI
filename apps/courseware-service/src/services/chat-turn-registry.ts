// SPDX-License-Identifier: AGPL-3.0-only
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';

import { redisClient } from '../db/db.ts';
import { ensureSharedRedisConnected } from '../db/redis-shared.ts';
import { REDIS_STREAM_TTL_SECONDS, resolveRedisConfig } from '../db/redis-stream.ts';

/** Snapshot of POST `/chat/stream` body stored for interrupted-turn resume. */
export type ChatTurnRequestSnapshot = {
  prompt?: string;
  message?: string;
  editorContext?: string;
  sessionId?: string;
  conversationId?: string;
  coursewareKey?: string;
  coursewareId?: string;
  livePreviewSessionId?: string;
  chatStreamSessionId?: string;
  model?: string;
  baseUrl?: string;
  maxTurns?: number;
  permissionMode?: PermissionMode;
  /** Set when resuming after interruption; only the hidden resume nudge is sent to the SDK. */
  resumeInterruptedTurn?: boolean;
  referencedCourseware?: Array<{
    id: string;
    key: string;
    title: string;
    courseId?: string;
    courseTitle?: string;
  }>;
  referencedDesignTemplates?: Array<{
    id: string;
    name: string;
  }>;
  referencedContentTemplates?: Array<{
    id: string;
    name: string;
  }>;
};

export type ChatTurnStatus = 'running' | 'done' | 'error' | 'cancelled';

export type ChatTurnRecord = {
  status: ChatTurnStatus;
  chatStreamSessionId: string;
  conversationId?: string;
  claudeSessionId?: string;
  coursewareId?: string;
  livePreviewSessionId?: string;
  coursewareKey?: string;
  request: ChatTurnRequestSnapshot;
  userId?: string;
  updatedAt: string;
};

const turnKey = (chatStreamSessionId: string): string =>
  `ainobi:chat:turn:${chatStreamSessionId.trim()}`;

const resumeLockKey = (chatStreamSessionId: string): string =>
  `ainobi:chat:turn:resume-lock:${chatStreamSessionId.trim()}`;

async function sharedRedis() {
  if (!(await ensureSharedRedisConnected())) {
    return null;
  }
  return redisClient;
}

export async function saveChatTurn(record: ChatTurnRecord): Promise<void> {
  if (!resolveRedisConfig()) {
    return;
  }
  const redis = await sharedRedis();
  if (!redis) {
    return;
  }
  await redis.set(turnKey(record.chatStreamSessionId), JSON.stringify(record), 'EX', REDIS_STREAM_TTL_SECONDS);
}

export async function getChatTurn(chatStreamSessionId: string): Promise<ChatTurnRecord | null> {
  if (!resolveRedisConfig()) {
    return null;
  }
  const redis = await sharedRedis();
  if (!redis) {
    return null;
  }
  try {
    const raw = await redis.get(turnKey(chatStreamSessionId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as ChatTurnRecord;
    if (!parsed?.chatStreamSessionId || !parsed.request) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function updateChatTurnStatus(
  chatStreamSessionId: string,
  status: ChatTurnStatus,
  fields?: Partial<Pick<ChatTurnRecord, 'claudeSessionId' | 'conversationId'>>,
): Promise<void> {
  const existing = await getChatTurn(chatStreamSessionId);
  if (!existing) {
    return;
  }
  await saveChatTurn({
    ...existing,
    ...fields,
    status,
    updatedAt: new Date().toISOString(),
  });
}

/** Prevent duplicate resume when multiple subscribers connect at once. */
export async function tryAcquireChatResumeLock(chatStreamSessionId: string): Promise<boolean> {
  if (!resolveRedisConfig()) {
    return false;
  }
  const redis = await sharedRedis();
  if (!redis) {
    return false;
  }
  const result = await redis.set(resumeLockKey(chatStreamSessionId), '1', 'EX', 120, 'NX');
  return result === 'OK';
}

export async function releaseChatResumeLock(chatStreamSessionId: string): Promise<void> {
  if (!resolveRedisConfig()) {
    return;
  }
  const redis = await sharedRedis();
  if (!redis) {
    return;
  }
  await redis.del(resumeLockKey(chatStreamSessionId));
}
