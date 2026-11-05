// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Deterministic JSX-subset parser → {@link RichAstNode}
 * =====================================================
 *
 * Parses the agent-authored JSX string for a `rich` slide element exactly once
 * per `element rich insert` / `element rich update`. Produces a strict
 * {@link RichAstNode} that {@link validateRichAst} then checks. The frontend
 * never runs this parser — it renders the pre-validated AST.
 *
 * Supported syntax (intentionally tiny):
 *
 *   <div className="flex gap-4" style={{ color: "red", fontSize: 24 }}>
 *     literal text
 *     <span className="font-bold">child</span>
 *     <img src="https://…" alt="" />
 *   </div>
 *
 * Explicitly NOT supported: spreads, variable references, expressions,
 * template literals, fragments, `{$placeholders}`, event handlers, custom tags.
 */

import {
  isRichTag,
  normalizeRichAst,
  type RichAstNode,
  type RichAstPropValue,
  type RichTag,
} from "@ainobi/courseware-core/rich-ast.ts";

export class RichJsxParseError extends Error {
  constructor(message: string, public line: number, public column: number) {
    super(`${message} (line ${line}, column ${column})`);
    this.name = "RichJsxParseError";
  }
}

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

const fail = (c: Cursor, message: string): never => {
  throw new RichJsxParseError(message, c.line, c.column);
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
    if (c.index === start) break;
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

const STYLE_OBJECT_PROPS = new Set<string>(["style"]);

const readExpressionContainer = (c: Cursor, allowObject: boolean): RichAstPropValue => {
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
    fail(c, `unsupported identifier "${ident}" in JSX expression`);
  }
  return fail(c, "unsupported JSX expression") as never;
};

interface ParsedAttribute {
  name: string;
  value: RichAstPropValue;
}

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

const readJsxText = (c: Cursor): RichAstNode | null => {
  let buffer = "";
  while (c.index < c.source.length && peek(c) !== "<" && peek(c) !== "{") {
    buffer += peek(c);
    advance(c);
  }
  if (!buffer.trim()) return null;
  const normalized = buffer.replace(/\s+/g, " ");
  return { kind: "text", text: normalized.replace(/^ /, "").replace(/ $/, "") };
};

const readBraceChild = (c: Cursor): RichAstNode | null => {
  expectChar(c, "{");
  skipWhitespace(c);
  if (peek(c) === "}") {
    advance(c);
    return null;
  }
  if (peek(c) === "/" && peek(c, 1) === "*") {
    advance(c, 2);
    while (c.index < c.source.length && !(peek(c) === "*" && peek(c, 1) === "/")) advance(c);
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
  return fail(
    c,
    "rich components do not support {expressions}; only literal text and nested tags are allowed",
  ) as never;
};

const readElement = (c: Cursor): Extract<RichAstNode, { kind: "element" }> => {
  expectChar(c, "<");
  skipWhitespace(c);
  if (peek(c) === "/") fail(c, "unexpected closing tag");
  const tagName = readIdent(c);
  if (!isRichTag(tagName)) {
    fail(c, `<${tagName}> is not allowed in a rich component (use plain HTML tags like div/span/p/h1-h4/ul/li/img)`);
  }
  const tag = tagName as RichTag;
  const props: Record<string, RichAstPropValue> = {};
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
  const children: RichAstNode[] = [];
  while (c.index < c.source.length) {
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
      children.push(readElement(c));
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

/** Parse a JSX-subset string into a {@link RichAstNode}. Throws {@link RichJsxParseError} on any issue. */
export const parseRichJsx = (source: string): RichAstNode => {
  if (typeof source !== "string") {
    throw new RichJsxParseError("expected a JSX string", 1, 1);
  }
  const c: Cursor = { source, index: 0, line: 1, column: 1 };
  skipWhitespace(c);
  if (peek(c) !== "<") {
    throw new RichJsxParseError("expected a JSX element starting with <", c.line, c.column);
  }
  const node = readElement(c);
  skipWhitespace(c);
  if (c.index !== source.length) {
    throw new RichJsxParseError(
      `unexpected trailing content after root element ("${source[c.index] ?? ""}")`,
      c.line,
      c.column,
    );
  }
  return normalizeRichAst(node, { fillRootContainer: true });
};
