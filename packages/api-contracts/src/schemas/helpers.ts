// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Validation semantics bridge (zod v4).
 *
 * The production contract coerces scalars leniently while zod is strict by default — without a bridge,
 * this service would 422 on lenient payloads. Every bool/scalar query field should use a helper from here
 * (the rule is in the AGENTS.md mapping table).
 */

import { z } from "zod";

/**
 * Lax UUID semantics: accepts any 8-4-4-4-12 hexadecimal form (no variant/version bit restriction —
 * verified against production: ...0000dead is accepted, while zod .uuid() refuses it).
 * The error text matches production verbatim: "Input should be a valid UUID, unable to parse string as an UUID".
 */
/**
 * UUID validation (the repo-wide standard): both the accepted set and the diagnostic text follow production's lax semantics
 * (braces / urn:uuid: prefix / any case / simple format), and the error message carries
 * the specific diagnosis (invalid character / group count / group length / length).
 * A .regex-based implementation would produce generic text that differs from production.
 */
export const pyUuid = z.string().superRefine((value, ctx) => {
  const problem = pydanticUuidProblem(value);
  if (problem) {
    ctx.addIssue({ code: "custom", path: [], message: problem });
  }
});

/**
 * Diagnostic text of UUID parsing (verified case by case against production):
 * - `{...}` braces and the lowercase `urn:uuid:` prefix (case-sensitive) are stripped before validation
 * - first character outside [0-9a-fA-F-] → "invalid character: ... found `X` at N" (1-based,
 *   counting the offset of the stripped prefix)
 * - contains `-` → split on `-`: group count ≠ 5 → "invalid group count: expected 5, found N";
 *   group length ≠ [8,4,4,4,12] → "invalid group length in group I: expected E, found F"
 *   (group index 0-based)
 * - no `-` → length ≠ 32 → "invalid length: expected length 32 for simple format, found N"
 *
 * Uses superRefine (code=custom) rather than .regex: pydanticishMessage in core/handlers.ts
 * overrides a custom message with the default text for invalid_format;
 * only a custom-code message passes through unchanged.
 */
export function pydanticUuidProblem(value: string): string | null {
  let s = value;
  let offset = 0;
  if (s.startsWith("{") && s.endsWith("}") && s.length >= 2) {
    s = s.slice(1, -1);
    offset += 1;
  }
  if (s.startsWith("urn:uuid:")) {
    s = s.slice("urn:uuid:".length);
    offset += "urn:uuid:".length;
  }
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (!/[0-9a-fA-F-]/.test(ch)) {
      return (
        "Input should be a valid UUID, invalid character: expected an optional prefix of " +
        "`urn:uuid:` followed by [0-9a-fA-F-], found `" +
        ch +
        "` at " +
        (offset + i + 1)
      );
    }
  }
  if (s.includes("-")) {
    const groups = s.split("-");
    if (groups.length !== 5) {
      return `Input should be a valid UUID, invalid group count: expected 5, found ${groups.length}`;
    }
    const expectedLengths = [8, 4, 4, 4, 12];
    for (const [index, group] of groups.entries()) {
      if (group.length !== expectedLengths[index]) {
        return (
          `Input should be a valid UUID, invalid group length in group ${index}: ` +
          `expected ${expectedLengths[index]}, found ${group.length}`
        );
      }
    }
    return null;
  }
  if (s.length !== 32) {
    return `Input should be a valid UUID, invalid length: expected length 32 for simple format, found ${s.length}`;
  }
  return null;
}

/**
 * UUID validation for path/query/body parameters (with production's diagnostic text).
 * The accepted set matches production's lax semantics (braces / urn prefix / hex in any case / both formats).
 */
/** Alias of pyUuid (the historical name used for route parameters) */
export const pyUuidParam = pyUuid;

/**
 * Required query int: missing → "Field required" (z.number()'s invalid_type for undefined
 * maps exactly); a present value is coerced with Number (production's lax semantics).
 * The bad-string text "Input should be a valid number" has a known deviation from production's integer text
 * (same as PaginationRequestSchema).
 */
export const pyRequiredQueryInt = z.preprocess(
  (value) => (value === undefined ? undefined : Number(value)),
  z.number().int(),
);

/**
 * Value list quoted in enum error text: 2 values "'a' or 'b'", 3+ values
 * "'a', 'b' or 'c'" (" or " only before the last one; verified against production 2026-10-16).
 * The invalid_value mapping in core/handlers.ts joins everything with " or " — which differs from production for enums with 3+ values,
 * so enum validation goes through this helper (a custom-code message passes through unchanged).
 */
export function pyQuoteJoin(values: readonly string[]): string {
  const quoted = values.map((value) => `'${value}'`);
  if (quoted.length <= 1) {
    return quoted.join("");
  }
  return `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`;
}

/**
 * Enum validation (lax: accepts only the member's raw string; error text matches production verbatim).
 * Output type = the member union (same as z.nativeEnum's inference, interchangeable).
 */
export function pyEnum<T extends readonly string[]>(values: T): z.ZodType<T[number]> {
  const message = `Input should be ${pyQuoteJoin(values)}`;
  return z.string().superRefine((value, ctx) => {
    if (!(values as readonly string[]).includes(value)) {
      ctx.addIssue({ code: "custom", path: [], message });
    }
  }) as unknown as z.ZodType<T[number]>;
}

/**
 * Lax bool (verified against production 2026-10-16):
 * - null → None (use with .nullable())
 * - "true"/"1"/"yes"/"on" (case-insensitive) → true
 * - "false"/"0"/"no"/"off" → false
 * - numbers 1/0 → true/false; anything else (including invalid strings) passes through to zod, which reports
 *   "Input should be a valid boolean, unable to interpret input"
 */
export function pyBool(): z.ZodType<boolean | null> {
  return z.preprocess((value) => {
    if (typeof value === "string") {
      const lowered = value.toLowerCase();
      if (["true", "1", "yes", "on"].includes(lowered)) {
        return true;
      }
      if (["false", "0", "no", "off"].includes(lowered)) {
        return false;
      }
    }
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
    return value;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }, z.boolean().nullable()) as unknown as z.ZodType<boolean | null>;
}

/**
 * Lax JSON form of a non-Optional bool (accepts true/false/1/0/"true"…;
 * refuses null — zod boolean reports "unable to interpret input").
 * Same semantics as the private pyBoolRequired in course.ts.
 */
export function pyBoolRequired(): z.ZodType<boolean> {
  return z.preprocess((value) => {
    if (typeof value === "string") {
      const lowered = value.toLowerCase();
      if (["true", "1", "yes", "on"].includes(lowered)) {
        return true;
      }
      if (["false", "0", "no", "off"].includes(lowered)) {
        return false;
      }
    }
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
    return value;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }, z.boolean()) as unknown as z.ZodType<boolean>;
}

/**
 * Scalar query parameter (production query semantics):
 * - repeated keys are last-wins (the last value) — arrays take their last element
 * - if a list parameter (split on commas) is ever needed, add a separate zQueryList
 */
export function zQueryScalar<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => {
    if (Array.isArray(value)) {
      return value[value.length - 1];
    }
    return value;
  }, schema);
}

/**
 * Whole-object version for scalar queries: every array value in the object folds to its last element (last-wins)
 * before schema validation. **Only for query schemas whose fields are all scalars** —
 * do not use it for routes with list parameters (collect everything + split on commas).
 */
export function zQueryParams<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const collapsed: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        collapsed[key] = Array.isArray(item) ? item[item.length - 1] : item;
      }
      return collapsed;
    }
    return value;
  }, schema);
}

// ---------------------------------------------------------------------------
// date query parameter (error text matches production verbatim)
// ---------------------------------------------------------------------------

/** Days in a month (common/leap year rules) */
function daysInMonthOf(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  if ([4, 6, 9, 11].includes(month)) {
    return 30;
  }
  return 31;
}

/**
 * Problem description from date parsing (null = valid).
 * The texts are samples verified against production's parsing core:
 * - "bogus"/"2026-1-1" → "input is too short"
 * - "2026/01/01" → "invalid date separator, expected `-`"
 * - "2026-13-01" → "month value is outside expected range of 1-12"
 * - "2026-02-30" → "day value is outside expected range"
 * - "2026-01-01T10:00:00" → refused (only midnight is accepted)
 * - "2026-01-01T00:00:00.000001" / ".1" → refused (fractional seconds not all zero after truncating to 6 digits)
 * - "2026-01-01T00:00:00.0000009" → accepted (truncated from the 7th digit, microseconds still 0)
 * - "2026-01-01T00:00:00Z" / "2026-01-01 00:00:00" / ".000000" → accepted (takes the date part)
 */
export function pyDateProblem(value: string): { problem: string; date: string } | null {
  if (value.length < 10) {
    return { problem: "input is too short", date: "" };
  }

  const datePart = value.slice(0, 10);
  if (value.length === 10) {
    // Strict YYYY-MM-DD: separators first; a broken digit run falls back to datetime (too short)
    if (datePart[4] !== "-" || datePart[7] !== "-") {
      return { problem: "invalid date separator, expected `-`", date: "" };
    }
    if (
      !/^\d{4}$/.test(datePart.slice(0, 4)) ||
      !/^\d{2}$/.test(datePart.slice(5, 7)) ||
      !/^\d{2}$/.test(datePart.slice(8, 10))
    ) {
      return { problem: "input is too short", date: "" };
    }
    const year = Number(datePart.slice(0, 4));
    const month = Number(datePart.slice(5, 7));
    const day = Number(datePart.slice(8, 10));
    if (month < 1 || month > 12) {
      return { problem: "month value is outside expected range of 1-12", date: "" };
    }
    if (day < 1 || day > daysInMonthOf(year, month)) {
      return { problem: "day value is outside expected range", date: "" };
    }
    return null;
  }

  // Length > 10: datetime form — only midnight is accepted as a date
  const timeMatch = /[T ](\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?/.exec(value.slice(10));
  if (!timeMatch) {
    return { problem: "input is too short", date: "" };
  }
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = timeMatch[3] !== undefined ? Number(timeMatch[3]) : 0;
  if (hour !== 0 || minute !== 0 || second !== 0) {
    return { problem: "__inexact__", date: "" };
  }
  // Fractional seconds truncated to 6 digits (microseconds) must be all zero (the same refusal surface as
  // date_from_datetime_inexact, verified 2026-10-21: ".0000009" truncates to 0 microseconds → accepted; ".000001"
  // → refused). The 7th digit onwards does not affect the decision.
  if (timeMatch[4] !== undefined && /[1-9]/.test(timeMatch[4].slice(1, 7))) {
    return { problem: "__inexact__", date: "" };
  }
  return null;
}

/**
 * `date` query parameter: outputs a normalized YYYY-MM-DD string.
 * Two forms of error text (both pass through unchanged as custom code; core/handlers does not rewrite them):
 * - parse failure: `Input should be a valid date or datetime, {speedate problem}`
 * - non-midnight: `Datetimes provided to dates should have zero time - e.g. be exact dates`
 */
export function pyDate(): z.ZodType<string> {
  return z
    .string()
    .superRefine((value, ctx) => {
      const result = pyDateProblem(value);
      if (result === null) {
        return;
      }
      if (result.problem === "__inexact__") {
        ctx.addIssue({
          code: "custom",
          message: "Datetimes provided to dates should have zero time - e.g. be exact dates",
        });
        return;
      }
      ctx.addIssue({
        code: "custom",
        message: `Input should be a valid date or datetime, ${result.problem}`,
      });
    })
    // A midnight datetime input normalizes to its date part
    .transform((value) => value.slice(0, 10)) as unknown as z.ZodType<string>;
}

/**
 * Lax JSON form of a required int (verified against production 2026-10-16):
 * - missing → invalid_type(received undefined) → "Field required"
 * - true/false → 1/0 (lax semantics accept bool)
 * - integer string (with sign / surrounding whitespace) → number
 * - non-integer string → "Input should be a valid integer, unable to parse string as an integer"
 * - fractional number → "Input should be a valid integer, got a number with a fractional part"
 * - null → "Input should be a valid integer, unable to interpret input"
 * Numeric ranges (gt/ge/le/lt) are appended by the caller on .pipe() (too_small/too_big use the existing mapping).
 */
export function pyIntRequired(): z.ZodType<number, number> {
  return z.preprocess((value, ctx) => {
    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^[+-]?\d+$/.test(trimmed)) {
        return Number(trimmed);
      }
      ctx.addIssue({
        code: "custom",
        message: "Input should be a valid integer, unable to parse string as an integer",
      });
      return z.NEVER;
    }
    if (typeof value === "number" && !Number.isInteger(value)) {
      ctx.addIssue({
        code: "custom",
        message: "Input should be a valid integer, got a number with a fractional part",
      });
      return z.NEVER;
    }
    if (value === null) {
      ctx.addIssue({
        code: "custom",
        message: "Input should be a valid integer, unable to interpret input",
      });
      return z.NEVER;
    }
    if (value === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Field required",
      });
      return z.NEVER;
    }
    return value;
  }, z.number()) as unknown as z.ZodType<number, number>;
}

/**
 * `Optional[float]` query parameter (scalars such as temperature):
 * - omitted → undefined (handled by the caller's .optional()/default)
 * - numeric strings parse (lax semantics, whitespace stripped)
 * - unparseable string → "Input should be a valid number, unable to parse string as a number"
 *   (passes through unchanged as custom code — zod's invalid_type mapping lacks the ", unable to..." suffix)
 * Outputs a number (integer input is accepted as a float too).
 */
export function pyFloat(): z.ZodType<number> {
  return z
    .any()
    .superRefine((value, ctx): void => {
      if (value === undefined || value === null) {
        return;
      }
      if (typeof value === "number") {
        return;
      }
      if (typeof value === "string") {
        if (value.trim() !== "" && !Number.isNaN(Number(value.trim()))) {
          return;
        }
        ctx.addIssue({
          code: "custom",
          path: [],
          message: "Input should be a valid number, unable to parse string as a number",
        });
        return;
      }
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "Input should be a valid number, unable to parse string as a number",
      });
    })
    .transform((value) => {
      if (typeof value === "number") {
        return value;
      }
      if (typeof value === "string") {
        return Number(value.trim());
      }
      return Number(value);
    }) as unknown as z.ZodType<number>;
}
