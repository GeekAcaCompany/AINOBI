// SPDX-License-Identifier: AGPL-3.0-only
/**
 * JSON wire format serialization.
 *
 * The established wire format of the response envelope and Redis sessions (locked by golden tests, verified on both ends 2026-10-14):
 * datetimes always in UTC `Z` suffix form, with exactly 6 digits when microseconds are non-zero
 * (e.g. 2026-09-20T05:00:46.128751Z; zero microseconds omit the fraction); UUID → string;
 * everything else goes to JSON.stringify.
 */

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/** Date → wire format (UTC, Z suffix, 6 digits when microseconds are non-zero). */
export function toPythonIso(date: Date): string {
  const y = date.getUTCFullYear();
  const mo = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  const h = pad(date.getUTCHours());
  const mi = pad(date.getUTCMinutes());
  const s = pad(date.getUTCSeconds());
  const ms = date.getUTCMilliseconds();
  // Output 6 digits when microseconds are non-zero (right-padded with zeros, e.g. 123ms → .123000)
  const frac = ms === 0 ? "" : `.${String(ms).padEnd(6, "0")}`;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${frac}Z`;
}

/**
 * Wire format of a naive datetime (timestamp without time zone column): no Z suffix,
 * no offset, exactly 6 digits when microseconds are non-zero.
 *
 * node-pg parses naive times into a Date in the **connection's local timezone** — the stored value is a naive wall-clock
 * literal, so the **local** getters must be used to recover the wall-clock components before building the zone-less form.
 */
export function toPythonNaiveIso(date: Date): string {
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  const ms = date.getMilliseconds();
  const frac = ms === 0 ? "" : `.${String(ms).padEnd(6, "0")}`;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${frac}`;
}

/**
 * Deep wire formatting: Date → isoformat string.
 * Note a JSON.stringify replacer cannot do this — the replacer runs after Date.toJSON(),
 * so it already receives a "…Z" string; convert deeply first, then serialize.
 */
function pythonize(value: unknown): unknown {
  if (value instanceof Date) {
    return toPythonIso(value);
  }
  if (Array.isArray(value)) {
    return value.map(pythonize);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) {
        continue;
      }
      result[key] = pythonize(item);
    }
    return result;
  }
  return value;
}

/**
 * Wire-format semantic wrapper around JSON.stringify:
 * - Date → toPythonIso (deep conversion, before toJSON)
 * - undefined properties → omitted (when an explicit null is needed, the business layer writes null)
 *
 * Serialization parameters of the two envelope paths (verified 2026-10-16):
 * - success envelope: non-ASCII as \uXXXX + separators (', ', ': ') (a space after commas/colons)
 *   → use { ascii: true, spacedSeparators: true }
 * - error envelope: non-ASCII as-is + compact separators (",", ":") → the default
 */
export function stringifyPython(value: unknown, options?: { ascii?: boolean; spacedSeparators?: boolean }): string {
  const json = JSON.stringify(pythonize(value));
  let result = json;
  if (options?.ascii) {
    result = escapeNonAscii(result);
  }
  if (options?.spacedSeparators) {
    result = spaceSeparators(result);
  }
  return result;
}

/** Add a space after : and , in structural positions (outside string literals) */
function spaceSeparators(json: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (const ch of json) {
    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      result += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }
    if (!inString && (ch === ":" || ch === ",")) {
      result += ch + " ";
      continue;
    }
    result += ch;
  }
  return result;
}

/**
 * Non-ASCII characters → \uXXXX (ensure_ascii=True form; each half of a surrogate pair escaped separately).
 * Only 0x20-0x7e is kept: besides quotes/backslash, 0x7f (DEL) is escaped as \u007f too
 * (verified 2026-10-21).
 */
function escapeNonAscii(json: string): string {
  let result = "";
  for (let i = 0; i < json.length; i++) {
    const code = json.charCodeAt(i);
    if (code >= 0x20 && code <= 0x7e) {
      result += json[i];
    } else {
      result += "\\u" + code.toString(16).padStart(4, "0");
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Default forms of urllib.parse.quote / json.dumps (the shared base of object storage signing and policy
// serialization; the byte-level contract is locked by golden tests)
// ---------------------------------------------------------------------------

/**
 * urllib quote semantics: RFC 3986 unreserved characters (A-Za-z0-9_.-~) and characters in the safe set
 * are kept as-is; everything else is percent-encoded per UTF-8 byte (uppercase hex).
 */
export function pyQuote(value: string, safe: string = ""): string {
  let out = "";
  for (const ch of value) {
    if (/[A-Za-z0-9_.\-~]/.test(ch) || safe.includes(ch)) {
      out += ch;
      continue;
    }
    const bytes = Buffer.from(ch, "utf8");
    for (const byte of bytes) {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

/**
 * json.dumps default form (ensure_ascii=True + separators ", " / ": ").
 * Covers the string/number/boolean/array/object/null value domain (used for signing inputs such as the presigned POST policy
 * ).
 */
export function pyJsonStringify(value: unknown): string {
  if (typeof value === "string") {
    return `"${pyJsonEscapeString(value)}"`;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => pyJsonStringify(item)).join(", ")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([k, v]) => `"${pyJsonEscapeString(k)}": ${pyJsonStringify(v)}`,
    );
    return `{${entries.join(", ")}}`;
  }
  return "null";
}

/** json.dumps string escaping (short escapes for control characters + non-ASCII as \uXXXX lowercase hex; surrogate pairs per code unit) */
function pyJsonEscapeString(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (ch === '"') {
      out += '\\"';
    } else if (ch === "\\") {
      out += "\\\\";
    } else if (ch === "\n") {
      out += "\\n";
    } else if (ch === "\r") {
      out += "\\r";
    } else if (ch === "\t") {
      out += "\\t";
    } else if (ch === "\b") {
      out += "\\b";
    } else if (ch === "\f") {
      out += "\\f";
    } else if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else if (code <= 0x7e) {
      out += ch;
    } else if (code <= 0xffff) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      // Astral characters: escape each UTF-16 code unit
      const v = code - 0x10000;
      const hi = 0xd800 + (v >> 10);
      const lo = 0xdc00 + (v & 0x3ff);
      out += `\\u${hi.toString(16).padStart(4, "0")}\\u${lo.toString(16).padStart(4, "0")}`;
    }
  }
  return out;
}
