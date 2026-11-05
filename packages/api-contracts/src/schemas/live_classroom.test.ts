// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Live classroom / interaction section schema unit tests — the date acceptance surface (midnight datetime truncation) and
 * null refusal of non-Optional bools (verified side by side against a pydantic v2 venv on 2026-10-21).
 */

import { describe, expect, it } from "vitest";
import {
  LiveClassroomCreateRequestSchema,
  LiveClassroomUpdateRequestSchema,
} from "./live_classroom.ts";
import { InteractionSectionCreateRequestSchema } from "./interaction_section.ts";

describe("live_classroom schemas", () => {

function parseStartDate(value: unknown) {
  const result = LiveClassroomCreateRequestSchema.safeParse({
    classroom_name: "教室",
    timezone: "Asia/Tokyo",
    start_date: value,
  });
  return result.success
    ? { ok: true as const, date: result.data.start_date }
    : { ok: false as const, message: result.error.issues[0]?.message };
}

it("start_date：纯日期与零时刻 datetime 均接受（截断为日期部分）", () => {
  expect(parseStartDate("2026-01-01")).toEqual({ ok: true, date: "2026-01-01" });
  expect(parseStartDate("2026-01-01T00:00:00")).toEqual({ ok: true, date: "2026-01-01" });
  expect(parseStartDate("2026-01-01 00:00:00Z")).toEqual({ ok: true, date: "2026-01-01" });
  expect(parseStartDate("2026-01-01T00:00")).toEqual({ ok: true, date: "2026-01-01" });
  expect(parseStartDate("2026-01-01T00:00:00+09:00")).toEqual({ ok: true, date: "2026-01-01" });
  expect(parseStartDate(null)).toEqual({ ok: true, date: null });
});

it("start_date：非零时刻拒绝（date_from_datetime_inexact 同款文案）", () => {
  expect(
    parseStartDate("2026-01-01T10:00:00").message,
    "Datetimes provided to dates should have zero time - e.g. be exact dates",
  );
});

it("start_date：坏格式拒绝（speedate 风格文案）", () => {
  expect(parseStartDate("bogus").message).toBe("Input should be a valid date or datetime, input is too short");
  expect(parseStartDate("2026-1-1").message).toBe("Input should be a valid date or datetime, input is too short");
  expect(
    parseStartDate("2026-02-30").message,
    "Input should be a valid date or datetime, day value is outside expected range",
  );
  expect(
    parseStartDate("2026/01/01").message,
    "Input should be a valid date or datetime, invalid date separator, expected `-`",
  );
});

it("update schema 的 start_date 同一接受面", () => {
  const result = LiveClassroomUpdateRequestSchema.safeParse({ start_date: "2026-01-01T00:00:00" });
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.start_date).toBe("2026-01-01");
  }
});

it("is_required：非 Optional bool——缺失默认 false、宽松形态可解、null 拒绝", () => {
  expect(InteractionSectionCreateRequestSchema.parse({}).is_required).toBe(false);
  expect(InteractionSectionCreateRequestSchema.parse({ is_required: true }).is_required).toBe(true);
  expect(InteractionSectionCreateRequestSchema.parse({ is_required: "true" }).is_required).toBe(true);
  expect(InteractionSectionCreateRequestSchema.parse({ is_required: 1 }).is_required).toBe(true);
  expect(InteractionSectionCreateRequestSchema.safeParse({ is_required: null }).success).toBe(false);
  expect(InteractionSectionCreateRequestSchema.safeParse({ is_required: "notabool" }).success).toBe(false);
});

});
