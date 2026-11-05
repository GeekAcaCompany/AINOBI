// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { AinobiCliError } from "./errors.ts";
import { applyOperation, SUPPORTED_BATCH_OPS } from "./operations.ts";

test("every SUPPORTED_BATCH_OPS entry is dispatched (list stays in sync with the switch)", () => {
  for (const op of SUPPORTED_BATCH_OPS) {
    const scene: Record<string, unknown> = { slide_elements: [], quiz: { enabled: false, questions: [] }, metadata: {} };
    try {
      applyOperation(scene, { op } as never);
    } catch (error) {
      // Missing args are fine; only "Unsupported batch operation" means the list drifted.
      assert.ok(!(error instanceof AinobiCliError && error.code === "UNSUPPORTED" && /Unsupported batch operation/.test(error.message)), op);
    }
  }
});

test("unsupported batch ops list the supported ones", () => {
  assert.throws(
    () => applyOperation({ slide_elements: [] }, { op: "element.move" } as never),
    (error: unknown) =>
      error instanceof AinobiCliError &&
      error.code === "UNSUPPORTED" &&
      /Supported ops: scene\.update, slide\.insert/.test(error.hint ?? ""),
  );
});
