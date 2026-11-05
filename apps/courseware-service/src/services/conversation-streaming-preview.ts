// SPDX-License-Identifier: AGPL-3.0-only
import { dataSource } from "../db/db.ts";
import { CoursewareConversation } from "../models/courseware-conversation.ts";
// TypeORM's deep-partial type rejects jsonb (Record) columns; values pass through.
import type { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity.js";
import { chatUiBlocksToPlainText, type ChatUiAssistantBlock } from "./chat-ui-events.ts";
import {
  CHAT_STREAMING_PREVIEW_METADATA_KEY,
  type ChatStreamingPreview,
} from "./conversation-message-merge.ts";

export { CHAT_STREAMING_PREVIEW_METADATA_KEY, type ChatStreamingPreview } from "./conversation-message-merge.ts";

export async function setChatStreamingPreview(
  conversationId: string,
  preview: ChatStreamingPreview | null,
): Promise<void> {
  if (!dataSource.isInitialized) {
    return;
  }
  const repo = dataSource.getRepository(CoursewareConversation);
  const row = await repo.findOne({
    where: { id: conversationId },
    select: ["id", "metadata"],
  });
  if (!row) {
    return;
  }
  const metadata: Record<string, unknown> = { ...(row.metadata ?? {}) };
  if (preview) {
    metadata[CHAT_STREAMING_PREVIEW_METADATA_KEY] = preview;
  } else {
    delete metadata[CHAT_STREAMING_PREVIEW_METADATA_KEY];
  }
  await repo.update(
    { id: conversationId },
    {
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
      updatedAt: new Date(),
    } as QueryDeepPartialEntity<CoursewareConversation>,
  );
}

const DEFAULT_STREAMING_PREVIEW_INTERVAL_MS = 5_000;

export function createThrottledStreamingPreviewSync(
  conversationId: string,
  options?: { intervalMs?: number },
): {
  notify: (blocks: readonly ChatUiAssistantBlock[]) => void;
  flush: () => Promise<void>;
  dispose: () => void;
} {
  const intervalMs = options?.intervalMs ?? DEFAULT_STREAMING_PREVIEW_INTERVAL_MS;
  let pendingBlocks: ChatUiAssistantBlock[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastFlushAt = 0;
  let lastWrittenKey = '';
  let inFlight: Promise<void> | undefined;

  const runFlush = async (): Promise<void> => {
    const blocks = pendingBlocks;
    const content = chatUiBlocksToPlainText(blocks);
    if (!content && blocks.length === 0) {
      return;
    }
    const writeKey = `${content}\0${blocks.length}`;
    if (writeKey === lastWrittenKey) {
      lastFlushAt = Date.now();
      return;
    }
    lastWrittenKey = writeKey;
    await setChatStreamingPreview(conversationId, {
      active: true,
      updatedAt: new Date().toISOString(),
      content,
      blocks: [...blocks],
    });
    lastFlushAt = Date.now();
  };

  const flush = async (): Promise<void> => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (inFlight) {
      await inFlight;
    }
    inFlight = runFlush().finally(() => {
      inFlight = undefined;
    });
    await inFlight;
  };

  const schedule = (): void => {
    if (timer !== undefined) {
      return;
    }
    const elapsed = Date.now() - lastFlushAt;
    const delay = lastFlushAt === 0 ? 0 : Math.max(0, intervalMs - elapsed);
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, delay);
  };

  const notify = (blocks: readonly ChatUiAssistantBlock[]): void => {
    pendingBlocks = blocks.length > 0 ? [...blocks] : [];
    if (pendingBlocks.length === 0 && chatUiBlocksToPlainText(pendingBlocks) === "") {
      return;
    }
    if (lastFlushAt === 0) {
      void flush();
      return;
    }
    schedule();
  };

  const dispose = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return { notify, flush, dispose };
}
