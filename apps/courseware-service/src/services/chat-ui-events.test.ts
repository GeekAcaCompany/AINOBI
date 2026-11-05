// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyChatUiEventsToBlocks,
  extractLastAssistantText,
  chatUiBlocksToPlainText,
  createChatUiStreamState,
  mapSdkMessageToChatUiEvents,
  type ChatUiEvent,
} from "./chat-ui-events.ts";

function emitToolUse(
  state: ReturnType<typeof createChatUiStreamState>,
  toolUse: { id: string; name: string; input?: unknown },
): ChatUiEvent[] {
  return mapSdkMessageToChatUiEvents(state, {
    type: "assistant",
    message: { content: [{ type: "tool_use", ...toolUse }] },
  });
}

function emitToolResult(
  state: ReturnType<typeof createChatUiStreamState>,
  toolUseId: string,
  content: unknown,
  toolUseResult?: unknown,
): ChatUiEvent[] {
  return mapSdkMessageToChatUiEvents(state, {
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: toolUseId, content }] },
    tool_use_result: toolUseResult,
  });
}

test("Read tool output is summarized in English", () => {
  const state = createChatUiStreamState();
  emitToolUse(state, { id: "t1", name: "Read", input: { file_path: "scene.json" } });
  const events = emitToolResult(state, "t1", "raw file body", {
    file: { filePath: "scene.json", numLines: 12 },
  });
  assert.deepEqual(events, [
    { kind: "tool_output", toolUseId: "t1", output: "Read scene.json (12 lines)" },
  ]);
});

test("Read tool output without line count stays English", () => {
  const state = createChatUiStreamState();
  emitToolUse(state, { id: "t2", name: "Read", input: { file_path: "scene.json" } });
  const events = emitToolResult(state, "t2", "raw file body", {
    file: { filePath: "scene.json" },
  });
  assert.deepEqual(events, [{ kind: "tool_output", toolUseId: "t2", output: "Read scene.json" }]);
});

test("Read tool output without file metadata falls back to English label", () => {
  const state = createChatUiStreamState();
  emitToolUse(state, { id: "t3", name: "Read", input: { file_path: "scene.json" } });
  const events = emitToolResult(state, "t3", "raw file body", undefined);
  assert.deepEqual(events, [{ kind: "tool_output", toolUseId: "t3", output: "Read file" }]);
});

test("Skill tool output without string content falls back to English label", () => {
  const state = createChatUiStreamState();
  emitToolUse(state, { id: "s1", name: "Skill", input: { skill: "ainobi-courseware-cli" } });
  const events = emitToolResult(state, "s1", [], undefined);
  assert.deepEqual(events, [{ kind: "tool_output", toolUseId: "s1", output: "Skill loaded" }]);
});

test("Bash description passes through as the tool title", () => {
  const state = createChatUiStreamState();
  const events = emitToolUse(state, {
    id: "b1",
    name: "Bash",
    input: { command: "ainobi slide list", description: "List slides" },
  });
  assert.deepEqual(events, [
    {
      kind: "tool_start",
      toolUseId: "b1",
      toolName: "Bash",
      title: "List slides",
      command: "ainobi slide list",
    },
  ]);
});

test("plain-text rendering uses English structural labels only", () => {
  const blocks = applyChatUiEventsToBlocks(
    [],
    [
      { kind: "todos_update", todos: [{ content: "Draft outline", status: "in_progress" }] },
      {
        kind: "user_question",
        requestId: "r1",
        toolUseId: "q1",
        questions: [
          {
            question: "Which style?",
            header: "Style",
            options: [
              { label: "A", description: "clean" },
              { label: "B", description: "playful" },
            ],
            multiSelect: false,
          },
        ],
      },
      { kind: "tool_start", toolUseId: "t1", toolName: "Bash", title: "List slides" },
      { kind: "insufficient_org_credits" },
      { kind: "insufficient_personal_credits" },
    ],
  );

  const text = chatUiBlocksToPlainText(blocks);
  assert.match(text, /Tasks\n\[~\] Draft outline/);
  assert.match(text, /Pending confirmation\n\? Style: Which style\?/);
  assert.match(text, /· Bash: List slides/);
  assert.match(text, /Insufficient organization credits/);
  assert.match(text, /Insufficient personal credits/);
  assert.doesNotMatch(text, /[任务待确认组织个人额度不足：？]/);
});

test("extractLastAssistantText returns the last non-empty text block", () => {
  // After the gateway encodes a bridge model's (openai_responses) reasoning output, the CLI splits the trailing
  // redacted_thinking into a last text-less assistant message and the result comes back empty —
  // this helper restores the real reply from content.
  assert.equal(extractLastAssistantText(undefined), "");
  assert.equal(extractLastAssistantText([]), "");
  assert.equal(extractLastAssistantText([{ type: "text", text: "   " }]), "");
  assert.equal(
    extractLastAssistantText([
      { type: "text", text: "first" },
      { type: "tool_use", id: "t1" },
      { type: "text", text: "final reply" },
      { type: "redacted_thinking", data: "x" },
    ]),
    "final reply",
  );
});
