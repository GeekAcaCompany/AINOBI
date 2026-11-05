// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  AI_CHAT_RECENT_ROUNDS,
  getAiChatListWindowSlice,
  splitChatMessagesIntoRounds,
} from "./ai-chat-message-window.ts";

type Msg = { id: string; role: "user" | "assistant"; content: string };

const u = (id: string): Msg => ({ id, role: "user", content: id });
const a = (id: string): Msg => ({ id, role: "assistant", content: id });

describe("splitChatMessagesIntoRounds", () => {
  it("groups user then assistant as one round", () => {
    const rounds = splitChatMessagesIntoRounds([u("1"), a("2")]);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].messages.map((m) => m.id)).toEqual(["1", "2"]);
    expect(rounds[0].startIndex).toBe(0);
  });

  it("splits multiple user-assistant pairs", () => {
    const rounds = splitChatMessagesIntoRounds([u("1"), a("2"), u("3"), a("4")]);
    expect(rounds).toHaveLength(2);
    expect(rounds[1].startIndex).toBe(2);
  });

  it("keeps leading assistant-only messages as first round", () => {
    const rounds = splitChatMessagesIntoRounds([a("0"), u("1"), a("2")]);
    expect(rounds[0].messages[0].id).toBe("0");
    expect(rounds[1].startIndex).toBe(1);
  });
});

describe("getAiChatListWindowSlice", () => {
  const messages = Array.from({ length: 12 }, (_, i) =>
    i % 2 === 0 ? u(`u${i}`) : a(`a${i}`),
  );
  const rounds = splitChatMessagesIntoRounds(messages);

  it("shows only recent rounds when collapsed", () => {
    const slice = getAiChatListWindowSlice({
      messages,
      rounds,
      recentRounds: AI_CHAT_RECENT_ROUNDS,
      olderRoundsRevealed: false,
    });
    expect(slice.hiddenRoundCount).toBe(rounds.length - AI_CHAT_RECENT_ROUNDS);
    expect(slice.visibleMessages.length).toBeLessThan(messages.length);
    expect(slice.visibleStartIndex).toBeGreaterThan(0);
  });

  it("shows all messages when revealed", () => {
    const slice = getAiChatListWindowSlice({
      messages,
      rounds,
      olderRoundsRevealed: true,
    });
    expect(slice.visibleMessages).toHaveLength(messages.length);
    expect(slice.hiddenRoundCount).toBe(0);
  });
});
