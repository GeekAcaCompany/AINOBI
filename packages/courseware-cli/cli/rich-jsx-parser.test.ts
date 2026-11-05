// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { parseRichJsx, RichJsxParseError } from "./rich-jsx-parser.ts";
import {
  buildDefaultRichAst,
  parseRichAstFromJson,
  validateRichAst,
  type RichAstNode,
} from "@ainobi/courseware-core/rich-ast.ts";

const root = (jsx: string): Extract<RichAstNode, { kind: "element" }> => {
  const ast = parseRichJsx(jsx);
  if (ast.kind !== "element") throw new Error("root is not an element");
  return ast;
};

test("parses nested HTML with className and text", () => {
  const ast = root('<div className="flex gap-4"><span className="font-bold">Hi</span> there</div>');
  assert.equal(ast.tag, "div");
  assert.equal(ast.props.className, "flex gap-4");
  assert.equal(ast.children.length, 2);
  const span = ast.children[0];
  assert.equal(span.kind, "element");
  if (span.kind === "element") {
    assert.equal(span.tag, "span");
    assert.deepEqual(span.children, [{ kind: "text", text: "Hi" }]);
  }
  assert.deepEqual(ast.children[1], { kind: "text", text: "there" });
});

test("root container is filled to 100% width/height", () => {
  const ast = root('<section className="p-4">x</section>');
  const style = ast.props.style as Record<string, unknown> | undefined;
  assert.equal(style?.width, "100%");
  assert.equal(style?.height, "100%");
  assert.equal(style?.boxSizing, "border-box");
});

test("parses style object literal with string and number values", () => {
  const ast = root('<div style={{ color: "red", fontSize: 28 }}>x</div>');
  const style = ast.props.style as Record<string, unknown>;
  assert.equal(style.color, "red");
  assert.equal(style.fontSize, 28);
});

test("rejects custom/unknown tags", () => {
  assert.throws(() => parseRichJsx("<Foo>x</Foo>"), RichJsxParseError);
  assert.throws(() => parseRichJsx("<script>x</script>"), RichJsxParseError);
});

test("rejects JSX expression children", () => {
  assert.throws(() => parseRichJsx("<div>{value}</div>"), RichJsxParseError);
  assert.throws(() => parseRichJsx("<div>{$title}</div>"), RichJsxParseError);
});

test("rejects unterminated and trailing content", () => {
  assert.throws(() => parseRichJsx("<div>x"), RichJsxParseError);
  assert.throws(() => parseRichJsx("<div>x</div><div>y</div>"), RichJsxParseError);
});

test("img is void and keeps src/alt", () => {
  const ast = root('<div><img src="https://x/y.png" alt="cat" /></div>');
  const img = ast.children[0];
  assert.equal(img.kind, "element");
  if (img.kind === "element") {
    assert.equal(img.tag, "img");
    assert.equal(img.props.src, "https://x/y.png");
    assert.equal(img.props.alt, "cat");
    assert.deepEqual(img.children, []);
  }
});

test("validate accepts a clean tree and rejects event props", () => {
  assert.deepEqual(validateRichAst(root('<div className="p-4"><p>ok</p></div>')), []);
  const evt = parseRichJsx('<div onClick="x">a</div>');
  const issues = validateRichAst(evt);
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /event props are not allowed/);
});

test("style sanitizer strips url() and dangerous position", () => {
  const ast = root('<div style={{ backgroundImage: "url(http://evil)", position: "fixed", color: "blue" }}>x</div>');
  const style = ast.props.style as Record<string, unknown>;
  assert.equal(style.color, "blue");
  assert.equal(style.backgroundImage, undefined);
  assert.equal(style.position, undefined);
});

test("buildDefaultRichAst is a valid element root", () => {
  const ast = buildDefaultRichAst();
  assert.equal(ast.kind, "element");
  assert.deepEqual(validateRichAst(ast), []);
});

test("parseRichAstFromJson round-trips a parsed tree", () => {
  const ast = root('<div className="grid grid-cols-2"><h2>A</h2><p>B</p></div>');
  const round = parseRichAstFromJson(JSON.parse(JSON.stringify(ast)));
  assert.deepEqual(round, ast);
});
