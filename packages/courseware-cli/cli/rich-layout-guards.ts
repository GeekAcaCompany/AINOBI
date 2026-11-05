// SPDX-License-Identifier: AGPL-3.0-only
import { AinobiCliError, type CliIssue } from "./errors.ts";
import { buildDefaultRichAst, type RichAstNode } from "@ainobi/courseware-core";

/**
 * Guards for the `rich` element's `react_layout` AST.
 *
 * Production incident: agents inserted rich elements through the generic
 * `element insert --json` / batch `element.insert` paths, whose payload was
 * deep-merged per array index into the rich scaffold. The agent's layout
 * replaced `children[0]` and the scaffold's trailing
 * `<p>Edit this block with Tailwind classes and nested HTML.</p>` survived into
 * published courseware. `deepMerge` now replaces `react_layout` wholesale; these
 * guards make the remaining failure modes loud instead of silent.
 */

const RICH_JSX_HINT =
  "Author the whole layout with `ainobi element rich insert <slide> --jsx-file f.jsx` " +
  "or replace it with `ainobi element rich update <slide> <element_id> --jsx-file f.jsx`.";

const MAX_REPORTED_ISSUES = 10;

const collectTextNodes = (node: RichAstNode, out: string[]): void => {
  if (node.kind === "text") {
    out.push(node.text);
    return;
  }
  for (const child of node.children) collectTextNodes(child, out);
};

/** Placeholder copy of the rich scaffold (derived, so it tracks `buildDefaultRichAst`). */
export const RICH_SCAFFOLD_TEXTS: ReadonlySet<string> = (() => {
  const texts: string[] = [];
  collectTextNodes(buildDefaultRichAst(), texts);
  return new Set(texts.map((text) => text.trim()).filter(Boolean));
})();

const setEntryPath = (entry: string): string => {
  const rawPath = entry.split("=")[0]?.trim() ?? "";
  return rawPath.split(":")[0] ?? rawPath;
};

/**
 * `--set react_layout.children[1]...` would patch one node of a tree; reject it.
 * `--set react_layout:json='{…}'` (whole-layout replacement) stays allowed.
 */
export const rejectPartialReactLayoutSetEntries = (entries: string[], label: string): void => {
  const partial = entries.filter((entry) => {
    const path = setEntryPath(entry);
    return path.startsWith("react_layout.") || path.startsWith("react_layout[");
  });
  if (partial.length === 0) return;
  throw new AinobiCliError(
    "INVALID_INPUT",
    `${label}: react_layout is a whole component tree and cannot be patched node by node via --set.`,
    {
      hint: RICH_JSX_HINT,
      issues: partial.map((entry) => ({ path: setEntryPath(entry), message: "partial react_layout patch" })),
    },
  );
};

/**
 * A rich element created through a generic insert path must bring its own layout;
 * otherwise it would silently ship the scaffold's demo copy.
 */
export const assertRichInsertHasLayout = (
  elementType: string,
  payload: Record<string, unknown> | null | undefined,
  label: string,
): void => {
  if (elementType !== "rich") return;
  const layout = payload?.react_layout;
  if (layout !== undefined && layout !== null) return;
  throw new AinobiCliError(
    "INVALID_INPUT",
    `${label}: a rich element needs its react_layout; refusing to insert the scaffold demo layout.`,
    { hint: RICH_JSX_HINT },
  );
};

type RichLayoutHit = { path: string; layout: unknown };

const collectRichLayouts = (value: unknown, path: string, out: RichLayoutHit[]): void => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectRichLayouts(item, `${path}[${index}]`, out));
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.element_type === "rich" && record.react_layout && typeof record.react_layout === "object") {
    out.push({ path: `${path}.react_layout`, layout: record.react_layout });
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === "react_layout") continue;
    collectRichLayouts(child, path ? `${path}.${key}` : key, out);
  }
};

/** Key-order-independent serialization, so previous/next layouts compare by content. */
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

const scaffoldTextsIn = (layout: unknown): string[] => {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (record.kind === "text" && typeof record.text === "string") {
      if (RICH_SCAFFOLD_TEXTS.has(record.text.trim())) found.push(record.text.trim());
      return;
    }
    if (Array.isArray(record.children)) record.children.forEach(walk);
  };
  walk(layout);
  return found;
};

/**
 * Throw when `next` holds a rich layout containing scaffold placeholder copy that
 * `previous` did not already hold verbatim. Layouts are compared by content, so
 * legacy content, a teacher's untouched toolbar-inserted rich, and duplicates of
 * either survive; only a write that newly authors placeholder copy is rejected.
 */
export const assertNoNewRichScaffoldText = (
  previous: unknown,
  next: unknown,
  label = "scene",
): void => {
  const nextHits: RichLayoutHit[] = [];
  collectRichLayouts(next, label, nextHits);
  const offending = nextHits
    .map((hit) => ({ ...hit, texts: scaffoldTextsIn(hit.layout) }))
    .filter((hit) => hit.texts.length > 0);
  if (offending.length === 0) return;

  const previousHits: RichLayoutHit[] = [];
  collectRichLayouts(previous, label, previousHits);
  const existing = new Set(previousHits.map((hit) => canonicalJson(hit.layout)));
  const introduced = offending.filter((hit) => !existing.has(canonicalJson(hit.layout)));
  if (introduced.length === 0) return;

  const issues: CliIssue[] = introduced.slice(0, MAX_REPORTED_ISSUES).map((hit) => ({
    path: hit.path,
    message: `contains rich scaffold placeholder text: ${hit.texts.map((t) => JSON.stringify(t)).join(", ")}`,
  }));
  throw new AinobiCliError(
    "INVALID_INPUT",
    "A rich element's react_layout still contains the scaffold placeholder copy; refusing to write it into the courseware.",
    {
      hint: `Remove the placeholder nodes and write the complete layout. ${RICH_JSX_HINT}`,
      issues,
    },
  );
};
