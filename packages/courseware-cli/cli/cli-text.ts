// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Decode `\n`, `\t`, etc. in CLI flag / --set values (same rules as patch.ts --set).
 * Bash single-quoted args pass literal backslash-n; double-quoted args may already be real newlines.
 *
 * Unknown `\x` sequences (e.g. `\!` from agent over-escaping in single quotes) drop the
 * backslash so `Hello, World\!` becomes `Hello, World!`. Use `\\!` or `--set text:raw=…`
 * when a literal backslash before punctuation is intended.
 */
export const decodeStringEscapes = (raw: string): string => {
  if (!raw.includes("\\")) return raw;
  return raw.replace(/\\(?:u([0-9a-fA-F]{4})|(.))/g, (match, unicode, ch) => {
    if (unicode) return String.fromCharCode(Number.parseInt(unicode, 16));
    if (ch === undefined) return match;
    switch (ch) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "\\":
        return "\\";
      case "\"":
        return "\"";
      case "'":
        return "'";
      default:
        return ch;
    }
  });
};

/** Normalize narration / multiline CLI text: CRLF → LF, then decode `\n` sequences (up to 2 passes for `\\n`). */
export const normalizeMultilineCliText = (raw: string): string => {
  let out = raw.replace(/\r\n/g, "\n");
  for (let pass = 0; pass < 2; pass += 1) {
    const next = decodeStringEscapes(out);
    if (next === out) break;
    out = next;
  }
  return out;
};
