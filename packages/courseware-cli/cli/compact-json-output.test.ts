// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  compactLargeStrings,
  DEFAULT_LARGE_STRING_PREVIEW,
  DEFAULT_LARGE_STRING_THRESHOLD,
} from "./compact-json-output.ts";

test("compactLargeStrings leaves short strings and full mode unchanged", () => {
  const input = { a: "hi", nested: { b: ["x", "y"] } };
  assert.deepEqual(compactLargeStrings(input, { full: true }), input);
  assert.deepEqual(compactLargeStrings(input, {}), input);
});

test("compactLargeStrings replaces long strings with descriptor", () => {
  const long = "z".repeat(DEFAULT_LARGE_STRING_THRESHOLD + 10);
  const out = compactLargeStrings({ source: long }, {}) as Record<string, unknown>;
  assert.equal(typeof out.source, "object");
  const t = out.source as Record<string, unknown>;
  assert.equal(t._truncated, true);
  assert.equal(t.length, long.length);
  assert.equal(typeof t.preview, "string");
  assert.equal((t.preview as string).length, DEFAULT_LARGE_STRING_PREVIEW);
  assert.match(String(t.hint), /element get/);
});

test("slide get --with-children compacts huge svg source; element get and --full-children preserve", () => {
  const cliRoot = fileURLToPath(new URL("..", import.meta.url));
  const bin = join(cliRoot, "bin", "ainobi.mjs");
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-compact-"));
  const pad = "q".repeat(6000);
  const source = `<svg xmlns="http://www.w3.org/2000/svg"><!--${pad}--></svg>`;
  const payloadPath = join(stateDir, "huge-svg.json");
  writeFileSync(
    payloadPath,
    JSON.stringify({
      element_type: "svg",
      name: "huge",
      source,
    }),
    "utf-8",
  );

  const env = {
    ...process.env,
    AINOBI_SESSION: "compact-test",
    AINOBI_STATE_DIR: stateDir,
  };

  const run = (args: string[]) => {
    const r = spawnSync(process.execPath, [bin, ...args, "--pretty=false"], {
      cwd: cliRoot,
      encoding: "utf-8",
      env,
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    return JSON.parse(r.stdout.trim()) as { ok: boolean; data: Record<string, unknown> };
  };

  run(["init", "--name", "Compact", "--language", "en", "--first-slide"]);
  run(["element", "insert", "0", "--type", "svg", "--file", payloadPath]);

  const compactSlide = run(["slide", "get", "0", "--with-children"]);
  const children = (compactSlide.data.slide as Record<string, unknown>).children_elements as unknown[];
  assert.ok(Array.isArray(children) && children.length >= 1);
  const first = children[0] as Record<string, unknown>;
  assert.equal(typeof first.source, "object");
  assert.equal((first.source as Record<string, unknown>)._truncated, true);

  const fullSlide = run(["slide", "get", "0", "--with-children", "--full-children"]);
  const fullChildren = (fullSlide.data.slide as Record<string, unknown>).children_elements as unknown[];
  const fullFirst = fullChildren[0] as Record<string, unknown>;
  assert.equal(typeof fullFirst.source, "string");
  assert.ok((fullFirst.source as string).length > DEFAULT_LARGE_STRING_THRESHOLD);

  const id = fullFirst.element_id as string;
  const one = run(["element", "get", "0", id]);
  const el = (one.data.element as Record<string, unknown>).source;
  assert.equal(typeof el, "string");
  assert.equal(el, fullFirst.source);

  const listVerbose = run(["element", "list", "0", "--verbose"]);
  const listed = (listVerbose.data.elements as unknown[])[0] as Record<string, unknown>;
  assert.equal((listed.source as Record<string, unknown>)._truncated, true);

  const listFull = run(["element", "list", "0", "--verbose", "--full-elements"]);
  const listedFull = (listFull.data.elements as unknown[])[0] as Record<string, unknown>;
  assert.equal(typeof listedFull.source, "string");
  assert.equal(listedFull.source, fullFirst.source);
});
