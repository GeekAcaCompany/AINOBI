// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const bin = join(cliRoot, "bin", "ainobi.mjs");

test("ainobi recall requires agent runtime and reads id at positionals[0]", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-recall-"));
  const env = {
    ...process.env,
    AINOBI_SESSION: "recall-test",
    AINOBI_STATE_DIR: stateDir,
    AINOBI_CLI_RUNTIME: "agent",
    AINOBI_TOOL_RESULT_RECALL_HOST_URL: "http://127.0.0.1:9/courseware/tool-result/recall",
  };

  // Without an id → USAGE (proves path dispatches; id is required at remaining [0])
  const missing = spawnSync(process.execPath, [bin, "recall", "--pretty=false"], {
    cwd: cliRoot,
    encoding: "utf-8",
    env,
  });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr || missing.stdout, /Usage: ainobi recall <id>/);

  // With an id → attempts host call (not USAGE about missing id)
  const withId = spawnSync(
    process.execPath,
    [bin, "recall", "11111111-1111-1111-1111-111111111111", "--pretty=false"],
    {
      cwd: cliRoot,
      encoding: "utf-8",
      env,
    },
  );
  assert.notEqual(withId.status, 0);
  const err = `${withId.stderr || ""}\n${withId.stdout || ""}`;
  assert.doesNotMatch(err, /Usage: ainobi recall <id>/);
  assert.match(err, /recall host|fetch|ECONNREFUSED|network|failed|IO_ERROR/i);
});
