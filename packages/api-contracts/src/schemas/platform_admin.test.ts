// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Platform admin domain schema unit tests — the parts whose validation semantics match pydantic v2 verbatim
 * (reason strip, model-level loc=() → "body", cross-field ordering, date text, full-width folding).
 */

import { describe, expect, it } from "vitest";
import {
  EnterpriseSubscriptionGrantRequestSchema,
  EnterpriseSubscriptionUpdateRequestSchema,
  PlatformAdminLoginRequestSchema,
  TtsPronunciationCreateRequestSchema,
  foldFullwidthDigits,
  pyDateQuery,
} from "./platform_admin.ts";

describe("platform_admin schemas", () => {

function issuesOf(result: {
  success: boolean;
  error?: { issues: Array<{ path: readonly PropertyKey[]; message: string }> };
}): Array<{ path: string; message: string }> {
  expect(result.success).toBe(false);
  return (result.error?.issues ?? []).map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

const validGrantBase = {
  admin_seats: 2,
  teacher_seats: 3,
  student_seats: 0,
  monthly_credits: 1000,
  storage_limit_bytes: 1073741824,
  expired_at: "2099-01-01T00:00:00Z",
  reason: "audit",
};

it("reason：全空白报非空（无 Value error 前缀——Python handlers 统一剥离）", () => {
  const result = ConvertOrgReasonCheck();
  function ConvertOrgReasonCheck() {
    // Borrows the reason field of the grant schema (the same reasonField as ConvertOrgTypeRequestSchema)
    return EnterpriseSubscriptionGrantRequestSchema.safeParse({ ...validGrantBase, reason: "   " });
  }
  const [issue] = issuesOf(result);
  expect(issue.path).toBe("reason");
  expect(issue.message).toBe("reason must not be blank");
});

it("reason：strip 后值生效；长度约束按原始值判定", () => {
  const parsed = EnterpriseSubscriptionGrantRequestSchema.safeParse({
    ...validGrantBase,
    reason: "  parity  ",
  });
  expect(parsed.success).toBe(true);
  if (parsed.success) {
    expect(parsed.data.reason).toBe("parity");
  }
  // 501 characters (including surrounding whitespace) → too_big on the raw length
  const tooLong = EnterpriseSubscriptionGrantRequestSchema.safeParse({
    ...validGrantBase,
    reason: `  ${"x".repeat(500)}  `,
  });
  expect(tooLong.success).toBe(false);
});

it("expired_at 过去时：单条字段错误（model validator 语义——不追加交叉错误）", () => {
  const result = EnterpriseSubscriptionGrantRequestSchema.safeParse({
    ...validGrantBase,
    expired_at: "2020-01-01T00:00:00Z",
  });
  const issues = issuesOf(result);
  expect(issues.length).toBe(1);
  expect(issues[0].path).toBe("expired_at");
  expect(issues[0].message).toBe("expired_at must be in the future");
});

it("started_at 超 24h 未来：单条字段错误（不追加交叉错误）", () => {
  const result = EnterpriseSubscriptionGrantRequestSchema.safeParse({
    ...validGrantBase,
    started_at: "2098-01-01T00:00:00Z",
  });
  const issues = issuesOf(result);
  expect(issues.length).toBe(1);
  expect(issues[0].path).toBe("started_at");
  expect(issues[0].message).toBe("started_at must not be more than 24 hours in the future");
});

it("started_at ≥ expired_at（字段各自合法）：仅交叉错误，归属 started_at", () => {
  // Both fields must be valid on their own: expired in the future, started within the 24h window → only the cross check fails
  const boundary = new Date(Date.now() + 3600_000).toISOString();
  const result = EnterpriseSubscriptionGrantRequestSchema.safeParse({
    ...validGrantBase,
    expired_at: boundary,
    started_at: boundary,
  });
  const issues = issuesOf(result);
  expect(issues.length).toBe(1);
  expect(issues[0].path).toBe("started_at");
  expect(issues[0].message).toBe("started_at must be before expired_at");
});

it("started_at 24h 内的未来 + 早于 expired_at：通过", () => {
  const now = new Date();
  const started = new Date(now.getTime() + 12 * 3600_000).toISOString();
  const result = EnterpriseSubscriptionGrantRequestSchema.safeParse({
    ...validGrantBase,
    started_at: started,
  });
  expect(result.success).toBe(true);
});

it("update 双真：模型级错误 loc=() → 字段名渲染为 body", () => {
  const result = EnterpriseSubscriptionUpdateRequestSchema.safeParse({
    ...validGrantBase,
    resume_scheduled_cancel: true,
    cancel_scheduled_downgrade: true,
  });
  const [issue] = issuesOf(result);
  expect(issue.path).toBe("body");
  expect(
    issue.message,
    "resume_scheduled_cancel and cancel_scheduled_downgrade cannot both be true",
  );
});

it("登录密码 pattern 文案逐字对齐", () => {
  const result = PlatformAdminLoginRequestSchema.safeParse({
    identifier: "admin",
    account_password: "short",
  });
  const [issue] = issuesOf(result);
  expect(issue.path).toBe("account_password");
  expect(issue.message).toBe("String should match pattern '^[^\\s]{6,64}$'");
});

it("pyDateQuery：pydantic v2 date 解析文案逐例对齐", () => {
  const cases: Array<[string, string]> = [
    ["not-a-date", "Input should be a valid date or datetime, invalid character in year"],
    ["", "Input should be a valid date or datetime, input is too short"],
    ["2026-1-1", "Input should be a valid date or datetime, input is too short"],
    ["2026-13-01", "Input should be a valid date or datetime, month value is outside expected range of 1-12"],
    ["2026-02-30", "Input should be a valid date or datetime, day value is outside expected range"],
  ];
  for (const [value, expected] of cases) {
    const result = pyDateQuery().safeParse(value);
    expect(result.success).toBe(false, value);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(expected, value);
    }
  }
  // Valid dates (including leap days) pass
  expect(pyDateQuery().safeParse("2024-02-29").success).toBe(true);
  expect(pyDateQuery().safeParse("2026-09-30").success).toBe(true);
});

it("tts source_text：strip + 全角数字折叠（与匹配器键对齐）", () => {
  const parsed = TtsPronunciationCreateRequestSchema.safeParse({
    source_text: " ９月 ",
    language: "ja",
    pronunciation: " クガツ ",
  });
  expect(parsed.success).toBe(true);
  if (parsed.success) {
    expect(parsed.data.source_text).toBe("9月");
    expect(parsed.data.pronunciation).toBe("クガツ");
  }
});

it("tts remark：全空白折叠为 null", () => {
  const parsed = TtsPronunciationCreateRequestSchema.safeParse({
    source_text: "テスト",
    language: "ja",
    pronunciation: "テスト",
    remark: "   ",
  });
  expect(parsed.success).toBe(true);
  if (parsed.success) {
    expect(parsed.data.remark).toBe(null);
  }
});

it("foldFullwidthDigits：０-９ → 0-9", () => {
  expect(foldFullwidthDigits("１２３４５６７８９０")).toBe("1234567890");
  expect(foldFullwidthDigits("混在９月と9月")).toBe("混在9月と9月");
  expect(foldFullwidthDigits("no-digits")).toBe("no-digits");
});

});
