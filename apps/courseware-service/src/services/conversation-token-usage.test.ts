// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { conversationTokenUsageDto } from "./conversation-chat-history.ts";
import { normalizeConversationTokenUsageDelta } from "./conversation-service.ts";

test("normalizeConversationTokenUsageDelta ignores empty usage", () => {
  assert.equal(normalizeConversationTokenUsageDelta(null), null);
  assert.equal(normalizeConversationTokenUsageDelta({}), null);
  assert.equal(
    normalizeConversationTokenUsageDelta({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheTokens: 0,
    }),
    null,
  );
});

test("normalizeConversationTokenUsageDelta floors and fills total", () => {
  const delta = normalizeConversationTokenUsageDelta({
    inputTokens: 10.9,
    outputTokens: 3,
    cacheTokens: 2,
  });
  assert.deepEqual(delta, {
    inputTokens: 10,
    outputTokens: 3,
    totalTokens: 15,
    cacheTokens: 2,
  });
});

test("conversationTokenUsageDto reads bigint strings", () => {
  assert.deepEqual(
    conversationTokenUsageDto({
      inputTokens: "100",
      outputTokens: "20",
      totalTokens: "150",
      cacheTokens: "30",
    }),
    {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 150,
      cacheTokens: 30,
    },
  );
});
