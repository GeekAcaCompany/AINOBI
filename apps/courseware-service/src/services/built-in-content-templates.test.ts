// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BUILT_IN_CONTENT_TEMPLATES,
  getBuiltInContentTemplateById,
  isBuiltInContentTemplateId,
  readBuiltInKeyFromSourceMeta,
} from "./built-in-content-templates.ts";

test("built-in content templates expose stable ids for strict and fun modes", () => {
  assert.equal(BUILT_IN_CONTENT_TEMPLATES.length, 2);
  const strict = BUILT_IN_CONTENT_TEMPLATES.find((t) => t.key === "strict");
  const fun = BUILT_IN_CONTENT_TEMPLATES.find((t) => t.key === "fun");
  assert.equal(strict?.name, "Strict Mode");
  assert.equal(fun?.name, "Fun Mode");
  assert.match(strict?.description ?? "", /medical\/legal\/finance/i);
  assert.match(strict?.content ?? "", /Auto-activation/i);
  assert.equal(isBuiltInContentTemplateId(strict!.id), true);
  assert.equal(getBuiltInContentTemplateById(fun!.id)?.key, "fun");
});

test("built-in content templates read builtInKey from source_meta", () => {
  assert.equal(readBuiltInKeyFromSourceMeta({ builtInKey: "strict" }), "strict");
  assert.equal(readBuiltInKeyFromSourceMeta({ builtInKey: "other" }), null);
  assert.equal(readBuiltInKeyFromSourceMeta(null), null);
});
