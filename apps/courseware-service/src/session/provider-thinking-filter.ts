// SPDX-License-Identifier: AGPL-3.0-only
import type { SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";

/** Plaintext reasoning block emitted under the Anthropic protocol (DeepSeek and native Claude turns) */
const PLAINTEXT_THINKING = "thinking";
/** Encrypted reasoning block the ai-gateway encodes an OpenAI model's reasoning output into */
const REDACTED_THINKING = "redacted_thinking";

/**
 * Drop reasoning blocks that belong to the *other* provider family when a stored conversation
 * resumes under a model reached through a different protocol.
 *
 * The ai-gateway translates the Anthropic transcript into OpenAI Responses input items. A plaintext
 * `thinking` block becomes a `reasoning` item that carries `reasoning_text`, and OpenAI rejects
 * that shape on replay (`Invalid 'input[N].content': array too long ...`), failing the turn with
 * "All target providers failed". Bridge-native turns only ever carry `redacted_thinking`
 * (encrypted), which converts to a bare `reasoning` item OpenAI accepts.
 *
 * The inverse direction is equally useless: DeepSeek's Anthropic-compatible endpoint has no way to
 * interpret the gateway's opaque redacted blobs.
 *
 * Text, tool_use and tool_result blocks are never touched; a turn that consisted only of the
 * foreign reasoning block is dropped entirely, since it carries nothing replayable.
 */
export function stripForeignThinkingBlocks(
  entries: SessionStoreEntry[],
  target: { viaOpenAiBridge: boolean },
): SessionStoreEntry[] {
  const foreignType = target.viaOpenAiBridge ? PLAINTEXT_THINKING : REDACTED_THINKING;
  let changed = false;

  const out: SessionStoreEntry[] = [];
  for (const entry of entries) {
    const rec = entry as Record<string, unknown>;
    if (rec.type !== "assistant") {
      out.push(entry);
      continue;
    }
    const message = rec.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) {
      out.push(entry);
      continue;
    }
    const kept = content.filter((block) => {
      if (!block || typeof block !== "object") return true;
      return (block as { type?: unknown }).type !== foreignType;
    });
    if (kept.length === content.length) {
      out.push(entry);
      continue;
    }
    changed = true;
    if (kept.length === 0) {
      continue;
    }
    out.push({ ...entry, message: { ...message, content: kept } });
  }

  return changed ? out : entries;
}
