// SPDX-License-Identifier: AGPL-3.0-only
/**
 * pyDate unit tests — side-by-side samples of pydantic v2 (speedate core) date parsing text.
 * Source: case-by-case probes of Python :8001 /v1/learning/learning-duration on 2026-10-16.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { pyDate } from "./helpers.ts";

describe("py_date schemas", () => {

function parse(value: unknown): { ok: boolean; message?: string } {
  const result = z.object({ d: pyDate() }).safeParse({ d: value });
  if (result.success) {
    return { ok: true };
  }
  return { ok: false, message: result.error.issues[0]?.message };
}

it("合法日期原样通过", () => {
  expect(parse("2026-01-01")).toEqual({ ok: true });
});

it("零时刻 datetime 接受（.date() 语义取日期部分）", () => {
  expect(parse("2026-01-01T00:00:00Z")).toEqual({ ok: true });
  expect(parse("2026-01-01 00:00:00")).toEqual({ ok: true });
  expect(parse("2026-01-01T00:00:00+09:00")).toEqual({ ok: true });
});

it("短输入 → input is too short", () => {
  expect(parse("bogus").message).toBe("Input should be a valid date or datetime, input is too short");
  expect(parse("2026-1-1").message).toBe("Input should be a valid date or datetime, input is too short");
});

it("分隔符错误 → invalid date separator", () => {
  expect(
    parse("2026/01/01").message,
    "Input should be a valid date or datetime, invalid date separator, expected `-`",
  );
});

it("月份越界 → month value is outside expected range of 1-12", () => {
  expect(
    parse("2026-13-01").message,
    "Input should be a valid date or datetime, month value is outside expected range of 1-12",
  );
  expect(
    parse("2026-00-01").message,
    "Input should be a valid date or datetime, month value is outside expected range of 1-12",
  );
});

it("日期越界（含平年 2 月） → day value is outside expected range", () => {
  expect(
    parse("2026-02-30").message,
    "Input should be a valid date or datetime, day value is outside expected range",
  );
  expect(
    parse("2026-01-32").message,
    "Input should be a valid date or datetime, day value is outside expected range",
  );
});

it("非零时刻 → Datetimes provided to dates should have zero time", () => {
  expect(
    parse("2026-01-01T10:00:00").message,
    "Datetimes provided to dates should have zero time - e.g. be exact dates",
  );
  expect(
    parse("2026-01-01T00:00:01").message,
    "Datetimes provided to dates should have zero time - e.g. be exact dates",
  );
});

it("非零微秒 → Datetimes provided to dates should have zero time", () => {
  expect(
    parse("2026-01-01T00:00:00.000001").message,
    "Datetimes provided to dates should have zero time - e.g. be exact dates",
  );
  expect(
    parse("2026-01-01 00:00:00.1").message,
    "Datetimes provided to dates should have zero time - e.g. be exact dates",
  );
  expect(
    parse("2026-01-01T00:00:00.000001Z").message,
    "Datetimes provided to dates should have zero time - e.g. be exact dates",
  );
});

it("微秒截断：仅看小数秒前 6 位（pydantic 实证 2026-10-21）", () => {
  // First 6 digits all zero → 0 microseconds after truncation → midnight accepted (takes the date part)
  expect(parse("2026-01-01T00:00:00.0000009")).toEqual({ ok: true });
  expect(parse("2026-01-01 00:00:00.000000000001")).toEqual({ ok: true });
  expect(parse("2026-01-01T00:00:00.00000012345678")).toEqual({ ok: true });
  // A non-zero digit in the first 6 → non-zero microseconds → refused
  expect(
    parse("2026-01-01T00:00:00.0000019").message,
    "Datetimes provided to dates should have zero time - e.g. be exact dates",
  );
  expect(
    parse("2026-01-01T00:00:00.0000010000000000009").message,
    "Datetimes provided to dates should have zero time - e.g. be exact dates",
  );
  // With fewer than 6 digits the whole part counts
  expect(
    parse("2026-01-01T00:00:00.9").message,
    "Datetimes provided to dates should have zero time - e.g. be exact dates",
  );
});

it("全零微秒的零时刻接受（取日期部分）", () => {
  expect(parse("2026-01-01T00:00:00.000000")).toEqual({ ok: true });
  expect(parse("2026-01-01T00:00:00.000")).toEqual({ ok: true });
});

it("零时刻 datetime 输出归一为日期部分", () => {
  const result = z.object({ d: pyDate() }).parse({ d: "2026-01-01T00:00:00Z" });
  expect(result.d).toBe("2026-01-01");
});

});
