// SPDX-License-Identifier: AGPL-3.0-only
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { rejectForbiddenPatchKeys, ELEMENT_PATCH_FORBIDDEN } from "./mutation-guards.ts";
import { AinobiCliError } from "./errors.ts";

test("rejectForbiddenPatchKeys throws on element_id", () => {
  assert.throws(
    () => rejectForbiddenPatchKeys({ element_id: "el_fake" }, ELEMENT_PATCH_FORBIDDEN, "test.patch"),
    (error: unknown) =>
      error instanceof AinobiCliError &&
      error.code === "INVALID_INPUT" &&
      /element_id/.test(error.message),
  );
});

const root = fileURLToPath(new URL("..", import.meta.url));
const bin = join(root, "bin", "ainobi.mjs");

const runBatchExpectFailure = (stateDir: string, operations: unknown[]) => {
  const batchPath = join(stateDir, "batch.json");
  writeFileSync(batchPath, JSON.stringify({ operations }));
  const result = spawnSync(
    process.execPath,
    [bin, "batch", "apply", batchPath, "--pretty=false"],
    {
      cwd: root,
      encoding: "utf-8",
      env: {
        ...process.env,
        AINOBI_STATE_DIR: stateDir,
        AINOBI_SHELL_SESSION: "mutation-guard-batch",
      },
    },
  );
  assert.notEqual(result.status, 0);
  const text = (result.stderr || result.stdout).trim();
  const parsed = JSON.parse(text) as { ok: false; error?: { code?: string; message?: string } };
  assert.equal(parsed.ok, false);
  return parsed.error;
};

test("batch slide.update rejects element_id in patch", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-mutation-guard-"));
  spawnSync(process.execPath, [bin, "init", "--name", "G", "--language", "en", "--first-slide", "--pretty=false"], {
    cwd: root,
    env: { ...process.env, AINOBI_STATE_DIR: stateDir, AINOBI_SHELL_SESSION: "mutation-guard-batch" },
  });
  const error = runBatchExpectFailure(stateDir, [
    { op: "slide.update", slide: 0, patch: { element_id: "el_hijack" } },
  ]);
  assert.equal(error?.code, "INVALID_INPUT");
  assert.match(error?.message ?? "", /element_id/);
});

test("batch element.update rejects element_id in patch", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-mutation-guard-el-"));
  spawnSync(process.execPath, [bin, "init", "--name", "G", "--language", "en", "--first-slide", "--pretty=false"], {
    cwd: root,
    env: { ...process.env, AINOBI_STATE_DIR: stateDir, AINOBI_SHELL_SESSION: "mutation-guard-batch" },
  });
  spawnSync(
    process.execPath,
    [bin, "element", "insert", "0", "--type", "text", "--set", "text=hi", "--pretty=false"],
    {
      cwd: root,
      env: { ...process.env, AINOBI_STATE_DIR: stateDir, AINOBI_SHELL_SESSION: "mutation-guard-batch" },
    },
  );
  const error = runBatchExpectFailure(stateDir, [
    { op: "element.update", slide: 0, element: 0, patch: { element_id: "el_other" } },
  ]);
  assert.equal(error?.code, "INVALID_INPUT");
  assert.match(error?.message ?? "", /element_id/);
});
