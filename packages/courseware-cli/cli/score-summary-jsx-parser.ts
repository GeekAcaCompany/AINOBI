// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Deterministic JSX-subset parser → {@link QuizScoreSummaryAstNode}
 * =====================================================
 *
 * The CLI uses this parser on `quiz score-summary insert` / `update`: it takes a
 * JSX source string written by the agent and produces a strict
 * {@link QuizScoreSummaryAstNode}, which `validateQuizScoreSummaryAst` then checks.
 * The frontend does NOT use this parser; it only renders the pre-validated AST on
 * `scene.quiz.score_summary.react_layout`.
 *
 * Supported syntax (intentionally tiny):
 *
 *   <Tag prop="string" prop={42} prop={true} prop={false}
 *        style={{ color: "red", fontSize: 12 }}
 *        boolean
 *        data-x="..." aria-label="...">
 *     literal text
 *     {$placeholder}
 *     <interp key="total_score" />   (sugar for {$total_score} — self-closing only)
 *     <Child />
 *   </Tag>
 *
 * Explicitly NOT supported:
 * - spread (`{...x}`), variable references, expressions, ternaries,
 * - template literals, function/arrow bodies, comments inside JSX,
 * - JSX fragments (`<>…</>`),
 * - imports / exports / declarations,
 * - inline event handlers (`onClick={...}` etc.).
 *
 * On any unexpected token the parser throws a `QuizJsxParseError` containing
 * line/column information so the CLI can surface a clear error to the agent.
 */

import {
  isQuizScoreSummaryInterpKey,
  isQuizScoreSummaryTag,
  normalizeScoreSummaryAst,
  type QuizScoreSummaryAstNode,
  type QuizAstPropValue,
  type QuizScoreSummaryInterpKey,
  type QuizScoreSummaryTag,
} from "@ainobi/courseware-core/quiz-score-summary-ast.ts";

import { ensureScoreSummaryAstInterpSlots } from "@ainobi/courseware-core/quiz-score-summary-ast-interp-fill.ts";
import { QuizJsxParseError } from "./quiz-jsx-parser.ts";

interface Cursor {
  source: string;
  index: number;
  line: number;
  column: number;
}

const peek = (c: Cursor, offset = 0): string => c.source[c.index + offset] ?? "";

const advance = (c: Cursor, count = 1): void => {
  for (let i = 0; i < count; i += 1) {
    const ch = c.source[c.index];
    if (ch === undefined) return;
    if (ch === "\n") {
      c.line += 1;
      c.column = 1;
    } else {
      c.column += 1;
    }
    c.index += 1;
  }
};

// A function declaration (not a const arrow) so TypeScript narrows after calls.
function fail(c: Cursor, message: string): never {
  throw new QuizJsxParseError(message, c.line, c.column);
}

/**
 * Skip line and block comments that occur between JSX children but preserve
 * surrounding whitespace so we can decide whether the run produces a non-empty
 * text node later on.
 */
const skipCommentsOnly = (c: Cursor): void => {
  while (c.index < c.source.length) {
    const start = c.index;
    while (c.index < c.source.length) {
      const ch = c.source[c.index];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        advance(c);
        continue;
      }
      break;
    }
    if (peek(c) === "/" && peek(c, 1) === "/") {
      while (c.index < c.source.length && peek(c) !== "\n") advance(c);
      continue;
    }
    if (peek(c) === "/" && peek(c, 1) === "*") {
      advance(c, 2);
      while (c.index < c.source.length && !(peek(c) === "*" && peek(c, 1) === "/")) advance(c);
      if (c.index < c.source.length) advance(c, 2);
      continue;
    }
    // Nothing consumed this iteration → restore index (so leading whitespace can
    // still be part of a text node) and stop.
    if (c.index === start) break;
    if (peek(c) !== "<" && peek(c) !== "{") break;
    // We did consume whitespace and the next char is structural; that's fine.
    break;
  }
};

const skipWhitespace = (c: Cursor): void => {
  while (c.index < c.source.length) {
    const ch = c.source[c.index];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      advance(c);
      continue;
    }
    if (ch === "/" && peek(c, 1) === "/") {
      while (c.index < c.source.length && peek(c) !== "\n") advance(c);
      continue;
    }
    if (ch === "/" && peek(c, 1) === "*") {
      advance(c, 2);
      while (c.index < c.source.length && !(peek(c) === "*" && peek(c, 1) === "/")) {
        advance(c);
      }
      if (c.index < c.source.length) advance(c, 2);
      continue;
    }
    break;
  }
};

const isIdentStart = (ch: string): boolean => /[A-Za-z_]/.test(ch);
const isIdentPart = (ch: string): boolean => /[A-Za-z0-9_-]/.test(ch);

const readIdent = (c: Cursor): string => {
  if (!isIdentStart(peek(c))) {
    fail(c, "expected identifier");
  }
  let out = "";
  while (c.index < c.source.length && isIdentPart(peek(c))) {
    out += peek(c);
    advance(c);
  }
  return out;
};

const readStringLiteral = (c: Cursor): string => {
  const quote = peek(c);
  if (quote !== '"' && quote !== "'") fail(c, "expected string literal");
  advance(c);
  let out = "";
  while (c.index < c.source.length) {
    const ch = peek(c);
    if (ch === "\\") {
      const next = peek(c, 1);
      advance(c, 2);
      switch (next) {
        case "n":
          out += "\n";
          break;
        case "r":
          out += "\r";
          break;
        case "t":
          out += "\t";
          break;
        case "\\":
          out += "\\";
          break;
        case "'":
          out += "'";
          break;
        case '"':
          out += '"';
          break;
        case "`":
          out += "`";
          break;
        default:
          fail(c, `unsupported escape sequence \\${next}`);
      }
      continue;
    }
    if (ch === quote) {
      advance(c);
      return out;
    }
    out += ch;
    advance(c);
  }
  return fail(c, "unterminated string literal") as never;
};

const readNumberLiteral = (c: Cursor): number => {
  let raw = "";
  if (peek(c) === "-") {
    raw += "-";
    advance(c);
  }
  while (c.index < c.source.length && /[0-9.]/.test(peek(c))) {
    raw += peek(c);
    advance(c);
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    fail(c, `invalid number literal "${raw}"`);
  }
  return parsed;
};

const expectChar = (c: Cursor, ch: string): void => {
  if (peek(c) !== ch) fail(c, `expected "${ch}"`);
  advance(c);
};

const readExpressionContainer = (c: Cursor, allowObject: boolean): QuizAstPropValue => {
  expectChar(c, "{");
  skipWhitespace(c);
  const ch = peek(c);
  if (ch === "{" && allowObject) {
    const obj = readObjectLiteral(c);
    skipWhitespace(c);
    expectChar(c, "}");
    return obj;
  }
  if (ch === '"' || ch === "'") {
    const str = readStringLiteral(c);
    skipWhitespace(c);
    expectChar(c, "}");
    return str;
  }
  if (ch === "-" || /[0-9]/.test(ch)) {
    const num = readNumberLiteral(c);
    skipWhitespace(c);
    expectChar(c, "}");
    return num;
  }
  if (isIdentStart(ch)) {
    const ident = readIdent(c);
    skipWhitespace(c);
    expectChar(c, "}");
    if (ident === "true") return true;
    if (ident === "false") return false;
    if (ident === "null" || ident === "undefined") {
      fail(c, `unsupported literal "${ident}"`);
    }
    fail(c, `unsupported identifier "${ident}" in JSX expression`);
  }
  return fail(c, "unsupported JSX expression") as never;
};

const readObjectLiteral = (c: Cursor): Record<string, string | number> => {
  expectChar(c, "{");
  skipWhitespace(c);
  const out: Record<string, string | number> = {};
  if (peek(c) === "}") {
    advance(c);
    return out;
  }
  while (c.index < c.source.length) {
    skipWhitespace(c);
    let key: string;
    if (peek(c) === '"' || peek(c) === "'") {
      key = readStringLiteral(c);
    } else if (isIdentStart(peek(c))) {
      key = readIdent(c);
    } else {
      fail(c, "expected object key");
      return out; // unreachable
    }
    skipWhitespace(c);
    expectChar(c, ":");
    skipWhitespace(c);
    const valueCh = peek(c);
    if (valueCh === '"' || valueCh === "'") {
      out[key] = readStringLiteral(c);
    } else if (valueCh === "-" || /[0-9]/.test(valueCh)) {
      out[key] = readNumberLiteral(c);
    } else {
      fail(c, "object literal values must be string or number");
    }
    skipWhitespace(c);
    if (peek(c) === ",") {
      advance(c);
      skipWhitespace(c);
      if (peek(c) === "}") break;
      continue;
    }
    if (peek(c) === "}") break;
    fail(c, 'expected "," or "}" in object literal');
  }
  expectChar(c, "}");
  return out;
};

interface ParsedAttribute {
  name: string;
  value: QuizAstPropValue;
}

const STYLE_OBJECT_PROPS = new Set<string>(["style", "recordingStyle"]);

const readAttribute = (c: Cursor): ParsedAttribute => {
  const name = readIdent(c);
  if (peek(c) !== "=") {
    return { name, value: true };
  }
  advance(c);
  if (peek(c) === '"' || peek(c) === "'") {
    return { name, value: readStringLiteral(c) };
  }
  if (peek(c) === "{") {
    return { name, value: readExpressionContainer(c, STYLE_OBJECT_PROPS.has(name)) };
  }
  return fail(c, `attribute "${name}" must use "..." or {...}`) as never;
};

const readJsxText = (c: Cursor): QuizScoreSummaryAstNode | null => {
  let buffer = "";
  while (c.index < c.source.length && peek(c) !== "<" && peek(c) !== "{") {
    buffer += peek(c);
    advance(c);
  }
  if (!buffer.trim()) return null;
  // Collapse runs of internal whitespace but preserve a single space.
  const normalized = buffer.replace(/\s+/g, " ");
  return { kind: "text", text: normalized.replace(/^ /, "").replace(/ $/, "") };
};

const readBraceChild = (c: Cursor): QuizScoreSummaryAstNode | null => {
  expectChar(c, "{");
  skipWhitespace(c);
  if (peek(c) === "}") {
    advance(c);
    return null;
  }
  if (peek(c) === "/" && peek(c, 1) === "*") {
    advance(c, 2);
    while (c.index < c.source.length && !(peek(c) === "*" && peek(c, 1) === "/")) {
      advance(c);
    }
    if (c.index < c.source.length) advance(c, 2);
    skipWhitespace(c);
    expectChar(c, "}");
    return null;
  }
  if (peek(c) === "/" && peek(c, 1) === "/") {
    advance(c, 2);
    while (c.index < c.source.length && peek(c) !== "\n") advance(c);
    skipWhitespace(c);
    expectChar(c, "}");
    return null;
  }
  if (peek(c) !== "$") {
    fail(c, "only {$placeholder} interpolations or comments are allowed inside {...} in JSX children");
  }
  advance(c);
  const ident = readIdent(c);
  skipWhitespace(c);
  expectChar(c, "}");
  if (!isQuizScoreSummaryInterpKey(ident)) {
    fail(c, `unknown interpolation {$${ident}}`);
  }
  return { kind: "interp", key: ident as QuizScoreSummaryInterpKey };
};

const readChildNode = (c: Cursor): QuizScoreSummaryAstNode => {
  if (peek(c) !== "<") {
    return fail(c, "expected JSX element") as never;
  }
  return readElement(c);
};

const readInterpElement = (c: Cursor): QuizScoreSummaryAstNode => {
  const props: Record<string, QuizAstPropValue> = {};
  while (true) {
    skipWhitespace(c);
    const ch = peek(c);
    if (ch === "/" || ch === ">") break;
    if (!isIdentStart(ch)) {
      fail(c, `expected attribute on <interp>, got "${ch}"`);
    }
    const attr = readAttribute(c);
    if (attr.name !== "key") {
      fail(c, `<interp> only supports key="…" — use <interp key="total_score" /> or text {$total_score}`);
    }
    if ("key" in props) {
      fail(c, `duplicate key attribute on <interp>`);
    }
    props.key = attr.value;
  }
  if (peek(c) !== "/") {
    fail(
      c,
      '<interp> must be self-closing (<interp key="total_score" />); for mixed copy use {$total_score} in text children',
    );
  }
  advance(c);
  expectChar(c, ">");
  const rawKey = props.key;
  if (typeof rawKey !== "string" || !rawKey.trim()) {
    fail(c, '<interp> requires key="earned_score|total_score|grade_label|…"');
  }
  if (!isQuizScoreSummaryInterpKey(rawKey)) {
    fail(c, `unknown <interp key="${rawKey}"> — see quiz-components.md §6 for valid {$…} keys`);
  }
  return { kind: "interp", key: rawKey as QuizScoreSummaryInterpKey };
};

const readElement = (c: Cursor): Extract<QuizScoreSummaryAstNode, { kind: "element" }> => {
  expectChar(c, "<");
  skipWhitespace(c);
  if (peek(c) === "/") fail(c, "unexpected closing tag");
  const tagName = readIdent(c);
  if (tagName === "interp") {
    return readInterpElement(c) as never;
  }
  if (!isQuizScoreSummaryTag(tagName)) {
    if (tagName.toLowerCase() === "interp") {
      fail(c, `<${tagName}> is not valid — use lowercase <interp key="total_score" /> or text {$total_score}`);
    }
    fail(
      c,
      `<${tagName}> is not allowed in score-summary JSX — dynamic copy uses {$total_score} / {$grade_label} in text, not custom tags`,
    );
  }
  const tag = tagName as QuizScoreSummaryTag;
  const props: Record<string, QuizAstPropValue> = {};
  while (true) {
    skipWhitespace(c);
    const ch = peek(c);
    if (ch === "/" || ch === ">") break;
    if (!isIdentStart(ch)) {
      fail(c, `expected attribute, got "${ch}"`);
    }
    const attr = readAttribute(c);
    if (attr.name in props) {
      fail(c, `duplicate attribute "${attr.name}"`);
    }
    props[attr.name] = attr.value;
  }
  if (peek(c) === "/") {
    advance(c);
    expectChar(c, ">");
    return { kind: "element", tag, props, children: [] };
  }
  expectChar(c, ">");
  const children: QuizScoreSummaryAstNode[] = [];
  while (c.index < c.source.length) {
    // Strip whitespace + comments between children so `// foo` and `/* bar */`
    // do not accidentally surface as JSX text nodes.
    skipCommentsOnly(c);
    if (c.index >= c.source.length) break;
    if (peek(c) === "<" && peek(c, 1) === "/") {
      advance(c, 2);
      skipWhitespace(c);
      const closingName = readIdent(c);
      if (closingName !== tagName) {
        fail(c, `expected closing </${tagName}>, got </${closingName}>`);
      }
      skipWhitespace(c);
      expectChar(c, ">");
      return { kind: "element", tag, props, children };
    }
    if (peek(c) === "<") {
      children.push(readChildNode(c));
      continue;
    }
    if (peek(c) === "{") {
      const child = readBraceChild(c);
      if (child) children.push(child);
      continue;
    }
    const text = readJsxText(c);
    if (text) children.push(text);
  }
  return fail(c, `unterminated <${tagName}>`) as never;
};

export type ParseScoreSummaryJsxResult = {
  ast: QuizScoreSummaryAstNode;
  layout_interp_fixes: string[];
};

/**
 * Parse a JSX-subset string into a {@link QuizScoreSummaryAstNode}. Throws
 * {@link QuizJsxParseError} on any syntactic issue.
 */
export const parseScoreSummaryJsxWithMeta = (source: string): ParseScoreSummaryJsxResult => {
  if (typeof source !== "string") {
    throw new QuizJsxParseError("expected a JSX string", 1, 1);
  }
  const c: Cursor = { source, index: 0, line: 1, column: 1 };
  skipWhitespace(c);
  if (peek(c) !== "<") {
    throw new QuizJsxParseError("expected a JSX element starting with <", c.line, c.column);
  }
  const node = readElement(c);
  skipWhitespace(c);
  if (c.index !== source.length) {
    throw new QuizJsxParseError(
      `unexpected trailing content after root element ("${source[c.index] ?? ""}")`,
      c.line,
      c.column,
    );
  }
  const normalized = normalizeScoreSummaryAst(node, { fillRootContainer: true });
  return ensureScoreSummaryAstInterpSlots(normalized);
};

/** @see parseScoreSummaryJsxWithMeta */
export const parseScoreSummaryJsx = (source: string): QuizScoreSummaryAstNode => parseScoreSummaryJsxWithMeta(source).ast;
