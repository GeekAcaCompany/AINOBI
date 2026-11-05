// SPDX-License-Identifier: AGPL-3.0-only
import { test } from "vitest";
import assert from "node:assert/strict";
import { ApiError, ErrorCode, getErrorMessage, raiseNotFound } from "./errors.ts";

test("ErrorCode 数值规则：前三位 HTTP 状态码", () => {
  assert.equal(ErrorCode.INVALID_TOKEN, 403001);
  assert.equal(ErrorCode.USER_NOT_FOUND, 404001);
  assert.equal(ErrorCode.VALIDATION_ERROR, 422001);
});

test("ApiError 默认状态码从错误码前三位提取", () => {
  const error = new ApiError(ErrorCode.INVALID_TOKEN);
  assert.equal(error.status, 403);
  assert.equal(error.message, "Invalid or expired access token");
  assert.equal(error.success, false);
});

test("ApiError 显式 message 覆盖默认", () => {
  const error = new ApiError(ErrorCode.USER_NOT_FOUND, "User 'x' not found", 404);
  assert.equal(error.status, 404);
  assert.equal(error.message, "User 'x' not found");
});

test("ApiError data 透传（retry_after_seconds 场景）", () => {
  const error = new ApiError(ErrorCode.ACCOUNT_LOCKED, undefined, 423, {
    data: { retry_after_seconds: 600 },
  });
  assert.deepEqual(error.data, { retry_after_seconds: 600 });
});

test("getErrorMessage 未知码回落 Unknown error", () => {
  assert.equal(getErrorMessage(999999), "Unknown error");
});

test("403012 双语义：值为 CHILD_ORGANIZATION_BILLING（Python 后定义胜出）", () => {
  assert.equal(ErrorCode.AGENT_ONLY_ENDPOINT, 403012);
  assert.equal(ErrorCode.CHILD_ORGANIZATION_BILLING_FORBIDDEN, 403012);
  assert.equal(
    getErrorMessage(403012),
    "Child organizations cannot manage billing directly. Please contact the parent organization's administrator to top up and allocate credits.",
  );
});

test("raiseNotFound 按实体类型分派错误码", () => {
  assert.throws(() => raiseNotFound("user", "u1"), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, ErrorCode.USER_NOT_FOUND);
    assert.equal(error.status, 404);
    return true;
  });
  assert.throws(() => raiseNotFound("widget", "w1"), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, ErrorCode.NOT_FOUND);
    return true;
  });
});
