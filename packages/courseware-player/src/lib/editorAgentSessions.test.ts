// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import {
  createEmptyAgentSession,
  dedupeEditorAgentSessions,
  mergeRemoteConversationSessions,
  resolvePreferredActiveSessionId,
  type EditorAgentSession,
} from "./editorAgentSessions.ts";

function session(
  partial: Partial<EditorAgentSession> & Pick<EditorAgentSession, "id">,
): EditorAgentSession {
  const now = Date.now();
  return {
    title: "",
    chatMessages: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

describe("resolvePreferredActiveSessionId", () => {
  it("prefers remembered conversation id over list order", () => {
    const sessions = [
      session({ id: "conv-new", conversationId: "conv-new" }),
      session({ id: "conv-old", conversationId: "conv-old" }),
    ];
    expect(
      resolvePreferredActiveSessionId(sessions, { preferredConversationId: "conv-old" }),
    ).toBe("conv-old");
  });
});

describe("mergeRemoteConversationSessions", () => {
  it("binds a pending local draft to the remote conversation instead of duplicating", () => {
    const localDraft = session({
      id: "local-draft",
      chatMessages: [{ id: "m1", role: "user", content: "hi" }],
    });
    const existing = session({
      id: "conv-old",
      conversationId: "conv-old",
      chatMessages: [{ id: "m0", role: "user", content: "older" }],
    });

    const merged = mergeRemoteConversationSessions(
      { activeSessionId: localDraft.id, sessions: [localDraft, existing] },
      [
        {
          conversationId: "conv-new",
          title: null,
          claudeSessionId: null,
          livePreviewSessionId: null,
          messageCount: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          conversationId: "conv-old",
          title: null,
          claudeSessionId: null,
          livePreviewSessionId: null,
          messageCount: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    );

    expect(merged.sessions).toHaveLength(2);
    const bound = merged.sessions.find((s) => s.conversationId === "conv-new");
    expect(bound?.id).toBe("local-draft");
    expect(bound?.chatMessages).toHaveLength(1);
    expect(bound?.chatMessages[0]?.content).toBe("hi");
  });
});

describe("dedupeEditorAgentSessions", () => {
  it("keeps the session with messages when conversationId duplicates", () => {
    const rich = session({
      id: "local-draft",
      conversationId: "conv-1",
      chatMessages: [{ id: "m1", role: "user", content: "hello" }],
    });
    const emptyRemote = session({
      id: "conv-1",
      conversationId: "conv-1",
      chatMessages: [],
    });

    const deduped = dedupeEditorAgentSessions({
      activeSessionId: rich.id,
      sessions: [rich, emptyRemote],
    });

    expect(deduped.sessions).toHaveLength(1);
    expect(deduped.sessions[0]?.id).toBe("local-draft");
    expect(deduped.sessions[0]?.chatMessages).toHaveLength(1);
  });
});
