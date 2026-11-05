// SPDX-License-Identifier: AGPL-3.0-only
import { AinobiCliError } from "./errors.ts";

/**
 * `--select <path>`: pick part of a command's `data` payload so the agent never needs
 * `jq` / `python -c json` (both unavailable in the agent shell — prod saw ~390 failed
 * calls trying them).
 *
 * Syntax (relative to `data`; a leading `data.` or `.` is ignored):
 *   slide.children_elements[1].segments   index into arrays
 *   slide.children_elements[].element_id  `[]` maps over every array item
 *   slide.children_elements[]{element_id,name,element_type}  `{a,b}` keeps only those keys
 */

type PickField = { key: string; path: Step[] };

type Step =
  | { kind: "key"; key: string }
  | { kind: "index"; index: number }
  | { kind: "each" }
  | { kind: "pick"; fields: PickField[] };

const describe = (path: Step[]): string =>
  path
    .map((step) => {
      if (step.kind === "key") return `.${step.key}`;
      if (step.kind === "index") return `[${step.index}]`;
      if (step.kind === "each") return "[]";
      return `{${step.fields.map((field) => describe(field.path)).join(",")}}`;
    })
    .join("")
    .replace(/^\./, "");

/**
 * Recursive-descent parser. Inside `{…}` every field is itself a path, so projections
 * nest: `slide.{name,children_elements[]{element_id,text}}`.
 */
export const parseSelectPath = (raw: string): Step[] => {
  const source = raw.trim().replace(/^\./, "").replace(/^data(?=$|[.[{])\.?/, "");
  let i = 0;
  const fail = (message: string): never => {
    throw new AinobiCliError("USAGE", `Invalid --select path "${raw}": ${message}`, {
      hint: "Examples: --select slide.name | --select slide.children_elements[0].text | --select 'slide.{name,children_elements[]{element_id,name}}'",
    });
  };
  const parsePath = (nested: boolean): Step[] => {
    const steps: Step[] = [];
    while (i < source.length) {
      const ch = source[i]!;
      if (nested && (ch === "," || ch === "}")) break;
      if (ch === "." || ch === " ") {
        i += 1;
        continue;
      }
      if (ch === "[") {
        const end = source.indexOf("]", i);
        if (end < 0) fail("missing ]");
        const inner = source.slice(i + 1, end).trim();
        if (inner === "" || inner === "*") steps.push({ kind: "each" });
        else if (/^-?\d+$/.test(inner)) steps.push({ kind: "index", index: Number(inner) });
        else steps.push({ kind: "key", key: inner.replace(/^["']|["']$/g, "") });
        i = end + 1;
        continue;
      }
      if (ch === "{") {
        i += 1;
        const fields: PickField[] = [];
        while (i < source.length && source[i] !== "}") {
          if (source[i] === "," || source[i] === " ") {
            i += 1;
            continue;
          }
          const path = parsePath(true);
          const first = path[0];
          if (!first || first.kind !== "key") fail("each {…} field must start with a key name");
          fields.push({ key: (first as { key: string }).key, path });
        }
        if (source[i] !== "}") fail("missing }");
        i += 1;
        if (fields.length === 0) fail("empty {} projection");
        steps.push({ kind: "pick", fields });
        if (i < source.length && !(nested && (source[i] === "," || source[i] === "}"))) {
          fail("{…} projection must be the last step of its path");
        }
        continue;
      }
      if (ch === "]" || ch === "}" || ch === ",") fail(`unexpected "${ch}"`);
      let j = i;
      while (j < source.length && !".[{,} ".includes(source[j]!)) j += 1;
      steps.push({ kind: "key", key: source.slice(i, j) });
      i = j;
    }
    return steps;
  };
  const steps = parsePath(false);
  if (i < source.length) fail(`unexpected "${source[i]}"`);
  return steps;
};

// Fields missing on an item are skipped (heterogeneous arrays, e.g. text vs shape elements).
const pick = (value: unknown, fields: PickField[], done: Step[]): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field.key in (value as Record<string, unknown>))) continue;
    out[field.key] = walk(value, field.path, done);
  }
  return out;
};

const walk = (value: unknown, steps: Step[], done: Step[]): unknown => {
  if (steps.length === 0) return value;
  const [step, ...rest] = steps;
  const here = [...done, step];
  if (step.kind === "pick") return pick(value, step.fields, done);
  if (step.kind === "each") {
    if (!Array.isArray(value)) {
      throw notFound(done, value, "is not an array");
    }
    return value.map((item) => walk(item, rest, here));
  }
  if (step.kind === "index") {
    if (!Array.isArray(value)) throw notFound(done, value, "is not an array");
    const index = step.index < 0 ? value.length + step.index : step.index;
    if (index < 0 || index >= value.length) {
      throw notFound(done, value, `has ${value.length} item(s); index ${step.index} is out of range`);
    }
    return walk(value[index], rest, here);
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || !(step.key in value)) {
    throw notFound(done, value, `has no key "${step.key}"`);
  }
  return walk((value as Record<string, unknown>)[step.key], rest, here);
};

const notFound = (done: Step[], value: unknown, reason: string): AinobiCliError => {
  const at = describe(done) || "data";
  const keys =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value as Record<string, unknown>).slice(0, 40)
      : [];
  return new AinobiCliError("NOT_FOUND", `--select: ${at} ${reason}.`, {
    hint: keys.length > 0 ? `Keys at ${at}: ${keys.join(", ")}` : undefined,
  });
};

export const selectFromData = (data: unknown, rawPath: string): unknown =>
  walk(data, parseSelectPath(rawPath), []);

/** Scalars print raw (like `jq -r`) so `$(ainobi … --select x)` captures a clean value. */
export const formatSelected = (value: unknown, pretty: boolean): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
  return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
};
