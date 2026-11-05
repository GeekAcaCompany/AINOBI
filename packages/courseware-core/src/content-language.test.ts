// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { test } from "vitest";

import {
  CONTENT_LANGUAGES,
  SCENE_LANGUAGE_METADATA_KEY,
  isContentLanguage,
  readSceneContentLanguage,
} from "./content-language.ts";

test("CONTENT_LANGUAGES lists exactly zh / en / ja", () => {
  assert.deepEqual([...CONTENT_LANGUAGES], ["zh", "en", "ja"]);
  assert.equal(SCENE_LANGUAGE_METADATA_KEY, "language");
});

test("isContentLanguage accepts only the exact lowercase codes", () => {
  for (const code of ["zh", "en", "ja"]) assert.equal(isContentLanguage(code), true, code);
  for (const bad of ["ZH", "Ja", "fr", "zh-CN", "", " en", undefined, null, 1, {}]) {
    assert.equal(isContentLanguage(bad), false, JSON.stringify(bad));
  }
});

test("readSceneContentLanguage returns metadata.language when valid", () => {
  const scene = { metadata: { language: "ja", theme: "default" } };
  assert.equal(readSceneContentLanguage(scene), "ja");
});

test("readSceneContentLanguage returns null when missing or invalid, without mutating the scene", () => {
  const missing: Record<string, unknown> = { metadata: { theme: "default" } };
  const noMetadata: Record<string, unknown> = {};
  const invalid: Record<string, unknown> = { metadata: { language: "fr" } };
  const snapshot = JSON.stringify([missing, noMetadata, invalid]);
  assert.equal(readSceneContentLanguage(missing), null);
  assert.equal(readSceneContentLanguage(noMetadata), null);
  assert.equal(readSceneContentLanguage(invalid), null);
  assert.equal(JSON.stringify([missing, noMetadata, invalid]), snapshot);
});
