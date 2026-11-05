// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  BATCH_QUIET_OMIT_RESULTS_MIN_OPS,
  slimBatchOperationResult,
  slimMutationSuccessData,
} from "./quiet-output.ts";

test("slimMutationSuccessData omits batch results when operations_applied is large", () => {
  const slimmed = slimMutationSuccessData(
    {
      operations_applied: BATCH_QUIET_OMIT_RESULTS_MIN_OPS,
      results: [{ op: "element.insert", element_id: "el_a" }],
      dirty: true,
    },
    { omitBatchResults: true },
  ) as Record<string, unknown>;
  assert.equal(slimmed.operations_applied, BATCH_QUIET_OMIT_RESULTS_MIN_OPS);
  assert.equal(slimmed.results, undefined);
  assert.equal(slimmed.dirty, true);
});

test("slimMutationSuccessData keeps small batch results when under threshold", () => {
  const slimmed = slimMutationSuccessData({
    operations_applied: 2,
    results: [
      { op: "element.insert", data: { element_id: "el_a", slide_index: 0 } },
      { op: "element.insert", data: { element_id: "el_b", slide_index: 0 } },
    ],
    dirty: true,
  }) as Record<string, unknown>;
  const results = slimmed.results as Record<string, unknown>[];
  assert.equal(results.length, 2);
  assert.equal(results[0].element_id, "el_a");
});

test("slimMutationSuccessData drops element/asset and slims batch results", () => {
  const slimmed = slimMutationSuccessData({
    slide_id: "el_slide_1",
    element_id: "el_text_1",
    inserted_at: 0,
    element: { position: { x: 1 }, size: { width: 10 } },
    asset: { url: "https://example.com/a.png" },
    results: [
      {
        op: "element.insert",
        id: "op-1",
        data: {
          element_id: "el_text_1",
          slide_index: 0,
          element: { huge: true },
          name: "Title that is fine",
        },
      },
    ],
    dry_run: false,
    dirty: true,
  }) as Record<string, unknown>;

  assert.equal(slimmed.element, undefined);
  assert.equal(slimmed.asset, undefined);
  assert.equal(slimmed.element_id, "el_text_1");
  assert.equal(slimmed.dirty, true);
  const results = slimmed.results as Record<string, unknown>[];
  assert.equal(results.length, 1);
  assert.equal(results[0].op, "element.insert");
  assert.equal(results[0].id, "op-1");
  assert.equal(results[0].element_id, "el_text_1");
  assert.equal(results[0].element, undefined);
});

test("slimMutationSuccessData keeps image generate source URL and drops fat asset", () => {
  const source =
    "https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/png/499ae0156caf1755a9d00fbb75a0a702.png";
  const slimmed = slimMutationSuccessData({
    prompt_chars: 200,
    model: "gpt-image-2",
    size: "1536x1024",
    quality: "high",
    asset: {
      fileId: "bf720bae-11ad-4af1-869b-0a00ee700a0a",
      fileUrl: source,
      note: "x".repeat(2000),
    },
    source,
    file_id: "bf720bae-11ad-4af1-869b-0a00ee700a0a",
    file_name: "p1_cover_fuji.png",
  }) as Record<string, unknown>;

  assert.equal(slimmed.asset, undefined);
  assert.equal(slimmed.source, source);
  assert.equal(slimmed.file_id, "bf720bae-11ad-4af1-869b-0a00ee700a0a");
  assert.equal(slimmed.file_name, "p1_cover_fuji.png");
  assert.equal(slimmed.model, "gpt-image-2");
});

test("slimBatchOperationResult keeps id-like scalars only", () => {
  const slim = slimBatchOperationResult({
    op: "animation.preset",
    data: {
      element_id: "el_x",
      kind: "fade-in",
      from: 0,
      to: 400,
      blob: { nested: true },
    },
  });
  assert.equal(slim.op, "animation.preset");
  assert.equal(slim.element_id, "el_x");
  assert.equal(slim.kind, "fade-in");
  assert.equal(slim.from, 0);
  assert.equal(slim.to, 400);
  assert.equal(slim.blob, undefined);
});

const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const bin = join(cliRoot, "bin", "ainobi.mjs");

const runCli = (
  args: string[],
  env: NodeJS.ProcessEnv,
): { status: number | null; json: Record<string, unknown> } => {
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd: cliRoot,
    encoding: "utf-8",
    env,
  });
  const text = (r.stdout || "").trim().split("\n").filter(Boolean).at(-1) ?? "";
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { parse_error: true, stdout: r.stdout, stderr: r.stderr };
  }
  return { status: r.status, json };
};

test("element insert --quiet omits element summary; --no-quiet keeps it", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-quiet-"));
  const env = {
    ...process.env,
    AINOBI_SESSION: "quiet-test",
    AINOBI_STATE_DIR: stateDir,
    AINOBI_CLI_RUNTIME: "",
  };
  delete (env as { AINOBI_CLI_RUNTIME?: string }).AINOBI_CLI_RUNTIME;

  const init = runCli(["init", "--name", "Quiet", "--language", "en", "--first-slide", "--pretty=false"], env);
  assert.equal(init.status, 0, JSON.stringify(init.json));

  const quiet = runCli(
    [
      "element",
      "insert",
      "0",
      "--type",
      "text",
      "--set",
      "text=Hello",
      "--quiet",
      "--pretty=false",
    ],
    env,
  );
  assert.equal(quiet.status, 0, JSON.stringify(quiet.json));
  const quietData = quiet.json.data as Record<string, unknown>;
  assert.ok(quietData.element_id);
  assert.equal(quietData.element, undefined);

  const full = runCli(
    [
      "element",
      "insert",
      "0",
      "--type",
      "text",
      "--set",
      "text=World",
      "--no-quiet",
      "--pretty=false",
    ],
    env,
  );
  assert.equal(full.status, 0, JSON.stringify(full.json));
  const fullData = full.json.data as Record<string, unknown>;
  assert.ok(fullData.element_id);
  assert.equal(typeof fullData.element, "object");
});

test("agent runtime defaults quiet; batch apply results are slim", () => {
  const stateDir = mkdtempSync(join(tmpdir(), "ainobi-quiet-batch-"));
  const env = {
    ...process.env,
    AINOBI_SESSION: "quiet-batch",
    AINOBI_STATE_DIR: stateDir,
    AINOBI_CLI_RUNTIME: "agent",
  };

  const init = runCli(["init", "--name", "QuietBatch", "--language", "en", "--first-slide"], env);
  assert.equal(init.status, 0, JSON.stringify(init.json));

  const planPath = join(stateDir, "plan.json");
  writeFileSync(
    planPath,
    JSON.stringify({
      operations: [
        {
          op: "element.insert",
          slide: 0,
          element: {
            element_type: "text",
            text: "Batch Hello",
            position: { x: 100, y: 100 },
            size: { width: 400, height: 80 },
          },
        },
        {
          op: "element.insert",
          slide: 0,
          element: {
            element_type: "rectangle",
            color: "#FF0000",
            position: { x: 100, y: 200 },
            size: { width: 200, height: 40 },
          },
        },
      ],
    }),
    "utf-8",
  );

  const applied = runCli(["batch", "apply", "--file", planPath], env);
  assert.equal(applied.status, 0, JSON.stringify(applied.json));
  const data = applied.json.data as Record<string, unknown>;
  assert.equal(data.operations_applied, 2);
  assert.equal(data.dirty, true);
  const results = data.results as Record<string, unknown>[] | undefined;
  assert.ok(Array.isArray(results));
  assert.equal(results!.length, 2);
  for (const row of results!) {
    assert.equal(row.op, "element.insert");
    assert.ok(row.element_id);
    assert.equal(row.element, undefined);
    assert.equal(row.data, undefined);
  }

  const bigPlanPath = join(stateDir, "big-plan.json");
  const bigOps = Array.from({ length: BATCH_QUIET_OMIT_RESULTS_MIN_OPS }, (_, i) => ({
    op: "element.insert",
    slide: 0,
    element: {
      element_type: "text",
      text: `Line ${i}`,
      position: { x: 100, y: 100 + i * 40 },
      size: { width: 400, height: 32 },
    },
  }));
  writeFileSync(bigPlanPath, JSON.stringify({ operations: bigOps }), "utf-8");
  const bigApplied = runCli(["batch", "apply", "--file", bigPlanPath], env);
  assert.equal(bigApplied.status, 0, JSON.stringify(bigApplied.json));
  const bigData = bigApplied.json.data as Record<string, unknown>;
  assert.equal(bigData.operations_applied, BATCH_QUIET_OMIT_RESULTS_MIN_OPS);
  assert.equal(bigData.results, undefined);
});
