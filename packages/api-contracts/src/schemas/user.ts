// SPDX-License-Identifier: AGPL-3.0-only
/**
 * User/session domain schemas.
 *
 * These schemas serve two purposes:
 * 1. API DTOs (request/response validation)
 * 2. Redis session encoding (auth/session-codec.ts) — the format is the production session JSON
 *    (production format, so sessions issued by either side are readable; fixtures: tests/parity/fixtures/sessions/)
 *
 * Conventions:
 * - datetime/UUID stay strings in the session object (as on the wire), not converted to Date
 * - Optional fields decode leniently (old sessions may lack keys); `.passthrough()` tolerates future fields
 * - optional fields with defaults → `.optional().nullable()` (with a default);
 *   `Optional[X]` (required but nullable) → `.nullable()`
 */

import { z } from "zod";
import { AccountType, UserGender, UserStatus, UserType } from "../enums/user.ts";
import { AdminStatus } from "../enums/admin.ts";
import { ManagerStatus } from "../enums/manager.ts";
import { SuperAdminStatus } from "../enums/super_admin.ts";
import { TeacherStatus } from "../enums/teacher.ts";
import { StudentStatus } from "../enums/student.ts";
import { OrganizationStatus, OrganizationType } from "../enums/organization.ts";
import { pyBool, pyUuid } from "./helpers.ts";

/** ISO datetime string (both the Z and +00:00 spellings are readable) */
export const isoDatetime = z.string().datetime({ offset: true });
/** UUID string (lax semantics: any 8-4-4-4-12 hexadecimal) */
export const uuid = pyUuid;

// ---------------------------------------------------------------------------
// BaseInfo / BaseUserInfo
// ---------------------------------------------------------------------------

export const BaseInfoSchema = z
  .object({
    created_by: uuid.nullable().optional(),
    updated_by: uuid.nullable().optional(),
    updated_at: isoDatetime,
    created_at: isoDatetime,
  })
  .passthrough();

export const BaseUserInfoSchema = BaseInfoSchema.extend({
  user_id: uuid.nullable().optional(),
  account_type: z.nativeEnum(AccountType).nullable().optional(),
  user_status: z.nativeEnum(UserStatus).nullable().optional(),
  remark: z.string().nullable().default(""),
  last_login_at: isoDatetime.nullable().optional(),
});

// ---------------------------------------------------------------------------
// Enterprise provisioning result (EnterpriseMemberProvisionResult)
// ---------------------------------------------------------------------------

export const EnterpriseMemberProvisionResultSchema = z
  .object({
    user_id: uuid,
    role_row_id: uuid,
    workspace_org_id: uuid,
    activation_email_sent: z.boolean(),
    activation_expires_at: isoDatetime,
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Role info
// ---------------------------------------------------------------------------

export const AdminInfoSchema = BaseUserInfoSchema.extend({
  admin_id: uuid,
  admin_name: z.string(),
  admin_name_kana: z.string().nullable().optional(),
  admin_status: z.nativeEnum(AdminStatus),
  admin_introduction: z.string().nullable().default(""),
  admin_avatar_url: z.string().nullable().optional(),
  org_id: uuid,
  enterprise: EnterpriseMemberProvisionResultSchema.nullable().optional(),
});

export const ManagerInfoSchema = BaseUserInfoSchema.extend({
  manager_id: uuid,
  manager_name: z.string(),
  manager_name_kana: z.string().nullable().optional(),
  manager_status: z.nativeEnum(ManagerStatus),
  manager_introduction: z.string().nullable().default(""),
  manager_avatar_url: z.string().nullable().optional(),
  org_id: uuid,
});

export const SuperAdminInfoSchema = BaseUserInfoSchema.extend({
  super_admin_id: uuid,
  super_admin_name: z.string(),
  super_admin_name_kana: z.string().nullable().optional(),
  super_admin_status: z.nativeEnum(SuperAdminStatus),
  super_admin_introduction: z.string().nullable().default(""),
  super_admin_avatar_url: z.string().nullable().optional(),
  org_id: uuid,
});

export const TeacherInfoSchema = BaseUserInfoSchema.extend({
  teacher_id: uuid,
  teacher_no: z.string().nullable().optional(),
  teacher_name: z.string(),
  teacher_name_kana: z.string().nullable().optional(),
  teacher_status: z.nativeEnum(TeacherStatus),
  teacher_introduction: z.string().nullable().default(""),
  teacher_titles: z.array(z.string()).nullable().default([]),
  teacher_avatar_url: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  org_id: uuid,
  enterprise: EnterpriseMemberProvisionResultSchema.nullable().optional(),
});

export const StudentCourseSimpleSchema = z.object({
  course_id: uuid,
  course_name: z.string(),
});

export const StudentInfoSchema = BaseUserInfoSchema.extend({
  student_id: uuid,
  student_no: z.string().nullable().optional(),
  student_name: z.string(),
  student_status: z.nativeEnum(StudentStatus),
  student_title: z.array(z.string()).nullable().optional(),
  student_introduction: z.string().nullable().default(""),
  student_avatar_url: z.string().nullable().optional(),
  org_id: uuid,
  is_external: z.boolean().default(false),
  enterprise: EnterpriseMemberProvisionResultSchema.nullable().optional(),
  is_enrolled: z.boolean().nullable().optional(),
  enrolled_courses: z.array(StudentCourseSimpleSchema).nullable().optional(),
});

// ---------------------------------------------------------------------------
// OrganizationInfo (the subset embedded in the session)
// ---------------------------------------------------------------------------

export const OrganizationInfoSchema = BaseInfoSchema.extend({
  org_id: uuid,
  org_type: z.nativeEnum(OrganizationType).nullable().optional(),
  org_no: z.string().nullable().optional(),
  org_name: z.string(),
  org_name_kana: z.string().nullable().optional(),
  org_status: z.nativeEnum(OrganizationStatus),
  org_introduction: z.string().nullable().optional(),
  org_avatar_url: z.string().nullable().optional(),
  super_admin_user_id: uuid,
  remark: z.string().nullable().optional(),
  sort: z.number().int().nullable().optional(),
  default_language: z.string().nullable().optional(),
  parent_org_id: uuid.nullable().optional(),
  org_path: z.string(),
  org_level: z.number().int(),
  is_root: z.boolean(),
});

// ---------------------------------------------------------------------------
// UserInfo / UserRoles / UserSession
// ---------------------------------------------------------------------------

export const UserInfoSchema = BaseUserInfoSchema.extend({
  user_name: z.string(),
  user_status: z.nativeEnum(UserStatus),
  user_gender: z.nativeEnum(UserGender).nullable().optional(),
  user_title: z.array(z.string()).nullable().optional(),
  user_avatar_url: z.string().nullable().optional(),
  account_name: z.string(),
  google_id: z.string().nullable().optional(),
  wechat_id: z.string().nullable().optional(),
  phone_number: z.string().nullable().optional(),
  email: z.email().nullable().optional(),
  registration_source: z.string().nullable().optional(),
  user_type: z.nativeEnum(UserType).default("normal"),
  account_type: z.nativeEnum(AccountType).default("normal"),
  allow_platform_courses: z.boolean().default(false),
  allow_join_other_orgs: z.boolean().default(false),
});

/** Current user info (PII-trimmed) */
export const UserMeInfoSchema = BaseUserInfoSchema.extend({
  user_name: z.string(),
  user_status: z.nativeEnum(UserStatus),
  user_title: z.array(z.string()).nullable().optional(),
  user_avatar_url: z.string().nullable().optional(),
});

export const UserRolesSchema = z
  .object({
    super_admin: SuperAdminInfoSchema.nullable().optional(),
    admin: AdminInfoSchema.nullable().optional(),
    manager: ManagerInfoSchema.nullable().optional(),
    teacher: TeacherInfoSchema.nullable().optional(),
    student: StudentInfoSchema.nullable().optional(),
  })
  .passthrough();

/**
 * User session — the storage format of Redis `user_session:{token}` (the production session format).
 *
 * permission_user_id backfill check:
 * - missing for an ordinary user → backfilled with user_id (old session semantics)
 * - missing for an agent session → decoding fails (no silent downgrade; it must re-issue through /v1/agent/token)
 */
export const UserSessionSchema = z
  .object({
    roles: z.array(z.string()),
    user: UserInfoSchema,
    organization: OrganizationInfoSchema.nullable().optional(),
    super_admin: SuperAdminInfoSchema.nullable().optional(),
    admin: AdminInfoSchema.nullable().optional(),
    manager: ManagerInfoSchema.nullable().optional(),
    student: StudentInfoSchema.nullable().optional(),
    teacher: TeacherInfoSchema.nullable().optional(),
    user_id: uuid,
    permission_user_id: uuid.nullable().optional(),
    current_org_id: uuid.nullable().optional(),
    permissions: z.array(z.string()),
    owner_roles: z.array(z.string()).nullable().optional(),
    owner_role_details: UserRolesSchema.nullable().optional(),
    access_token: z.string(),
    expire_at: isoDatetime,
  })
  .passthrough()
  .transform((session) => {
    if (session.permission_user_id === null || session.permission_user_id === undefined) {
      if (session.user.user_type === "agent") {
        throw new SessionDecodeError(
          "agent session is missing permission_user_id; re-issue via POST /v1/agent/token",
        );
      }
      return { ...session, permission_user_id: session.user_id };
    }
    return session;
  });

/** Session decoding failed (production treats it as no session) */
export class SessionDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionDecodeError";
  }
}

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const UserLoginRequestSchema = z.object({
  /** DEPRECATED: legacy field describing the login method (account/email/phone/wechat). The service no longer consumes it;
   *  it stays a free string only for compatibility with existing frontend payloads. */
  account_type: z.string().nullable().optional(),
  /** Account name (bounded: failed logins are counted per identifier) */
  account_name: z.string().max(320),
  /** Account password */
  account_password: z.string().min(6),
  /** Remember me: true gives a 1-month session, otherwise the default lifetime (lax bool: null/"true"/1 all accepted) */
  remember_me: pyBool().optional().default(false),
});

export const UserCheckAccountExistsRequestSchema = z.object({
  account_name: z.string(),
});

/** Google FedCM login (credential = Google JWT ID token) */
export const UserGoogleLoginRequestSchema = z.object({
  credential: z.string(),
  /** Channel attribution code for a new sign-up (e.g. ads_google, partner_x); the query parameter takes priority */
  channel_code: z.string().max(64).nullable().optional(),
});

/**
 * Self-service profile update (POST /user/update_info).
 * field_validator on user_avatar_url: must be an http/https URL
 * (production strips the "Value error, " prefix and outputs the bare text; the zod side uses the bare text directly to match).
 */
export const UserUpdateRequestSchema = z.object({
  user_id: uuid.nullable().optional(),
  user_name: z.string().nullable().optional(),
  user_title: z.array(z.string()).nullable().optional(),
  user_avatar_url: httpUrlRefine("user_avatar_url"),
  remark: z.string().nullable().optional(),
});

/** Self-service profile update of a staff role (org scope): None = unchanged; empty introduction = cleared */
export const StaffProfileUpdateRequestSchema = z.object({
  name: z
    .string()
    .max(60)
    .refine((v) => v.trim().length > 0, { message: "name must not be blank" })
    .transform((v) => v.trim())
    .nullable()
    .optional(),
  avatar_url: httpUrlRefine("avatar_url"),
  introduction: z.string().max(1000).nullable().optional(),
});

/** Self-service update of the student card (org scope): same shape as the staff version */
export const StudentProfileUpdateRequestSchema = z.object({
  name: z
    .string()
    .max(60)
    .refine((v) => v.trim().length > 0, { message: "name must not be blank" })
    .transform((v) => v.trim())
    .nullable()
    .optional(),
  avatar_url: httpUrlRefine("avatar_url"),
  introduction: z.string().max(1000).nullable().optional(),
});

/** Email verification code sign-up */
export const UserRegisterRequestSchema = z.object({
  user_name: z.string(),
  account_name: z.string(),
  account_password: z.string().min(6),
  captcha_code: z.string(),
  /** Channel attribution code (the query parameter takes priority) */
  channel_code: z.string().max(64).nullable().optional(),
});

/** Send the sign-up verification code email */
export const UserRegisterSendCaptchaEmailRequestSchema = z.object({
  email: z.email(),
  /** Browser language string from the frontend (e.g. en-US, ja-JP, en-US,en;q=0.9) */
  language: z.string().nullable().optional(),
});

/** Reset the password with an email verification code */
export const UserResetPasswordRequestSchema = z.object({
  account_name: z.string(),
  account_password: z.string().min(6),
  captcha_code: z.string(),
});

/** Send the password reset verification code email */
export const UserResetPasswordSendCaptchaEmailRequestSchema = z.object({
  email: z.email(),
  language: z.string().nullable().optional(),
});

/**
 * Change password: exactly one of current_password / google_id_token (model-level validation;
 * issue path is ["body"] — production renders a model-level error loc=() as
 * ("body",), verified message = "body: Provide exactly one of ...").
 */
export const UserChangePasswordRequestSchema = z
  .object({
    current_password: z.string().min(6).nullable().optional(),
    google_id_token: z.string().min(1).nullable().optional(),
    new_password: z.string().min(6),
  })
  .superRefine((value, ctx) => {
    const hasPassword = Boolean(value.current_password);
    const hasGoogleToken = Boolean(value.google_id_token);
    if (hasPassword === hasGoogleToken) {
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        message: "Provide exactly one of current_password or google_id_token",
      });
    }
  });

/** Choose the current organization */
export const OrganizationChooseRequestSchema = z.object({
  org_id: uuid,
});

/**
 * User create payload (UserInfoCreate).
 * Embedded in org-side role creation (the user block of student/manager/admin create) —
 * the service layer's create_user persists it as-is (unlike the sign-up flow with a verification code / personal workspace).
 */
export const UserInfoCreateSchema = z.object({
  user_name: z.string(),
  account_name: z.string(),
  account_password: z.string(),
  user_status: z.nativeEnum(UserStatus).nullable().optional(),
  user_title: z.array(z.string()).nullable().optional(),
  phone_number: z.string().nullable().optional(),
  email: z.email().nullable().optional(),
  registration_source: z.string().nullable().optional(),
});

export type UserInfoCreate = z.infer<typeof UserInfoCreateSchema>;

/** Pagination query base (int coercion + bounds checks; the query passes strings) */
export const PaginationRequestSchema = z.object({
  page_number: z.coerce.number().int().min(1).max(1000000).default(1),
  page_size: z.coerce.number().int().min(1).max(9999).default(20),
  order_by: z.string().optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

/** User list query (for org-scoped search) */
export const UserListRequestSchema = PaginationRequestSchema.extend({
  user_status: z.nativeEnum(UserStatus).nullable().optional(),
  user_statuses: z.string().nullable().optional(),
  user_name: z.string().nullable().optional(),
  account_name: z.string().nullable().optional(),
  search_keyword: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
});

/**
 * URL validation (urlparse semantics; the first failure is reported):
 * - no scheme+netloc can be parsed → "must be a valid URL"
 * - scheme not http/https → "must use http or https protocol"
 * Returns null when valid; the text prefix (the field name) is added by the caller.
 */
function httpUrlViolation(value: string, field: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return `${field} must be a valid URL`;
  }
  if (!parsed.protocol || !parsed.host) {
    return `${field} must be a valid URL`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `${field} must use http or https protocol`;
  }
  return null;
}

/** zod refine wrapper for URL validation (null/undefined pass; the error is the first violation) */
export function httpUrlRefine(field: string) {
  return z
    .string()
    .nullable()
    .optional()
    .superRefine((v, ctx) => {
      if (v === null || v === undefined) {
        return;
      }
      const violation = httpUrlViolation(v, field);
      if (violation !== null) {
        ctx.addIssue({ code: "custom", message: violation });
      }
    });
}

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

/** User projection for org-scoped search (for invite/bind flows, with the stable account identifier) */
export interface UserSearchResult {
  user_id: string;
  user_name: string;
  account_name: string;
  user_avatar_url: string | null;
  user_email: string | null;
}

/** Result of a staff role's self-service profile update (echoes the highest-priority Active/Pending role row) */
export interface StaffProfileResponse {
  user_id: string;
  org_id: string;
  name: string;
  avatar_url: string | null;
  introduction: string | null;
  updated_roles: string[];
}

/** Result of the student card's self-service update (echoes the organization's student row) */
export interface StudentProfileResponse {
  user_id: string;
  org_id: string;
  student_id: string;
  name: string;
  avatar_url: string | null;
  introduction: string | null;
}

export type UserUpdateRequest = z.infer<typeof UserUpdateRequestSchema>;
export type UserInfoCreateRequest = UserInfoCreate;
export type UserGoogleLoginRequest = z.infer<typeof UserGoogleLoginRequestSchema>;
export type StaffProfileUpdateRequest = z.infer<typeof StaffProfileUpdateRequestSchema>;
export type StudentProfileUpdateRequest = z.infer<typeof StudentProfileUpdateRequestSchema>;
export type UserRegisterRequest = z.infer<typeof UserRegisterRequestSchema>;
export type UserRegisterSendCaptchaEmailRequest = z.infer<typeof UserRegisterSendCaptchaEmailRequestSchema>;
export type UserResetPasswordRequest = z.infer<typeof UserResetPasswordRequestSchema>;
export type UserResetPasswordSendCaptchaEmailRequest = z.infer<typeof UserResetPasswordSendCaptchaEmailRequestSchema>;
export type UserChangePasswordRequest = z.infer<typeof UserChangePasswordRequestSchema>;
export type UserListRequest = z.infer<typeof UserListRequestSchema>;

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

/** Pagination info (response) */
export interface PaginationInfo {
  page_number: number;
  page_size: number;
  total_count: number;
  total_pages: number;
  has_next_page: boolean;
  has_previous_page: boolean;
}

/** Paginated response envelope */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationInfo;
}

/** Compute pagination info from a total (the formula every list service uses) */
export function buildPaginationInfo(
  pageNumber: number,
  pageSize: number,
  totalCount: number,
): PaginationInfo {
  const totalPages = Math.ceil(totalCount / pageSize);
  return {
    page_number: pageNumber,
    page_size: pageSize,
    total_count: totalCount,
    total_pages: totalPages,
    has_next_page: pageNumber < totalPages,
    has_previous_page: pageNumber > 1,
  };
}

export type BaseInfo = z.infer<typeof BaseInfoSchema>;
export type BaseUserInfo = z.infer<typeof BaseUserInfoSchema>;
export type UserInfo = z.infer<typeof UserInfoSchema>;
export type UserMeInfo = z.infer<typeof UserMeInfoSchema>;
export type AdminInfo = z.infer<typeof AdminInfoSchema>;
export type ManagerInfo = z.infer<typeof ManagerInfoSchema>;
export type SuperAdminInfo = z.infer<typeof SuperAdminInfoSchema>;
export type TeacherInfo = z.infer<typeof TeacherInfoSchema>;
export type StudentInfo = z.infer<typeof StudentInfoSchema>;
export type OrganizationInfo = z.infer<typeof OrganizationInfoSchema>;
export type UserRoles = z.infer<typeof UserRolesSchema>;
export type UserSession = z.infer<typeof UserSessionSchema>;
