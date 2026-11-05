// SPDX-License-Identifier: AGPL-3.0-only
import { AinobiCliError } from "./errors.ts";

/**
 * U+FFFD (the Unicode replacement character, rendered as `�`) only appears in text when
 * some step decoded a UTF-8 byte sequence that had been cut mid-character — e.g. an
 * agent wrapping a transcript with `awk substr` / `cut -c` / `printf %.Ns` / `head -c`
 * under a non-UTF-8 locale, which count bytes, not characters. It is never legitimate
 * courseware copy, so reject any write that introduces it.
 */
export const REPLACEMENT_CHAR = "�";

const MAX_REPORTED_ISSUES = 10;
const SNIPPET_RADIUS = 20;

type ReplacementCharHit = { path: string; value: string };

const collectHits = (value: unknown, path: string, out: ReplacementCharHit[]): void => {
  if (typeof value === "string") {
    if (value.includes(REPLACEMENT_CHAR)) out.push({ path, value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectHits(item, `${path}[${index}]`, out));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collectHits(child, path ? `${path}.${key}` : key, out);
    }
  }
};

export const findReplacementCharStrings = (value: unknown, rootPath = ""): ReplacementCharHit[] => {
  const out: ReplacementCharHit[] = [];
  collectHits(value, rootPath, out);
  return out;
};

const snippetAround = (value: string): string => {
  const index = value.indexOf(REPLACEMENT_CHAR);
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(value.length, index + SNIPPET_RADIUS + 1);
  return `${start > 0 ? "…" : ""}${value.slice(start, end)}${end < value.length ? "…" : ""}`;
};

const throwReplacementCharError = (hits: ReplacementCharHit[]): never => {
  throw new AinobiCliError(
    "INVALID_INPUT",
    `Text contains the Unicode replacement character "${REPLACEMENT_CHAR}" (U+FFFD) — corrupted UTF-8, refusing to write it into the courseware.`,
    {
      hint:
        "A multi-byte character (Chinese / Japanese) was cut in half, usually by byte-based shell text tools " +
        "(`awk substr`, `cut -c`, `printf %.Ns`, `head -c`, `dd`). Rewrite the affected text from the original source " +
        "without shell truncation (write it by hand, or split lines in Node/Python on characters), then retry.",
      issues: hits.slice(0, MAX_REPORTED_ISSUES).map((hit) => ({
        path: hit.path,
        message: `contains U+FFFD: ${JSON.stringify(snippetAround(hit.value))}`,
      })),
    },
  );
};

/**
 * Reject U+FFFD in raw text flags before any side effect (e.g. `narration insert` runs
 * paid TTS before the scene is saved). `fields` maps a flag label to its value.
 */
export const assertNoReplacementCharsInFlags = (
  fields: Record<string, string | undefined>,
): void => {
  const hits = Object.entries(fields).flatMap(([path, value]) =>
    value?.includes(REPLACEMENT_CHAR) ? [{ path, value }] : [],
  );
  if (hits.length === 0) return;
  throwReplacementCharError(hits);
};

/**
 * Throw when `next` carries more copies of a U+FFFD string than `previous` did.
 * Comparison is by string value and count (not path) so legacy `�` strings survive
 * reorders and unrelated edits, while newly introduced corruption — including an extra
 * copy of a legacy string — is rejected.
 */
export const assertNoNewReplacementChars = (
  previous: unknown,
  next: unknown,
  label = "scene",
): void => {
  const nextHits = findReplacementCharStrings(next, label);
  if (nextHits.length === 0) return;
  // Count occurrences, not just membership: a legacy corrupt string may move, but writing
  // an extra copy of it is new corruption (Codex review #143).
  const legacyCounts = new Map<string, number>();
  for (const hit of findReplacementCharStrings(previous)) {
    legacyCounts.set(hit.value, (legacyCounts.get(hit.value) ?? 0) + 1);
  }
  const introduced = nextHits.filter((hit) => {
    const remaining = legacyCounts.get(hit.value) ?? 0;
    if (remaining > 0) {
      legacyCounts.set(hit.value, remaining - 1);
      return false;
    }
    return true;
  });
  if (introduced.length === 0) return;
  throwReplacementCharError(introduced);
};
