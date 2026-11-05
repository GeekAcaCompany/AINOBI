// SPDX-License-Identifier: AGPL-3.0-only
/**
 * User domain schema unit tests — pydantic semantic alignment of the new request schemas
 * (validation bounds + error text, covering the message branches of the 422 envelope).
 */

import { describe, expect, it } from "vitest";
import {
  UserUpdateRequestSchema,
  StaffProfileUpdateRequestSchema,
  StudentProfileUpdateRequestSchema,
  UserChangePasswordRequestSchema,
  UserRegisterRequestSchema,
  UserListRequestSchema,
} from "./user.ts";
import { UserFileRegisterRequestSchema, UserFileListRequestSchema } from "./user_file.ts";
import { ActivationActivateRequestSchema } from "./enterprise_member.ts";

describe("user_file schemas", () => {

/** The [path, message] list of a failed zod validation */
function issues(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) {
  expect(result.success).toBe(false);
  return result.error!.issues.map((issue) => [issue.path.join("."), issue.message] as const);
}

it("UserUpdateRequest：头像 URL 协议校验（首错即报，不叠加）", () => {
  expect(UserUpdateRequestSchema.safeParse({ user_avatar_url: "https://x/y.png" }).success).toBe(true);
  expect(UserUpdateRequestSchema.safeParse({ user_avatar_url: null }).success).toBe(true);
  expect(issues(UserUpdateRequestSchema.safeParse({ user_avatar_url: "not a url" }))).toEqual([
    ["user_avatar_url", "user_avatar_url must be a valid URL"],
  ]);
  expect(issues(UserUpdateRequestSchema.safeParse({ user_avatar_url: "ftp://x/y" }))).toEqual([
    ["user_avatar_url", "user_avatar_url must use http or https protocol"],
  ]);
});

it("StaffProfileUpdateRequest：name 去空白 + 拒绝空白名", () => {
  const parsed = StaffProfileUpdateRequestSchema.parse({ name: "  bob  " });
  expect(parsed.name).toBe("bob");
  expect(issues(StaffProfileUpdateRequestSchema.safeParse({ name: "   " }))).toEqual([
    ["name", "name must not be blank"],
  ]);
  // null = unchanged
  const untouched = StaffProfileUpdateRequestSchema.parse({ name: null, introduction: "" });
  expect(untouched.name).toBe(null);
  expect(untouched.introduction).toBe("");
  // Too long (the 60 limit is checked on the raw text before strip)
  expect(issues(StaffProfileUpdateRequestSchema.safeParse({ name: "x".repeat(61) })).map((i) => i[1])).toEqual([
    "Too big: expected string to have <=60 characters",
  ]);
});

it("StudentProfileUpdateRequest：与员工版同构", () => {
  expect(StudentProfileUpdateRequestSchema.safeParse({}).success).toBe(true);
  expect(issues(StudentProfileUpdateRequestSchema.safeParse({ name: "" }))).toEqual([
    ["name", "name must not be blank"],
  ]);
  expect(issues(StudentProfileUpdateRequestSchema.safeParse({ avatar_url: "gopher://x" }))).toEqual([
    ["avatar_url", "avatar_url must use http or https protocol"],
  ]);
});

it("UserChangePasswordRequest：二选一模型级校验（loc=body 语义）", () => {
  expect(
    UserChangePasswordRequestSchema.safeParse({ current_password: "validpass", new_password: "newpass1" }).success,
    true,
  );
  expect(
    UserChangePasswordRequestSchema.safeParse({ google_id_token: "tok", new_password: "newpass1" }).success,
    true,
  );
  expect(
    issues(UserChangePasswordRequestSchema.safeParse({ current_password: null, google_id_token: null, new_password: "abcdef1" })),
    [["body", "Provide exactly one of current_password or google_id_token"]],
  );
  expect(
    issues(UserChangePasswordRequestSchema.safeParse({ current_password: "validpass", google_id_token: "tok", new_password: "abcdef1" })),
    [["body", "Provide exactly one of current_password or google_id_token"]],
  );
  // When a field constraint fails, the model-level refine does not run (same as pydantic)
  expect(
    issues(UserChangePasswordRequestSchema.safeParse({ current_password: "abc", new_password: "abcdef1" })).map((i) => i[0]),
    ["current_password"],
  );
});

it("UserRegisterRequest：密码最短 6 位", () => {
  expect(
    UserRegisterRequestSchema.safeParse({ user_name: "a", account_name: "a@b.co", account_password: "abcdef1", captcha_code: "123456" }).success,
    true,
  );
  expect(
    issues(UserRegisterRequestSchema.safeParse({ user_name: "a", account_name: "a@b.co", account_password: "abc", captcha_code: "123456" })),
    [["account_password", "Too small: expected string to have >=6 characters"]],
  );
});

it("UserListRequest：分页边界 + 状态枚举", () => {
  expect(UserListRequestSchema.safeParse({ page_number: 0 }).success).toBe(false);
  expect(UserListRequestSchema.safeParse({ page_size: 10000 }).success).toBe(false);
  expect(UserListRequestSchema.safeParse({ user_status: "active" }).success).toBe(true);
  expect(UserListRequestSchema.safeParse({ user_status: "bogus" }).success).toBe(false);
  // Default pagination
  const parsed = UserListRequestSchema.parse({});
  expect(parsed.page_number).toBe(1);
  expect(parsed.page_size).toBe(20);
});

it("UserFileRegisterRequest：file_size 正整数上界", () => {
  expect(
    UserFileRegisterRequestSchema.safeParse({ file_name: "a.bin", file_type: "other", object_key: "files/x", file_size: 100 }).success,
    true,
  );
  expect(
    UserFileRegisterRequestSchema.safeParse({ file_name: "a.bin", file_type: "other", object_key: "files/x", file_size: 0 }).success,
    false,
  );
  expect(
    UserFileRegisterRequestSchema.safeParse({ file_name: "a.bin", file_type: "other", object_key: "files/x", file_size: 1024 ** 4 + 1 }).success,
    false,
  );
  expect(
    UserFileRegisterRequestSchema.safeParse({ file_name: "a.bin", file_type: "bogus", object_key: "files/x", file_size: 1 }).success,
    false,
  );
});

it("UserFileListRequest：继承分页基类", () => {
  const parsed = UserFileListRequestSchema.parse({ file_name: "x", source: "user_upload" });
  expect(parsed.page_number).toBe(1);
  expect(parsed.file_name).toBe("x");
  expect(parsed.source).toBe("user_upload");
});

it("ActivationActivateRequest：密码强度（字母+数字，8+ 位）", () => {
  expect(
    ActivationActivateRequestSchema.safeParse({ token: "t".repeat(16), account_password: "abcd1234" }).success,
    true,
  );
  expect(
    issues(ActivationActivateRequestSchema.safeParse({ token: "t".repeat(16), account_password: "abcdefgh" })),
    [["account_password", "Password must be at least 8 characters and include both letters and numbers"]],
  );
  expect(
    issues(ActivationActivateRequestSchema.safeParse({ token: "short", account_password: "abcd1234" })),
    [["token", "Too small: expected string to have >=16 characters"]],
  );
});

});
