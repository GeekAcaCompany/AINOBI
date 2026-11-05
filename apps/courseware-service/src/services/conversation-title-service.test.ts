// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  detectTitleLocaleFromPrompt,
  parseTitleLocale,
  resolveTitleLocale,
} from "./conversation-title-service.ts";

test("parseTitleLocale accepts only zh / en / ja", () => {
  assert.equal(parseTitleLocale(" ZH "), "zh");
  assert.equal(parseTitleLocale("ja"), "ja");
  assert.equal(parseTitleLocale("en"), "en");
  assert.equal(parseTitleLocale("ko"), undefined);
  assert.equal(parseTitleLocale(""), undefined);
  assert.equal(parseTitleLocale(undefined), undefined);
});

test("detectTitleLocaleFromPrompt: kana wins, then CJK, else English", () => {
  assert.equal(detectTitleLocaleFromPrompt("スライドを作ってください"), "ja");
  assert.equal(detectTitleLocaleFromPrompt("帮我做一个课件"), "zh");
  assert.equal(detectTitleLocaleFromPrompt("Make a deck about AWS"), "en");
  assert.equal(detectTitleLocaleFromPrompt("   "), "en");
});

test("resolveTitleLocale prefers UI language, then text detection, then English", () => {
  assert.equal(resolveTitleLocale("Make a deck", "ja"), "ja");
  assert.equal(resolveTitleLocale("こんにちは、スライドを作って", undefined), "ja");
  assert.equal(resolveTitleLocale("帮我做一个课件", null), "zh");
  assert.equal(resolveTitleLocale("Make a deck", undefined), "en");
  // Unsupported UI locale falls through to text detection, never to Chinese.
  assert.equal(resolveTitleLocale("こんにちは", "ko"), "ja");
  assert.equal(resolveTitleLocale("Make a deck", "ko"), "en");
  assert.equal(resolveTitleLocale("", null), "en");
});
