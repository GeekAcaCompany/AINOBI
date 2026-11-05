// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { coursewareCliRoot } from "../runtime-paths.ts";

import {
  clearAinobiCliHelpContextCache,
  getAinobiCliHelpContext,
} from "./ainobi-cli-help-context.ts";

const projectRoot = resolve(import.meta.dirname, "../..");
const cliBinPath = [
  resolve(coursewareCliRoot, "bin"),
  process.env.PATH ?? "",
].join(":");

test("L0 SKILL.md points at L1 topics", () => {
  const skill = readFileSync(resolve(coursewareCliRoot, "SKILL.md"), "utf8");
  assert.match(skill, /references\/topics\/quiz\.md/);
  assert.match(skill, /references\/topics\/narration\.md/);
  assert.match(skill, /L0 core|Topic index \(L1/);
});

test("slim help context omits full narration/quiz dumps by default", () => {
  clearAinobiCliHelpContextCache();
  const prev = process.env.CHAT_AINOBI_HELP_CONTEXT;
  delete process.env.CHAT_AINOBI_HELP_CONTEXT;
  try {
    const help = getAinobiCliHelpContext({
      cwd: projectRoot,
      path: cliBinPath,
    });
    assert.ok(help.includes("Common pitfalls"));
    assert.ok(help.includes("Slim CLI index") || help.includes("High-frequency"));
    assert.ok(!help.includes("### ainobi help narration"));
    assert.ok(!help.includes("### ainobi help quiz"));
    assert.ok(help.length < 20_000, `slim help still large: ${help.length}`);
  } finally {
    if (prev === undefined) {
      delete process.env.CHAT_AINOBI_HELP_CONTEXT;
    } else {
      process.env.CHAT_AINOBI_HELP_CONTEXT = prev;
    }
    clearAinobiCliHelpContextCache();
  }
});

test("CHAT_AINOBI_HELP_CONTEXT=false disables help injection", () => {
  clearAinobiCliHelpContextCache();
  const prev = process.env.CHAT_AINOBI_HELP_CONTEXT;
  process.env.CHAT_AINOBI_HELP_CONTEXT = "false";
  try {
    assert.equal(
      getAinobiCliHelpContext({ cwd: projectRoot, path: cliBinPath }),
      "",
    );
  } finally {
    if (prev === undefined) {
      delete process.env.CHAT_AINOBI_HELP_CONTEXT;
    } else {
      process.env.CHAT_AINOBI_HELP_CONTEXT = prev;
    }
    clearAinobiCliHelpContextCache();
  }
});
