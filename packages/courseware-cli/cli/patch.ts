// SPDX-License-Identifier: AGPL-3.0-only
import { normalizeMultilineCliText } from "./cli-text.ts";
import { AinobiCliError } from "./errors.ts";

/**
 * Parses `--set key=value` style arguments into a deep patch object.
 *   foo=1                  → { foo: 1 }
 *   foo.bar="hi"           → { foo: { bar: "hi" } }
 *   list[0]=42             → { list: [42] }
 *   foo:json='{"x":1}'     → { foo: { x: 1 } }    (value parsed as JSON)
 *   foo:str=42             → { foo: "42" }       (kept as string)
 *   foo:raw='a\nb'         → { foo: "a\\nb" }    (string without escape decoding)
 *
 * Auto value coercion (when no `:type` annotation is given):
 *   - "true" / "false"  → boolean
 *   - "null"            → null
 *   - finite numbers    → number
 *   - everything else   → string, with common backslash escapes decoded (unknown `\x` drops `\`, e.g. `\!` → `!`)
 */
export type DeepPatch = Record<string, unknown>;

interface PathToken {
  kind: "key" | "index";
  value: string;
  numeric?: number;
}

const tokenizePath = (path: string): PathToken[] => {
  const tokens: PathToken[] = [];
  let i = 0;
  let buffer = "";
  const flushBuffer = (): void => {
    if (buffer.length > 0) {
      tokens.push({ kind: "key", value: buffer });
      buffer = "";
    }
  };
  while (i < path.length) {
    const ch = path[i];
    if (ch === ".") {
      flushBuffer();
      i += 1;
      continue;
    }
    if (ch === "[") {
      flushBuffer();
      const close = path.indexOf("]", i);
      if (close < 0) {
        throw new AinobiCliError(
          "USAGE",
          `Invalid path "${path}": missing closing "]" for array index.`,
        );
      }
      const inside = path.slice(i + 1, close).trim();
      const numeric = Number(inside);
      if (!Number.isInteger(numeric) || numeric < 0) {
        throw new AinobiCliError(
          "USAGE",
          `Invalid path "${path}": array index must be a non-negative integer, got "${inside}".`,
        );
      }
      tokens.push({ kind: "index", value: inside, numeric });
      i = close + 1;
      continue;
    }
    buffer += ch;
    i += 1;
  }
  flushBuffer();
  if (tokens.length === 0) {
    throw new AinobiCliError("USAGE", `Empty path is not allowed.`);
  }
  return tokens;
};

const coerceValue = (raw: string, typeHint?: string): unknown => {
  if (typeHint) {
    switch (typeHint) {
      case "str":
      case "string":
        return normalizeMultilineCliText(raw);
      case "raw":
      case "literal":
        return raw;
      case "num":
      case "number": {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          throw new AinobiCliError("USAGE", `Cannot parse "${raw}" as number.`);
        }
        return n;
      }
      case "bool":
      case "boolean":
        if (raw === "true") return true;
        if (raw === "false") return false;
        throw new AinobiCliError("USAGE", `Cannot parse "${raw}" as boolean.`);
      case "null":
        return null;
      case "json":
        try {
          return JSON.parse(raw);
        } catch (error) {
          throw new AinobiCliError(
            "USAGE",
            `Cannot parse "${raw}" as JSON: ${(error as Error).message}`,
          );
        }
      default:
        throw new AinobiCliError("USAGE", `Unknown type hint ":${typeHint}".`);
    }
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (raw === "") return "";
  if (raw[0] === '"' && raw[raw.length - 1] === '"' && raw.length >= 2) {
    try {
      return JSON.parse(raw);
    } catch {
      return normalizeMultilineCliText(raw.slice(1, -1));
    }
  }
  if (raw[0] === "{" || raw[0] === "[") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return normalizeMultilineCliText(raw);
};

const parseSetEntry = (entry: string): { tokens: PathToken[]; value: unknown } => {
  const equals = entry.indexOf("=");
  if (equals <= 0) {
    throw new AinobiCliError(
      "USAGE",
      `--set expects "path=value", got "${entry}".`,
    );
  }
  const lhs = entry.slice(0, equals);
  const rhs = entry.slice(equals + 1);
  let path = lhs;
  let typeHint: string | undefined;
  const colon = lhs.indexOf(":");
  if (colon > 0) {
    path = lhs.slice(0, colon);
    typeHint = lhs.slice(colon + 1);
  }
  const tokens = tokenizePath(path);
  const value = coerceValue(rhs, typeHint);
  return { tokens, value };
};

const setAtPath = (root: DeepPatch, tokens: PathToken[], value: unknown): void => {
  let cursor: unknown = root;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const last = i === tokens.length - 1;
    if (token.kind === "key") {
      const obj = cursor as Record<string, unknown>;
      if (last) {
        obj[token.value] = value;
        return;
      }
      const nextToken = tokens[i + 1];
      if (obj[token.value] === undefined || obj[token.value] === null) {
        obj[token.value] = nextToken.kind === "index" ? [] : {};
      }
      cursor = obj[token.value];
    } else {
      const arr = cursor as unknown[];
      if (!Array.isArray(arr)) {
        throw new AinobiCliError(
          "USAGE",
          `Path traversal expected array but got ${typeof arr} at index [${token.value}].`,
        );
      }
      const idx = token.numeric as number;
      if (last) {
        arr[idx] = value;
        return;
      }
      const nextToken = tokens[i + 1];
      if (arr[idx] === undefined || arr[idx] === null) {
        arr[idx] = nextToken.kind === "index" ? [] : {};
      }
      cursor = arr[idx];
    }
  }
};

export const buildPatchFromSetEntries = (entries: string[]): DeepPatch => {
  const root: DeepPatch = {};
  for (const entry of entries) {
    const { tokens, value } = parseSetEntry(entry);
    setAtPath(root, tokens, value);
  }
  return root;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** Merge patch array into target by index (objects deep-merge; scalars replace). */
const mergeArraysByIndex = (target: unknown[], patch: unknown[]): unknown[] => {
  const length = Math.max(target.length, patch.length);
  const result: unknown[] = [];
  for (let i = 0; i < length; i += 1) {
    const current = target[i];
    const next = patch[i];
    if (next === undefined) {
      result[i] = current;
      continue;
    }
    if (current === undefined) {
      result[i] = next;
      continue;
    }
    if (isPlainObject(current) && isPlainObject(next)) {
      result[i] = deepMerge(current, next);
    } else {
      result[i] = next;
    }
  }
  return result;
};

/**
 * Keys whose value is a whole document (a component AST) and is replaced as a unit,
 * never merged. Merging a tree per array index splices the patch onto the old tree:
 * a new `react_layout` with fewer `children` than the rich scaffold kept the
 * scaffold's trailing "Edit this block with Tailwind…" node in production.
 */
export const ATOMIC_MERGE_KEYS: ReadonlySet<string> = new Set(["react_layout"]);

/**
 * Deep merge `patch` into `target` and return a brand-new object.
 * Arrays merge per index so `--set options[1].is_correct=true` keeps other options.
 * Keys in {@link ATOMIC_MERGE_KEYS} are replaced wholesale at any depth.
 */
export const deepMerge = <T>(target: T, patch: unknown): T => {
  if (!isPlainObject(patch)) return target;
  if (!isPlainObject(target)) return patch as T;
  const result: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (ATOMIC_MERGE_KEYS.has(key)) {
      result[key] = value;
    } else if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value);
    } else if (Array.isArray(value) && Array.isArray(result[key])) {
      result[key] = mergeArraysByIndex(result[key] as unknown[], value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
};
