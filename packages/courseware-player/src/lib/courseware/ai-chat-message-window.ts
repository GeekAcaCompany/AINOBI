// SPDX-License-Identifier: AGPL-3.0-only
/** Number of recent conversation turns fully rendered by default (one turn = a user message + the assistant replies after it) */
export const AI_CHAT_RECENT_ROUNDS = 5;

/** Expand earlier turns when scrolled near the top of the list */
export const AI_CHAT_SCROLL_TOP_REVEAL_PX = 48;

export type AiChatRound<T extends { role: "user" | "assistant" }> = {
  messages: T[];
  /** Index of the turn's first message in the flat list */
  startIndex: number;
};

/**
 * Split the flat message list into turns of "user starts → following assistant messages".
 * Leading assistant-only messages form a turn of their own; a trailing user-only message forms its own turn too.
 */
export function splitChatMessagesIntoRounds<T extends { role: "user" | "assistant" }>(
  messages: readonly T[],
): AiChatRound<T>[] {
  if (messages.length === 0) return [];

  const rounds: AiChatRound<T>[] = [];
  let current: T[] = [];
  let startIndex = 0;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "user") {
      if (current.length > 0) {
        rounds.push({ messages: current, startIndex });
        current = [];
      }
      startIndex = i;
      current = [m];
      continue;
    }
    if (current.length === 0) {
      startIndex = i;
    }
    current.push(m);
  }

  if (current.length > 0) {
    rounds.push({ messages: current, startIndex });
  }

  return rounds;
}

export type AiChatListWindowSlice<T> = {
  visibleMessages: T[];
  visibleStartIndex: number;
  hiddenRoundCount: number;
  hiddenMessageCount: number;
};

export function getAiChatListWindowSlice<T extends { role: "user" | "assistant" }>(args: {
  messages: readonly T[];
  rounds: readonly AiChatRound<T>[];
  recentRounds?: number;
  olderRoundsRevealed: boolean;
}): AiChatListWindowSlice<T> {
  const recentRounds = args.recentRounds ?? AI_CHAT_RECENT_ROUNDS;
  const hiddenRoundCount = Math.max(0, args.rounds.length - recentRounds);

  if (args.olderRoundsRevealed || hiddenRoundCount === 0 || args.messages.length === 0) {
    return {
      visibleMessages: [...args.messages],
      visibleStartIndex: 0,
      hiddenRoundCount: 0,
      hiddenMessageCount: 0,
    };
  }

  const firstVisibleRound = args.rounds[args.rounds.length - recentRounds];
  const visibleStartIndex = firstVisibleRound?.startIndex ?? 0;

  return {
    visibleMessages: args.messages.slice(visibleStartIndex),
    visibleStartIndex,
    hiddenRoundCount,
    hiddenMessageCount: visibleStartIndex,
  };
}
