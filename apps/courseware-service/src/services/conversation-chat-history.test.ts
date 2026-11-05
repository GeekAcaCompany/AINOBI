// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { rebuildChatMessagesFromTranscript } from "./conversation-chat-history.ts";

test("rebuildChatMessagesFromTranscript assigns distinct ids to assistant and user turns", () => {
  const sharedUuid = "87b8d412-0a7f-441d-934c-d381c504d5f3";
  const messages = rebuildChatMessagesFromTranscript([
    {
      type: "assistant",
      message: {
        type: "assistant",
        content: [{ type: "text", text: "Moving the line down." }],
      },
    },
    {
      type: "user",
      uuid: sharedUuid,
      message: {
        type: "user",
        content: [{ type: "text", text: "背景元素的底下那条横线应该再下一些" }],
      },
    },
  ] as never[]);

  assert.equal(messages.length, 2);
  const ids = messages.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes(sharedUuid));
  assert.ok(ids.some((id) => id.startsWith("a_hist_")));
});

test("rebuildChatMessagesFromTranscript omits rows with exposeInUserChat false", () => {
  const messages = rebuildChatMessagesFromTranscript([
    {
      entry: {
        type: "assistant",
        message: {
          type: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool_skill_1",
              name: "Skill",
              input: { skill: "ainobi-courseware-cli", args: "status check" },
            },
          ],
        },
      },
      exposeInUserChat: true,
    },
    {
      entry: {
        type: "user",
        uuid: "skill-inject-uuid",
        message: {
          type: "user",
          content: [
            {
              type: "text",
              text: "Base directory for this skill: /repo/.claude/skills/ainobi-courseware-cli\n\n# AINOBI Courseware CLI\n\nARGUMENTS: status check",
            },
          ],
        },
      },
      exposeInUserChat: false,
    },
    {
      entry: {
        type: "user",
        message: {
          type: "user",
          content: [{ type: "tool_result", tool_use_id: "tool_skill_1", content: "Launching skill: ainobi-courseware-cli" }],
        },
      },
      exposeInUserChat: true,
    },
    {
      entry: {
        type: "assistant",
        message: {
          type: "assistant",
          content: [{ type: "text", text: "Scene is ready." }],
        },
      },
      exposeInUserChat: true,
    },
    {
      entry: {
        type: "user",
        uuid: "real-user-uuid",
        message: {
          type: "user",
          content: [{ type: "text", text: "请继续下一页" }],
        },
      },
      exposeInUserChat: true,
    },
  ]);

  assert.equal(messages.some((m) => m.id === "skill-inject-uuid"), false);
  assert.equal(messages.some((m) => m.role === "user" && m.content.includes("AINOBI Courseware CLI")), false);
  assert.deepEqual(
    messages.filter((m) => m.role === "user").map((m) => m.content),
    ["请继续下一页"],
  );
  assert.ok(messages.some((m) => m.role === "assistant" && m.content.includes("Scene is ready")));
});

test("rebuildChatMessagesFromTranscript maps AskUserQuestion to user_question blocks", () => {
  const messages = rebuildChatMessagesFromTranscript([
    {
      type: "assistant",
      message: {
        type: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool_ask_1",
            name: "AskUserQuestion",
            input: {
              questions: [
                {
                  question: "还有哪些必须覆盖的知识点？",
                  header: "补充",
                  freeText: true,
                },
              ],
            },
          },
        ],
      },
    },
    {
      type: "user",
      message: {
        type: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool_ask_1",
            content: JSON.stringify({ answers: { "还有哪些必须覆盖的知识点？": "光合作用" } }),
          },
        ],
      },
    },
  ] as never[]);

  assert.equal(messages.length, 1);
  const assistant = messages[0];
  assert.equal(assistant?.role, "assistant");
  const questionBlock = assistant?.blocks?.find((b) => b.type === "user_question");
  assert.ok(questionBlock);
  assert.equal(questionBlock?.type, "user_question");
  if (questionBlock?.type === "user_question") {
    assert.equal(questionBlock.toolUseId, "tool_ask_1");
    assert.equal(questionBlock.requestId, "history:tool_ask_1");
    assert.equal(questionBlock.answered, true);
    assert.equal(questionBlock.questions[0]?.freeText, true);
    assert.equal(questionBlock.questions[0]?.header, "补充");
  }
  assert.equal(assistant?.blocks?.some((b) => b.type === "tool"), false);
});
