// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { parseQuizJsx, QuizJsxParseError } from "./quiz-jsx-parser.ts";
import type { QuizAstNode } from "@ainobi/courseware-core/quiz-ast.ts";

const single = (jsx: string): QuizAstNode => parseQuizJsx(jsx, "zh");

test("parses self-closing element with whitespace", () => {
  const ast = single("<QuizContainer />");
  if (ast.kind !== "element") throw new Error("not element");
  assert.equal(ast.tag, "QuizContainer");
  const style = ast.props.style as Record<string, unknown> | undefined;
  assert.equal(style?.width, "100%");
  assert.equal(style?.height, "100%");
  assert.deepEqual(ast.children, []);
});

test("parses string and numeric and boolean attributes", () => {
  const ast = single(
    `<QuizContainer narrationDurationMs={1500} padding="md" disabledWhenEmpty />`,
  );
  if (ast.kind !== "element") throw new Error("not element");
  assert.equal(ast.props.padding, "md");
  assert.equal(ast.props.narrationDurationMs, 1500);
  assert.equal(ast.props.disabledWhenEmpty, true);
});

test("parses style object literal", () => {
  const ast = single(
    `<QuizContainer style={{ color: "white", fontSize: 18 }}><QuizTitle /></QuizContainer>`,
  );
  if (ast.kind !== "element") throw new Error("not element");
  assert.deepEqual(ast.props.style, { color: "white", fontSize: 18, width: "100%", height: "100%" });
});

test("parses <interp key=\"title\" /> as interp node", () => {
  const ast = single(
    `<QuizContainer><QuizTitle><interp key="title" /></QuizTitle></QuizContainer>`,
  );
  if (ast.kind !== "element") throw new Error("not element");
  const title = ast.children[0];
  if (!title || title.kind !== "element") throw new Error("missing title");
  assert.equal(title.children[0]?.kind, "interp");
});

test("parses interpolation placeholders in children", () => {
  const ast = single(`<QuizContainer><QuizTitle>{$title}</QuizTitle></QuizContainer>`);
  if (ast.kind !== "element") throw new Error("not element");
  const title = ast.children[0];
  if (!title || title.kind !== "element") throw new Error("missing title");
  assert.equal(title.children[0]?.kind, "interp");
  if (title.children[0]?.kind === "interp") {
    assert.equal(title.children[0].key, "title");
  }
});

test("parses nested children with html tags", () => {
  const ast = single(
    `<QuizContainer><QuizTitle>Hello <strong>world</strong></QuizTitle></QuizContainer>`,
  );
  if (ast.kind !== "element") throw new Error("not element");
  const title = ast.children[0];
  if (!title || title.kind !== "element") throw new Error("missing title");
  assert.equal(title.children.length, 2);
  assert.equal(title.children[0]?.kind, "text");
  assert.equal(title.children[1]?.kind, "element");
});

test("rejects unsupported tag with location info", () => {
  try {
    single("<NotAComponent />");
    throw new Error("should have thrown");
  } catch (error) {
    assert.ok(error instanceof QuizJsxParseError);
    assert.match((error as Error).message, /<NotAComponent>/);
    assert.match((error as Error).message, /line 1/);
  }
});

test("rejects spread attribute", () => {
  try {
    single("<QuizContainer {...rest} />");
    throw new Error("should have thrown");
  } catch (error) {
    assert.ok(error instanceof QuizJsxParseError);
  }
});

test("rejects href attribute even though string is parseable (a tag is not whitelisted)", () => {
  try {
    single(`<QuizContainer><a href="javascript:1">x</a></QuizContainer>`);
    throw new Error("should have thrown");
  } catch (error) {
    assert.ok(error instanceof QuizJsxParseError);
    assert.match((error as Error).message, /<a>/);
  }
});

test("rejects expression attributes other than literals", () => {
  try {
    single("<QuizContainer padding={someVar} />");
    throw new Error("should have thrown");
  } catch (error) {
    assert.ok(error instanceof QuizJsxParseError);
    assert.match((error as Error).message, /unsupported identifier/i);
  }
});

test("rejects mismatched closing tag", () => {
  try {
    single("<QuizContainer><QuizTitle></QuizSubmitButton></QuizContainer>");
    throw new Error("should have thrown");
  } catch (error) {
    assert.ok(error instanceof QuizJsxParseError);
    assert.match((error as Error).message, /expected closing/);
  }
});

test("rejects unknown {$...} placeholder", () => {
  try {
    single("<QuizContainer><QuizTitle>{$mystery}</QuizTitle></QuizContainer>");
    throw new Error("should have thrown");
  } catch (error) {
    assert.ok(error instanceof QuizJsxParseError);
    assert.match((error as Error).message, /unknown interpolation/);
  }
});

test("rejects bare braces (only {$key} accepted in children)", () => {
  try {
    single("<QuizContainer><QuizTitle>{title}</QuizTitle></QuizContainer>");
    throw new Error("should have thrown");
  } catch (error) {
    assert.ok(error instanceof QuizJsxParseError);
  }
});

test("supports data-* and aria-* attributes", () => {
  const ast = single(
    `<QuizContainer data-quiz="x" aria-label="quiz card"><QuizTitle /></QuizContainer>`,
  );
  if (ast.kind !== "element") throw new Error("not element");
  assert.equal(ast.props["data-quiz"], "x");
  assert.equal(ast.props["aria-label"], "quiz card");
});

test("rejects trailing content after root element", () => {
  try {
    single("<QuizContainer /><QuizContainer />");
    throw new Error("should have thrown");
  } catch (error) {
    assert.ok(error instanceof QuizJsxParseError);
    assert.match((error as Error).message, /trailing content/);
  }
});

test("supports line comments between elements", () => {
  const ast = single(
    `<QuizContainer>
        // a comment
        <QuizTitle />
      </QuizContainer>`,
  );
  if (ast.kind !== "element") throw new Error("not element");
  assert.equal(ast.children.length, 1);
  assert.equal((ast.children[0] as { kind: string }).kind, "element");
});

test("supports block comments inside element body", () => {
  const ast = single(
    `<QuizContainer>
        /* still ok */
        <QuizTitle />
      </QuizContainer>`,
  );
  if (ast.kind !== "element") throw new Error("not element");
  assert.equal(ast.children.length, 1);
});

test("strips JSX-style block comments in children", () => {
  const ast = single(
    `<QuizContainer><QuizTitle>{/* note */}{$title}</QuizTitle></QuizContainer>`,
  );
  if (ast.kind !== "element") throw new Error("not element");
  const title = ast.children[0];
  if (!title || title.kind !== "element") throw new Error("missing title");
  assert.equal(title.children.length, 1);
  assert.equal(title.children[0]?.kind, "interp");
});

test("strips JSX line comments in children", () => {
  const ast = single(
    `<QuizContainer><QuizTitle>{// inline\n}{$title}</QuizTitle></QuizContainer>`,
  );
  if (ast.kind !== "element") throw new Error("not element");
  const title = ast.children[0];
  if (!title || title.kind !== "element") throw new Error("missing title");
  assert.equal(title.children[0]?.kind, "interp");
});

test("defaults QuizReferenceAudio src to empty string when omitted", () => {
  const ast = single(`<QuizContainer><QuizReferenceAudio /></QuizContainer>`);
  if (ast.kind !== "element") throw new Error("not element");
  const audio = ast.children[0];
  if (!audio || audio.kind !== "element") throw new Error("missing audio");
  assert.equal(audio.props.src, "");
});

test("parses QuizReferenceAudio with empty src for optional reference audio", () => {
  const ast = single(`<QuizContainer><QuizReferenceAudio src="" /></QuizContainer>`);
  if (ast.kind !== "element") throw new Error("not element");
  const audio = ast.children[0];
  if (!audio || audio.kind !== "element") throw new Error("missing audio");
  assert.equal(audio.props.src, "");
});

test("QuizContainer root gets width/height 100% when style omits them", () => {
  const ast = single(
    `<QuizContainer style={{ display: "flex", padding: 24 }}><QuizTitle /></QuizContainer>`,
  );
  if (ast.kind !== "element") throw new Error("not element");
  const style = ast.props.style as Record<string, unknown>;
  assert.equal(style.width, "100%");
  assert.equal(style.height, "100%");
  assert.equal(style.display, "flex");
});

test("parses QuizShadowingControl recordingStyle", () => {
  const ast = single(
    `<QuizContainer><QuizShadowingControl style={{ background: "#fff" }} recordingStyle={{ background: "#e53e3e" }} /></QuizContainer>`,
  );
  if (ast.kind !== "element") throw new Error("not element");
  const control = ast.children[0];
  if (!control || control.kind !== "element" || control.tag !== "QuizShadowingControl") {
    throw new Error("missing control");
  }
  assert.deepEqual(control.props.recordingStyle, { background: "#e53e3e" });
});

test("parses QuizStateView branches under QuizShadowingControl", () => {
  const ast = single(
    `<QuizContainer>
      <QuizShadowingControl>
        <QuizStateView when="idle"><img src="idle.svg" alt="" /></QuizStateView>
        <QuizStateView when="recording" style={{ background: "#e53e3e" }}>
          <img src="rec.svg" alt="" />
        </QuizStateView>
      </QuizShadowingControl>
    </QuizContainer>`,
  );
  if (ast.kind !== "element") throw new Error("not element");
  const control = ast.children[0];
  if (!control || control.kind !== "element" || control.tag !== "QuizShadowingControl") {
    throw new Error("missing control");
  }
  assert.equal(control.children.length, 2);
  const idle = control.children[0];
  assert.equal(idle?.kind, "stateBranch");
  if (idle?.kind !== "stateBranch") throw new Error("expected stateBranch");
  assert.equal(idle.when, "idle");
  assert.equal(idle.children[0]?.kind, "element");
  const recording = control.children[1];
  if (recording?.kind !== "stateBranch") throw new Error("expected recording branch");
  assert.equal(recording.when, "recording");
  assert.deepEqual(recording.props.style, { background: "#e53e3e" });
});
