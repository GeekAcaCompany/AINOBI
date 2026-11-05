// SPDX-License-Identifier: AGPL-3.0-only
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { AinobiCliError } from "./errors.ts";
import { deepMerge } from "./patch.ts";
import { getElementScaffold } from "./templates.ts";
import {
  RICH_SCAFFOLD_TEXTS,
  assertNoNewRichScaffoldText,
  assertRichInsertHasLayout,
  rejectPartialReactLayoutSetEntries,
} from "./rich-layout-guards.ts";

const SCAFFOLD_SUBTITLE = "Edit this block with Tailwind classes and nested HTML.";

type Node = { kind: string; text?: string; children?: Node[] };

const textsOf = (node: Node): string[] =>
  node.kind === "text" ? [node.text ?? ""] : (node.children ?? []).flatMap(textsOf);

// Mirrors the production layouts: one agent-authored child under the root.
const agentLayout = {
  kind: "element",
  tag: "div",
  props: { className: "flex h-full w-full items-center justify-center" },
  children: [
    {
      kind: "element",
      tag: "span",
      props: { className: "text-4xl font-bold text-red-700" },
      children: [{ kind: "text", text: "受領まで含む→ご査収" }],
    },
  ],
};

const richElement = (id: string, layout: unknown) => ({
  element_id: id,
  element_type: "rich",
  react_layout: layout,
});

const expectInvalidInput = (fn: () => void, pattern: RegExp): AinobiCliError => {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof AinobiCliError, "expected AinobiCliError");
  assert.equal(caught.code, "INVALID_INPUT");
  assert.match(caught.message, pattern);
  return caught;
};

// ─── deepMerge ────────────────────────────────────────────────────────────────

test("deepMerge replaces react_layout wholesale instead of merging children by index", () => {
  const merged = deepMerge(getElementScaffold("rich"), { react_layout: agentLayout }) as {
    react_layout: Node;
  };
  assert.deepEqual(merged.react_layout, agentLayout);
  assert.equal(textsOf(merged.react_layout).includes(SCAFFOLD_SUBTITLE), false);
});

test("deepMerge replaces react_layout when nested inside arrays of objects", () => {
  const merged = deepMerge(
    { items: [{ react_layout: { kind: "element", children: [{ a: 1 }, { b: 2 }] }, keep: true }] },
    { items: [{ react_layout: { kind: "element", children: [{ c: 3 }] } }] },
  );
  assert.deepEqual(merged.items[0], {
    react_layout: { kind: "element", children: [{ c: 3 }] },
    keep: true,
  });
});

// ─── input guards ─────────────────────────────────────────────────────────────

test("RICH_SCAFFOLD_TEXTS is derived from the scaffold AST", () => {
  assert.ok(RICH_SCAFFOLD_TEXTS.has("Rich component"));
  assert.ok(RICH_SCAFFOLD_TEXTS.has(SCAFFOLD_SUBTITLE));
});

test("rejectPartialReactLayoutSetEntries blocks node-level --set but allows whole-layout json", () => {
  expectInvalidInput(
    () => rejectPartialReactLayoutSetEntries(["react_layout.children[1].children[0].text=x"], "element update"),
    /cannot be patched node by node/,
  );
  expectInvalidInput(
    () => rejectPartialReactLayoutSetEntries(["react_layout[0]:json={}"], "element update"),
    /node by node/,
  );
  rejectPartialReactLayoutSetEntries(["react_layout:json={}", "position.x=10", "name=react_layout.x"], "t");
});

test("assertRichInsertHasLayout requires a layout only for rich", () => {
  expectInvalidInput(() => assertRichInsertHasLayout("rich", {}, "element.insert.element"), /needs its react_layout/);
  expectInvalidInput(() => assertRichInsertHasLayout("rich", null, "element insert"), /needs its react_layout/);
  assertRichInsertHasLayout("rich", { react_layout: agentLayout }, "t");
  assertRichInsertHasLayout("text", {}, "t");
});

// ─── save guard ───────────────────────────────────────────────────────────────

const leakedLayout = {
  ...agentLayout,
  children: [
    ...agentLayout.children,
    { kind: "element", tag: "p", props: {}, children: [{ kind: "text", text: SCAFFOLD_SUBTITLE }] },
  ],
};

test("assertNoNewRichScaffoldText rejects a write that introduces scaffold copy", () => {
  const error = expectInvalidInput(
    () =>
      assertNoNewRichScaffoldText(
        { slide_elements: [{ children_elements: [] }] },
        { slide_elements: [{ children_elements: [richElement("el_rich_a", leakedLayout)] }] },
      ),
    /scaffold placeholder/,
  );
  assert.equal(error.issues[0]?.path, "scene.slide_elements[0].children_elements[0].react_layout");
  assert.match(error.issues[0]?.message ?? "", /Edit this block/);
});

test("assertNoNewRichScaffoldText keeps legacy layouts, their duplicates and clean layouts", () => {
  const previous = { slide_elements: [{ children_elements: [richElement("el_rich_a", leakedLayout)] }] };
  // Untouched legacy content + a slide duplicate (new id, same layout with reordered keys).
  const reordered = Object.fromEntries(Object.entries(structuredClone(leakedLayout)).reverse());
  assert.notDeepEqual(Object.keys(reordered), Object.keys(leakedLayout));
  assertNoNewRichScaffoldText(previous, {
    slide_elements: [
      { children_elements: [richElement("el_rich_a", leakedLayout)] },
      { children_elements: [richElement("el_rich_b", reordered)] },
    ],
  });
  assertNoNewRichScaffoldText({}, { slide_elements: [{ children_elements: [richElement("el_rich_c", agentLayout)] }] });
});

// ─── CLI end-to-end (the production paths) ────────────────────────────────────

const root = fileURLToPath(new URL("..", import.meta.url));
const bin = join(root, "bin", "ainobi.mjs");

const invoke = (stateDir: string, args: string[]) => {
  const result = spawnSync(process.execPath, [bin, ...args, "--pretty=false"], {
    cwd: root,
    encoding: "utf-8",
    env: { ...process.env, AINOBI_SESSION: "rich-layout-guards", AINOBI_STATE_DIR: stateDir },
  });
  const text = result.status === 0 ? result.stdout : result.stderr || result.stdout;
  return { status: result.status, body: JSON.parse(text.trim()) as Record<string, any> };
};

const ok = (stateDir: string, args: string[]) => {
  const { status, body } = invoke(stateDir, args);
  assert.equal(status, 0, JSON.stringify(body));
  return body.data as Record<string, any>;
};

const fails = (stateDir: string, args: string[], pattern: RegExp) => {
  const { status, body } = invoke(stateDir, args);
  assert.notEqual(status, 0, JSON.stringify(body));
  assert.equal(body.ok, false);
  assert.match(body.error.message, pattern);
};

const richLayoutOf = (stateDir: string, elementId: string): Node =>
  ok(stateDir, ["element", "get", "0", elementId]).element.react_layout as Node;

const freshScene = (): string => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-rich-guards-"));
  ok(stateDir, ["init", "--name", "Rich", "--language", "ja", "--first-slide"]);
  return stateDir;
};

test("CLI element insert --json rich keeps exactly the agent layout", () => {
  const stateDir = freshScene();
  const inserted = ok(stateDir, [
    "element", "insert", "0", "--type", "rich", "--json", JSON.stringify({ react_layout: agentLayout }),
  ]);
  assert.deepEqual(textsOf(richLayoutOf(stateDir, inserted.element_id)), ["受領まで含む→ご査収"]);
});

test("CLI batch element.insert rich keeps exactly the agent layout", () => {
  const stateDir = freshScene();
  const data = ok(stateDir, [
    "batch", "apply", "--json",
    JSON.stringify([{ op: "element.insert", slide: 0, type: "rich", element: { react_layout: agentLayout } }]),
  ]);
  const elementId = JSON.stringify(data).match(/el_rich_[a-z0-9]+/)?.[0];
  assert.ok(elementId, JSON.stringify(data));
  assert.deepEqual(textsOf(richLayoutOf(stateDir, elementId)), ["受領まで含む→ご査収"]);
});

test("CLI rejects rich inserts without a layout (generic and batch)", () => {
  const stateDir = freshScene();
  fails(stateDir, ["element", "insert", "0", "--type", "rich"], /needs its react_layout/);
  fails(
    stateDir,
    ["batch", "apply", "--json", JSON.stringify([{ op: "element.insert", slide: 0, type: "rich", element: {} }])],
    /needs its react_layout/,
  );
});

test("CLI element update replaces a longer rich layout with a shorter one", () => {
  const stateDir = freshScene();
  const twoCards = {
    ...agentLayout,
    children: [agentLayout.children[0], { ...agentLayout.children[0], children: [{ kind: "text", text: "旧カード" }] }],
  };
  const inserted = ok(stateDir, [
    "element", "insert", "0", "--type", "rich", "--json", JSON.stringify({ react_layout: twoCards }),
  ]);
  ok(stateDir, ["element", "update", "0", inserted.element_id, "--json", JSON.stringify({ react_layout: agentLayout })]);
  assert.deepEqual(textsOf(richLayoutOf(stateDir, inserted.element_id)), ["受領まで含む→ご査収"]);

  ok(stateDir, [
    "batch", "apply", "--json",
    JSON.stringify([
      { op: "element.update", slide: 0, element: inserted.element_id, patch: { react_layout: twoCards } },
      { op: "element.update", slide: 0, element: inserted.element_id, patch: { react_layout: agentLayout } },
    ]),
  ]);
  assert.deepEqual(textsOf(richLayoutOf(stateDir, inserted.element_id)), ["受領まで含む→ご査収"]);
});

test("CLI keeps working on a loaded courseware that already carries leaked scaffold copy", () => {
  const stateDir = freshScene();
  const sessionFile = join(stateDir, "rich-layout-guards.json");
  const scene = JSON.parse(readFileSync(sessionFile, "utf-8")).scene;
  // Raw production shape (jsonb key order, root fill style) of an affected element.
  const legacy = {
    tag: "div",
    kind: "element",
    props: {
      style: { width: "100%", height: "100%", boxSizing: "border-box" },
      className: "flex h-full w-full items-center justify-center",
    },
    children: [
      { tag: "span", kind: "element", props: { className: "text-4xl" }, children: [{ kind: "text", text: "要点" }] },
      { tag: "p", kind: "element", props: { className: "text-2xl text-slate-600" }, children: [{ kind: "text", text: SCAFFOLD_SUBTITLE }] },
    ],
  };
  const inserted = ok(stateDir, [
    "element", "insert", "0", "--type", "rich", "--json", JSON.stringify({ react_layout: agentLayout }),
  ]);
  const withLegacy = JSON.parse(readFileSync(sessionFile, "utf-8")).scene;
  const rich = withLegacy.slide_elements[0].children_elements.find(
    (el: { element_id: string }) => el.element_id === inserted.element_id,
  );
  rich.react_layout = legacy;
  const sceneFile = join(stateDir, "legacy-scene.json");
  writeFileSync(sceneFile, JSON.stringify({ ...scene, slide_elements: withLegacy.slide_elements }));
  ok(stateDir, ["load", sceneFile]);
  assert.ok(textsOf(richLayoutOf(stateDir, inserted.element_id)).includes(SCAFFOLD_SUBTITLE));

  ok(stateDir, ["element", "insert", "0", "--type", "text", "--name", "t", "--set", "text=hi"]);
  ok(stateDir, ["element", "update", "0", inserted.element_id, "--set", "position.x=10"]);
  ok(stateDir, ["slide", "duplicate", "0"]);
  // Rewriting the legacy element without the placeholder is the intended repair.
  ok(stateDir, ["element", "rich", "update", "0", inserted.element_id, "--jsx", "<div><span>要点</span></div>"]);
  assert.deepEqual(textsOf(richLayoutOf(stateDir, inserted.element_id)), ["要点"]);
});

test("CLI rejects partial react_layout --set and newly written scaffold copy", () => {
  const stateDir = freshScene();
  const inserted = ok(stateDir, [
    "element", "insert", "0", "--type", "rich", "--json", JSON.stringify({ react_layout: agentLayout }),
  ]);
  fails(
    stateDir,
    ["element", "update", "0", inserted.element_id, "--set", "react_layout.children[0].children[0].text=x"],
    /node by node/,
  );
  fails(
    stateDir,
    ["element", "rich", "update", "0", inserted.element_id, "--jsx", `<div><p>${SCAFFOLD_SUBTITLE}</p></div>`],
    /scaffold placeholder/,
  );
  fails(
    stateDir,
    ["batch", "apply", "--json", JSON.stringify([
      { op: "element.update", slide: 0, element: inserted.element_id, patch: { react_layout: leakedLayout } },
    ])],
    /scaffold placeholder/,
  );
  assert.deepEqual(textsOf(richLayoutOf(stateDir, inserted.element_id)), ["受領まで含む→ご査収"]);
});
