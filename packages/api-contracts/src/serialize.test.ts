// SPDX-License-Identifier: AGPL-3.0-only
import { test } from "vitest";
import assert from "node:assert/strict";
import { pyJsonStringify, pyQuote, toPythonIso, stringifyPython } from "./serialize.ts";

test("toPythonIso 输出 Z 后缀（pydantic JSON 格式）", () => {
  const date = new Date("2026-10-14T12:00:00Z");
  assert.equal(toPythonIso(date), "2026-10-14T12:00:00Z");
});

test("toPythonIso 微秒非零时固定 6 位小数", () => {
  const date = new Date("2026-10-14T12:00:00.123Z");
  assert.equal(toPythonIso(date), "2026-10-14T12:00:00.123000Z");
});

test("toPythonIso 微秒为零时不输出小数位", () => {
  const date = new Date("2026-01-02T03:04:05.000Z");
  assert.equal(toPythonIso(date), "2026-01-02T03:04:05Z");
});

test("stringifyPython 深转换嵌套 Date（先于 toJSON）", () => {
  const value = { id: "u-1", created_at: new Date("2026-10-14T12:00:00Z"), nested: { at: new Date("2026-10-14T12:00:00.500Z") } };
  assert.equal(
    stringifyPython(value),
    '{"id":"u-1","created_at":"2026-10-14T12:00:00Z","nested":{"at":"2026-10-14T12:00:00.500000Z"}}',
  );
});

test("stringifyPython null 保持 null（Python Optional 序列化）", () => {
  assert.equal(stringifyPython({ a: null }), '{"a":null}');
});

test("ascii 模式：非 ASCII 转 \\uXXXX（成功封套 ensure_ascii=True 语义）", () => {
  assert.equal(
    stringifyPython({ name: "E2E 企业管理员" }, { ascii: true }),
    '{"name":"E2E \\u4f01\\u4e1a\\u7ba1\\u7406\\u5458"}',
  );
});

test("spacedSeparators：json.dumps 默认分隔符（', '/': '，仅结构位置）", () => {
  assert.equal(
    stringifyPython({ a: 1, b: "x,y:z" }, { spacedSeparators: true }),
    '{"a": 1, "b": "x,y:z"}',
  );
});

test("ascii + spacedSeparators 组合（成功封套完整语义）", () => {
  assert.equal(
    stringifyPython({ code: 0, name: "企业" }, { ascii: true, spacedSeparators: true }),
    '{"code": 0, "name": "\\u4f01\\u4e1a"}',
  );
});

test("默认模式：非 ASCII 原样（错误封套 ensure_ascii=False 语义）", () => {
  assert.equal(stringifyPython({ name: "企业" }), '{"name":"企业"}');
});

test("ascii 模式：0x7f（DEL）也转义（json.dumps 的 ESCAPE_ASCII 集仅保留 0x20-0x7e）", () => {
  assert.equal(
    stringifyPython({ v: "x\u007fy" }, { ascii: true }),
    '{"v":"x\\u007fy"}',
  );
});

test("pyQuote 与 urllib.parse.quote 逐例对拍（含 safe 集）", () => {
  assert.equal(pyQuote("a/b+c d"), "a%2Fb%2Bc%20d");
  assert.equal(pyQuote("a/b+c d", "/"), "a/b%2Bc%20d");
  assert.equal(pyQuote("teaching materials/ファイル.png", "/"), "teaching%20materials/%E3%83%95%E3%82%A1%E3%82%A4%E3%83%AB.png");
  assert.equal(pyQuote("Abc09_.-~x"), "Abc09_.-~x");
  assert.equal(pyQuote(""), "");
  assert.equal(pyQuote("%%"), "%25%25");
  assert.equal(pyQuote("a~b+c", "/~"), "a~b%2Bc");
});

test("pyJsonStringify 与 json.dumps 默认形态逐例对拍", () => {
  // policy form: separators ", "/": ", key order kept in insertion order
  assert.equal(
    pyJsonStringify({
      expiration: "2026-10-20T06:50:00Z",
      conditions: [
        { bucket: "b" },
        { "Content-Type": 'text/plain; charset="utf-8"' },
        ["starts-with", "$key", "dir/sub dir/"],
      ],
    }),
    '{"expiration": "2026-10-20T06:50:00Z", "conditions": [{"bucket": "b"}, {"Content-Type": "text/plain; charset=\\"utf-8\\""}, ["starts-with", "$key", "dir/sub dir/"]]}',
  );
  // The full string escape set: DEL / short control-character escapes / \uXXXX lowercase hex / astral surrogate pairs
  assert.equal(
    pyJsonStringify("del:\u007f nl:\n tab:\t bs:\b ff:\f q:\" bslash:\\ uni:あ star:😀 ctl:\u0001"),
    '"del:\\u007f nl:\\n tab:\\t bs:\\b ff:\\f q:\\" bslash:\\\\ uni:\\u3042 star:\\ud83d\\ude00 ctl:\\u0001"',
  );
  assert.equal(
    pyJsonStringify(["a", 1, true, null, 2.5]),
    '["a", 1, true, null, 2.5]',
  );
  assert.equal(pyJsonStringify(null), "null");
});
