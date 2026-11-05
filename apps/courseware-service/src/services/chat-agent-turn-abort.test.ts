// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  abortLocalChatTurn,
  registerChatTurnAbort,
  unregisterChatTurnAbort,
} from "./chat-agent-turn-runner.ts";

test("aborts a registered in-process turn", () => {
  const controller = new AbortController();
  registerChatTurnAbort("stream-1", controller);
  assert.equal(abortLocalChatTurn("stream-1"), true);
  assert.equal(controller.signal.aborted, true);
  unregisterChatTurnAbort("stream-1");
});

test("returns false when no local turn is registered", () => {
  assert.equal(abortLocalChatTurn("missing-stream"), false);
});
