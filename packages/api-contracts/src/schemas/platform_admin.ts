// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Platform admin domain schemas.
 *
 * Platform admins are cross-organization operators (a parallel stack independent of org admins), with sessions in a separate Redis
 * namespace (services/platform_admin_auth.ts).
 */

import { z } from "zod";
import { OrganizationStatus } from "../enums/organization.ts";
import type { OrganizationInfo } from "./user.ts";
import { PaginationRequestSchema } from "./user.ts";
import { UserFileListRequestSchema } from "./user_file.ts";
import { pyBool, pyBoolRequired, pyEnum, pyUuid } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export const PlatformAdminLoginRequestSchema = z.object({
  /** Login identifier: account_name or email (resolved by an OR query in the service layer, not an @ heuristic) */
  identifier: z.string().min(1).max(320),
  /** Account password (same regex as the admin login form) */
  account_password: z.string().regex(
    /^[^\s]{6,64}$/,
    "String should match pattern '^[^\\s]{6,64}$'",
  ),
  /** Remember me (extends the session lifetime to 1 month) */
  remember_me: pyBool().optional().default(false),
});

export type PlatformAdminLoginRequest = z.infer<typeof PlatformAdminLoginRequestSchema>;

// ---------------------------------------------------------------------------
// Organization management requests
// ---------------------------------------------------------------------------

/**
 * Audit reason field: non-empty, not all whitespace after strip.
 * Validation order: min/max length constraints first (on the raw value), then the after-validator strip;
 * all-whitespace is reported by the validator as "Value error, reason must not be blank".
 */
const reasonField = z
  .string()
  .min(1)
  .max(500)
  .transform((value) => value.trim())
  .superRefine((value, ctx) => {
    if (value.length === 0) {
      ctx.addIssue({ code: "custom", message: "reason must not be blank" });
    }
  });

/** Group ↔ Enterprise type conversion (audit reason) */
export const ConvertOrgTypeRequestSchema = z.object({ reason: reasonField });

/** Soft-delete an organization (audit reason) */
export const RemoveOrgRequestSchema = z.object({ reason: reasonField });

/** Restore a soft-deleted organization (audit reason) */
export const RestoreOrgRequestSchema = z.object({ reason: reasonField });

/** Hand over the organization super admin (audit reason + target user) */
export const PlatformAdminReplaceOrgSuperAdminRequestSchema = z.object({
  reason: reasonField,
  user_id: pyUuid,
});

/**
 * date query parameter validation (text matches production verbatim):
 * - too short → "input is too short"; non-digit year/month/day part → "invalid character in year/month/day"
 * - month out of range → "month value is outside expected range of 1-12"; day out of range → "day value is outside expected range"
 */
export function pyDateQuery(): z.ZodType<string> {
  return z.string().superRefine((value, ctx) => {
    const fail = (message: string): void => {
      ctx.addIssue({
        code: "custom",
        message: `Input should be a valid date or datetime, ${message}`,
      });
    };
    if (value.length < 10) {
      fail("input is too short");
      return;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match === null) {
      const segments = value.split("-");
      const yearNonDigit = /\D/.test(segments[0] ?? "");
      const monthNonDigit = /\D/.test(segments[1] ?? "");
      const dayNonDigit = /\D/.test(segments[2] ?? "");
      if (yearNonDigit) {
        fail("invalid character in year");
      } else if (monthNonDigit) {
        fail("invalid character in month");
      } else if (dayNonDigit) {
        fail("invalid character in day");
      } else {
        fail("input is too short");
      }
      return;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12) {
      fail("month value is outside expected range of 1-12");
      return;
    }
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day < 1 || day > daysInMonth[month - 1]) {
      fail("day value is outside expected range");
    }
  }) as unknown as z.ZodType<string>;
}

/**
 * Lax datetime parsing: naive values are treated as UTC, date-only gets midnight (the service layer
 * validator's replace(tzinfo=utc) semantics moved forward); outputs a standard ISO string.
 */
const pyDateTimeString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T00:00:00Z`;
  }
  const spaced = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/.exec(value);
  if (spaced !== null && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(value)) {
    return `${spaced[1]}T${spaced[2]}Z`;
  }
  return value;
}, z.string().datetime({ offset: true }));

/** Shared enterprise subscription fields (seat triple / storage / monthly credits / contract end) */
const enterpriseSubscriptionFields = {
  /** ge=1 is load-bearing: a row value of 0 falls back to the FREE tier when the subscription config is read */
  admin_seats: z.coerce.number().int().min(1).max(100_000),
  teacher_seats: z.coerce.number().int().min(1).max(100_000),
  student_seats: z.coerce.number().int().min(0).max(1_000_000),
  monthly_credits: z.coerce.number().int().min(0).max(1_000_000_000),
  /** le = 2^53: a JS safe integer (the admin UI is the only writer) */
  storage_limit_bytes: z.coerce.number().int().min(0).max(9_007_199_254_740_992),
  /** Contract end (UTC; must be in the future). Field validator: naive gets UTC, non-UTC offsets normalized */
  expired_at: pyDateTimeString.superRefine((value, ctx) => {
    if (new Date(value).getTime() <= Date.now()) {
      ctx.addIssue({ code: "custom", message: "expired_at must be in the future" });
    }
  }),
};

/** Grant an enterprise subscription (optional started_at backfills the contract start — the anchor of the monthly credits refresh chain) */
export const EnterpriseSubscriptionGrantRequestSchema = z
  .object({
    ...enterpriseSubscriptionFields,
    reason: reasonField,
    /** Contract start: at most 24 hours in the future (same-day tolerance for operators ahead of UTC) */
    started_at: pyDateTimeString
      .superRefine((value, ctx) => {
        if (new Date(value).getTime() > Date.now() + 24 * 3600_000) {
          ctx.addIssue({
            code: "custom",
            message: "started_at must not be more than 24 hours in the future",
          });
        }
      })
      .nullable()
      .optional(),
  })
  .superRefine((request, ctx) => {
    // Validation semantics: model-level after validation runs only when every field validation passes —
    // no cross error is added when expired_at or started_at fails
    if (request.started_at === null || request.started_at === undefined) {
      return;
    }
    const expiredOk = new Date(request.expired_at).getTime() > Date.now();
    const startedOk =
      new Date(request.started_at).getTime() <= Date.now() + 24 * 3600_000;
    if (!expiredOk || !startedOk) {
      return;
    }
    // The 24h tolerance means started_at < expired_at is no longer implied — check it explicitly
    if (new Date(request.started_at).getTime() >= new Date(request.expired_at).getTime()) {
      ctx.addIssue({
        code: "custom",
        path: ["started_at"],
        message: "started_at must be before expired_at",
      });
    }
  });

/** Update an enterprise subscription (full state; see the service layer for deferred-effect semantics) */
export const EnterpriseSubscriptionUpdateRequestSchema = z
  .object({
    ...enterpriseSubscriptionFields,
    reason: reasonField,
    /** Explicitly undo a scheduled cancellation (requires expired_at later than scheduled_cancel_at) */
    resume_scheduled_cancel: pyBoolRequired().default(false),
    /** Cancel every pending downgrade (keeps the current terms / contract end / scheduled cancellation) */
    cancel_scheduled_downgrade: pyBoolRequired().default(false),
  })
  .superRefine((request, ctx) => {
    if (request.resume_scheduled_cancel && request.cancel_scheduled_downgrade) {
      // Model-level error loc=() → the field name renders as "body"
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        message: "resume_scheduled_cancel and cancel_scheduled_downgrade cannot both be true",
      });
    }
  });

/** Cancel an enterprise subscription (audit reason only) */
export const EnterpriseSubscriptionCancelRequestSchema = z.object({ reason: reasonField });

/** Platform admin user file list: lists every source file a user registered, globally (target user_id required) */
export const PlatformAdminUserFileListRequestSchema = UserFileListRequestSchema.extend({
  user_id: pyUuid,
});

export type PlatformAdminUserFileListRequest = z.infer<
  typeof PlatformAdminUserFileListRequestSchema
>;

/** Platform admin organization list (all organizations + org_types / is_root filters) */
export const PlatformAdminOrganizationListRequestSchema = PaginationRequestSchema.extend({
  org_status: z.nativeEnum(OrganizationStatus).nullable().optional(),
  /** Comma-separated statuses (invalid values silently dropped) */
  org_statuses: z.string().nullable().optional(),
  /** Comma-separated types */
  org_types: z.string().nullable().optional(),
  org_name: z.string().nullable().optional(),
  org_no: z.string().nullable().optional(),
  is_root: pyBool().nullable().optional(),
});

export type ConvertOrgTypeRequest = z.infer<typeof ConvertOrgTypeRequestSchema>;
export type RemoveOrgRequest = z.infer<typeof RemoveOrgRequestSchema>;
export type RestoreOrgRequest = z.infer<typeof RestoreOrgRequestSchema>;
export type PlatformAdminReplaceOrgSuperAdminRequest = z.infer<
  typeof PlatformAdminReplaceOrgSuperAdminRequestSchema
>;
export type EnterpriseSubscriptionGrantRequest = z.infer<
  typeof EnterpriseSubscriptionGrantRequestSchema
>;
export type EnterpriseSubscriptionUpdateRequest = z.infer<
  typeof EnterpriseSubscriptionUpdateRequestSchema
>;
export type EnterpriseSubscriptionCancelRequest = z.infer<
  typeof EnterpriseSubscriptionCancelRequestSchema
>;
export type PlatformAdminOrganizationListRequest = z.infer<
  typeof PlatformAdminOrganizationListRequestSchema
>;

// ---------------------------------------------------------------------------
// TTS pronunciation dictionary requests
// ---------------------------------------------------------------------------

/** Full-width digit folding (０-９ → 0-9): dictionary keys and the courseware TTS matcher share the same folding */
export function foldFullwidthDigits(text: string): string {
  return text.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 0x30),
  );
}

/** Japanese only: the dictionary feeds Japanese kana rewriting (its only consumer). Adding languages needs the courseware reader in sync. */
export type TtsPronunciationLanguage = "ja";
const ttsLanguageField = pyEnum(["ja"]);

/** before-validator: source_text strip + full-width folding (aligned with the matcher keys) */
const ttsSourceText = z.preprocess(
  (value) => (typeof value === "string" ? foldFullwidthDigits(value.trim()) : value),
  z.string().min(1).max(256),
);

/** before-validator: pronunciation strip (the reading goes to TTS as-is) */
const ttsPronunciationText = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z.string().min(1).max(512),
);

/** before-validator: remark strip; all whitespace → None */
const ttsOptionalRemark = z.preprocess((value) => {
  if (typeof value === "string") {
    const stripped = value.trim();
    return stripped.length > 0 ? stripped : null;
  }
  return value;
}, z.string().max(500).nullable());

/** Platform admin pronunciation dictionary list (q fuzzy / language / enabled filters) */
export const TtsPronunciationAdminListRequestSchema = PaginationRequestSchema.extend({
  /** source_text / pronunciation fuzzy match (ILIKE; wildcards escaped) */
  q: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string().max(100).nullable().optional(),
  ),
  language: ttsLanguageField.nullable().optional(),
  enabled: pyBool().nullable().optional(),
});

/** Create a pronunciation entry */
export const TtsPronunciationCreateRequestSchema = z.object({
  source_text: ttsSourceText,
  language: ttsLanguageField,
  pronunciation: ttsPronunciationText,
  enabled: pyBoolRequired().default(true),
  remark: ttsOptionalRemark.nullable().optional(),
});

/** Partial update (omitted fields unchanged; an explicit empty string clears remark) */
export const TtsPronunciationUpdateRequestSchema = z.object({
  source_text: ttsSourceText.nullable().optional(),
  language: ttsLanguageField.nullable().optional(),
  pronunciation: ttsPronunciationText.nullable().optional(),
  enabled: pyBool().nullable().optional(),
  remark: ttsOptionalRemark.nullable().optional(),
});

export type TtsPronunciationAdminListRequest = z.infer<
  typeof TtsPronunciationAdminListRequestSchema
>;
export type TtsPronunciationCreateRequest = z.infer<typeof TtsPronunciationCreateRequestSchema>;
export type TtsPronunciationUpdateRequest = z.infer<typeof TtsPronunciationUpdateRequestSchema>;

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

/** Daily trend row (new human users) */
export interface PlatformAdminNewUserTrendItem {
  date: string;
  new_user_count: number;
}

/** Daily trend row (new agent accounts) */
export interface PlatformAdminNewAgentTrendItem {
  date: string;
  new_agent_count: number;
}

/** Daily total row (cumulative human users) */
export interface PlatformAdminTotalUserTrendItem {
  date: string;
  total_user_count: number;
}

/** Dashboard home aggregate (7-day window in the browser's timezone) */
export interface PlatformAdminDashboardStats {
  total_user_count: number;
  today_new_user_count: number;
  today_new_agent_count: number;
  total_user_trend: PlatformAdminTotalUserTrendItem[];
  new_user_trend: PlatformAdminNewUserTrendItem[];
  new_agent_trend: PlatformAdminNewAgentTrendItem[];
}

/** New user trend chart (the requested date window in the browser's timezone) */
export interface PlatformAdminNewUserTrend {
  new_user_trend: PlatformAdminNewUserTrendItem[];
}

/** Organization list item (with the count of non-deleted direct children) */
export interface PlatformAdminOrganizationItem extends OrganizationInfo {
  direct_non_deleted_children_count: number;
}

/**
 * Enterprise subscription status (platform admin view). Decimal fields are strings with their scale kept
 * (production JSON serializes Decimal → str; verified "1000.000000000000000"/"0E-15").
 */
export interface PlatformAdminEnterpriseSubscriptionInfo {
  asset_id: string;
  state: "active" | "expired" | "cancelled";
  admin_seats: number;
  teacher_seats: number;
  student_seats: number;
  total_seats: number;
  storage_limit_bytes: number | null;
  monthly_credits: string;
  current_amount: string;
  current_used: string;
  current_balance: string;
  org_credits_balance: string;
  next_refresh_at: string | null;
  expired_at: string | null;
  canceled_at: string | null;
  cancel_scheduled: boolean;
  scheduled_cancel_at: string | null;
  scheduled_seats: number | null;
  scheduled_admin_seat_limit: number | null;
  scheduled_teacher_seat_limit: number | null;
  scheduled_storage_limit_bytes: number | null;
  scheduled_effective_at: string | null;
  pending_credits_amount: string | null;
  created_at: string;
  updated_at: string;
  creator_id: string | null;
  updater_id: string | null;
}

/** Pronunciation entry (platform admin surface; BaseInfo fields first) */
export interface TtsPronunciationInfo {
  created_by: string | null;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
  id: string;
  source_text: string;
  language: string;
  pronunciation: string;
  enabled: boolean;
  remark: string | null;
}
