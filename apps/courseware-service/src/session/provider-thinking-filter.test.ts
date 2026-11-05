// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import type { SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";

import { stripForeignThinkingBlocks } from "./provider-thinking-filter.ts";

function assistant(content: unknown[]): SessionStoreEntry {
  return { type: "assistant", message: { type: "assistant", content } } as never;
}

test("drops plaintext thinking when resuming through the OpenAI bridge", () => {
  const entries = [
    assistant([
      { type: "thinking", thinking: "The user says hi", signature: "sig" },
      { type: "text", text: "收到。" },
    ]),
  ];
  const out = stripForeignThinkingBlocks(entries, { viaOpenAiBridge: true });
  assert.deepEqual((out[0] as never as { message: { content: unknown[] } }).message.content, [
    { type: "text", text: "收到。" },
  ]);
});

test("keeps redacted_thinking when resuming through the OpenAI bridge", () => {
  const entries = [
    assistant([
      { type: "redacted_thinking", data: "encrypted" },
      { type: "text", text: "好的。" },
    ]),
  ];
  const out = stripForeignThinkingBlocks(entries, { viaOpenAiBridge: true });
  assert.equal(out, entries, "nothing to rewrite, the same array comes back");
});

test("drops redacted_thinking when resuming on a native Anthropic-protocol model", () => {
  const entries = [
    assistant([
      { type: "redacted_thinking", data: "encrypted" },
      { type: "text", text: "好的。" },
    ]),
  ];
  const out = stripForeignThinkingBlocks(entries, { viaOpenAiBridge: false });
  assert.deepEqual((out[0] as never as { message: { content: unknown[] } }).message.content, [
    { type: "text", text: "好的。" },
  ]);
});

test("keeps plaintext thinking on a native Anthropic-protocol model", () => {
  const entries = [assistant([{ type: "thinking", thinking: "推理", signature: "sig" }])];
  const out = stripForeignThinkingBlocks(entries, { viaOpenAiBridge: false });
  assert.equal(out, entries);
});

test("a turn that only carried the foreign reasoning block is dropped", () => {
  const entries = [
    { type: "user", message: { type: "user", content: [{ type: "text", text: "第一条" }] } },
    assistant([{ type: "thinking", thinking: "只有思考", signature: "sig" }]),
    { type: "user", message: { type: "user", content: [{ type: "text", text: "第二条" }] } },
  ] as SessionStoreEntry[];
  const out = stripForeignThinkingBlocks(entries, { viaOpenAiBridge: true });
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((e) => (e as never as { type: string }).type),
    ["user", "user"],
  );
});

test("tool_use and text blocks survive; user entries are untouched", () => {
  const entries = [
    assistant([
      { type: "thinking", thinking: "想", signature: "sig" },
      { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ainobi help" } },
    ]),
  ];
  const out = stripForeignThinkingBlocks(entries, { viaOpenAiBridge: true });
  assert.deepEqual((out[0] as never as { message: { content: unknown[] } }).message.content, [
    { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ainobi help" } },
  ]);
});
