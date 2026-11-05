// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgentQueryPrompt,
  buildEditorContextTranscriptEntry,
  CHAT_STREAM_RECOVERY_USER_PROMPT,
  CHAT_TURN_RESUME_TRANSCRIPT_HEADER,
  isChatTurnResumeContextText,
  isCoursewareEditorContextText,
  isHiddenTranscriptUserContextText,
  joinUserMessageText,
  trySplitMirroredUserEntry,
} from "./transcript-editor-context.ts";
import { computeExposeInUserChat } from "./transcript-entry-ui.ts";

test("buildAgentQueryPrompt joins user, editor, and live preview", () => {
  const built = buildAgentQueryPrompt({
    userPrompt: "改标题",
    editorContext: "[Courseware Editor Context]\nCurrent Page: 1 of 1.",
    livePreviewAppend: "[AINOBI Live Preview Session]\nlive_preview_session_id: abc",
  });
  assert.equal(built.userPrompt, "改标题");
  assert.ok(built.queryPrompt.includes("改标题"));
  assert.ok(built.queryPrompt.includes("[Courseware Editor Context]"));
  assert.ok(built.queryPrompt.includes("[AINOBI Live Preview Session]"));
});

test("trySplitMirroredUserEntry splits combined SDK user line", () => {
  const pending = {
    userPrompt: "用户输入",
    editorContext: "[Courseware Editor Context]\npage 1",
    queryPrompt: "用户输入\n\n[Courseware Editor Context]\npage 1",
  };
  const combined = {
    type: "user",
    uuid: "u-combined",
    message: {
      type: "user",
      content: [{ type: "text", text: pending.queryPrompt }],
    },
  } as never;

  const split = trySplitMirroredUserEntry(combined, pending);
  assert.equal(split?.length, 2);
  const editorText = joinUserMessageText(split![0]!);
  assert.ok(editorText && isCoursewareEditorContextText(editorText));
  const userText = joinUserMessageText(split![1]!);
  assert.equal(userText, "用户输入");
});

test("plan-mode courseware context is hidden from user chat", () => {
  const planContext =
    "[Courseware Plan Context]\nThe current courseware already has 2 slide(s).";
  assert.ok(isHiddenTranscriptUserContextText(planContext));
  assert.equal(
    computeExposeInUserChat({
      type: "user",
      message: {
        type: "user",
        content: [{ type: "text", text: planContext }],
      },
    } as never),
    false,
  );
});

test("buildEditorContextTranscriptEntry is not user-chat visible", () => {
  const entry = buildEditorContextTranscriptEntry("[Courseware Editor Context]\nline");
  assert.equal((entry as { shouldQuery?: boolean }).shouldQuery, false);
});

test("interrupted-turn resume prompt is hidden from user chat", () => {
  assert.ok(CHAT_STREAM_RECOVERY_USER_PROMPT.startsWith(CHAT_TURN_RESUME_TRANSCRIPT_HEADER));
  assert.ok(isChatTurnResumeContextText(CHAT_STREAM_RECOVERY_USER_PROMPT));
  assert.ok(isHiddenTranscriptUserContextText(CHAT_STREAM_RECOVERY_USER_PROMPT));
  assert.equal(
    computeExposeInUserChat({
      type: "user",
      message: {
        type: "user",
        content: [{ type: "text", text: CHAT_STREAM_RECOVERY_USER_PROMPT }],
      },
    } as never),
    false,
  );
  assert.ok(!CHAT_STREAM_RECOVERY_USER_PROMPT.toLowerCase().includes("already completed"));
});
