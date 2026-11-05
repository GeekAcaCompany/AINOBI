// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Asset domain enums.
 */

/**
 * Asset type (PG enum type: assettype)
 *
 * The PG assettype enum still keeps two historical labels with no member here:
 * 'token' (first-generation personal billing; its rows were purged by migration 20260713_purge_token_assets,
 * which had to deploy before the code removing the member); 'subscription' (never mapped to a member).
 * A PG enum label cannot be dropped without rebuilding the type.
 */
export const AssetType = {
  Balance: "balance",
  Credit: "credit",
  Points: "points",
  Voucher: "voucher",
} as const;
export type AssetType = (typeof AssetType)[keyof typeof AssetType];

/** Asset status (PG enum type: assetstatus) */
export const AssetStatus = {
  Normal: "normal",
  Frozen: "frozen",
  Expired: "expired",
  Cancelled: "cancelled",
  /** Subscription awaiting payment */
  Pending: "pending",
} as const;
export type AssetStatus = (typeof AssetStatus)[keyof typeof AssetStatus];

/** Asset change type (PG enum type: assetchangetype) */
export const AssetChangeType = {
  /** Recharge */
  Recharge: "recharge",
  /** Consume */
  Consume: "consume",
  /** Gift */
  Gift: "gift",
  /** Adjust */
  Adjust: "adjust",
  /** Expire */
  Expire: "expire",
  /** Freeze */
  Freeze: "freeze",
  /** Unfreeze */
  Unfreeze: "unfreeze",
} as const;
export type AssetChangeType = (typeof AssetChangeType)[keyof typeof AssetChangeType];

/** Asset plan cycle (PG enum type: assetplancycle) */
export const AssetPlanCycle = {
  NoCycle: "none",
  Daily: "daily",
  Weekly: "weekly",
  Monthly: "monthly",
  Yearly: "yearly",
} as const;
export type AssetPlanCycle = (typeof AssetPlanCycle)[keyof typeof AssetPlanCycle];

/**
 * Well-known `asset_code` values: which business pool / wallet an asset row belongs to.
 * A different axis from AssetType (balance/credit/…, the `asset_type` column).
 *
 * Members are str, so they compare/hash equal to the plain strings in the DB column;
 * stored as a plain string column, not a PG enum. Subscription PLAN codes (personal_subscription /
 * group_subscription / …) are deliberately not in this enum — they are defined in the core/assets/* config
 * and matched by prefix (stored values may carry historical suffixes).
 */
export const AssetCode = {
  /**
   * Bucket for credits redeemed from personal vouchers. Shares the stored value with the organization voucher credit pool (another table),
   * so personal and organization voucher credit readings agree.
   */
  VOUCHER_CREDIT: "voucher_credit",

  /**
   * One-off (non-renewing) pools, hidden from the stats cards once exhausted (remaining <= 0).
   * REGISTRATION_BONUS now lands in the new user's personal-workspace ORG pool (the old wallet is retired);
   * ORG_CREDITS_TOPUP / ALLOCATED_CREDITS are organization-side.
   */
  REGISTRATION_BONUS: "registration_bonus",
  ORG_CREDITS_TOPUP: "credits_topup",
  ALLOCATED_CREDITS: "allocated_credits",

  /**
   * Child-side allocation batches classified by source: credits a parent allocates from a specific source pool land in the child's
   * matching slot category (topup slot / voucher slot), so the child's bucket cards and consumption priority
   * follow the source. Legacy unclassified ALLOCATED_CREDITS batches (grant slot) still coexist with them.
   */
  ALLOCATED_TOPUP_CREDITS: "allocated_topup_credits",
  ALLOCATED_VOUCHER_CREDITS: "allocated_voucher_credits",

  /**
   * Recurring subscription slot batch on a CHILD org: reset to the configured amount at each funding-cycle boundary by the recurring allocation orchestrator
   * (services/recurring_allocation.py) —
   * never by ensure_fresh (the row keeps plan_cycle=NoCycle). Belongs to the subscription pool category,
   * shows on the subscription card and is consumed first.
   */
  ALLOCATED_SUBSCRIPTION_CREDITS: "allocated_subscription_credits",

  /**
   * Parent-side allocation marker pool (used_amount = credits allocated to children). Deliberately not in
   * the stats hide list: its negative balance must stay visible, or the allocated/remaining stats go wrong; the consume side
   * counts it as aggregate-only (see asset_core).
   */
  ALLOCATED_OUT: "allocated_credits_out",

  /**
   * Parent-side allocation markers classified by source: the liability for credits allocated out of a specific source pool (chosen by the allocator).
   * Aggregate-only like ALLOCATED_OUT; credits_buckets first nets
   * each classified liability against its own bucket (see asset_core).
   */
  ALLOCATED_OUT_TOPUP: "allocated_credits_out_topup",
  ALLOCATED_OUT_VOUCHER: "allocated_credits_out_voucher",

  /** Personal (user-level) credits top-up wallet. */
  PERSONAL_CREDITS_TOPUP: "personal_credits_topup",

  /** Free-tier placeholder pool (see core/assets/organization.ts). */
  ORG_FREE: "org_free",
  PERSONAL_FREE: "personal_free",
} as const;
export type AssetCode = (typeof AssetCode)[keyof typeof AssetCode];

/**
 * Feature-level classification of Consume ledger rows (the `usage_type` column of both ledger tables): which
 * product capability spent the credits, independent of the model/service that priced them.
 *
 * Deliberately nullable: rows written before tagging shipped (and untagged callers) stay NULL — usage
 * history and CSV export then fall back to the row's model service_name. Stored as a plain string column
 * (String(50), same pattern as AssetCode), so members can evolve without rebuilding a PG enum type.
 */
export const UsageType = {
  /** AI chat / reader / interaction-service Q&A turns */
  CHAT: "chat",
  /** Live classroom teaching + explanation pre-generation */
  TEACHING: "teaching",
  /** Quizzes / student answers / in-class scoring */
  SCORING: "scoring",
  /** Courseware authoring agent, templates, images, search, video rendering */
  COURSEWARE: "courseware",
  /** TTS (including narration), ASR/dictation, realtime voice */
  VOICE: "voice",
  /** Knowledge-base file transcription + title/summary */
  KNOWLEDGE_BASE: "knowledge_base",
} as const;
export type UsageType = (typeof UsageType)[keyof typeof UsageType];

/**
 * English display labels for UsageType — the server's single source of truth, used by CSV export and by usage history's
 * compatibility `service_name` backfill (console maps the code to localized labels itself).
 * Deliberately no fallback label: untagged rows show the row's model service_name instead.
 */
export const USAGE_TYPE_EN_LABELS: Record<UsageType, string> = {
  [UsageType.CHAT]: "AI Chat",
  [UsageType.TEACHING]: "AI Teaching",
  [UsageType.SCORING]: "AI Scoring",
  [UsageType.COURSEWARE]: "Courseware Authoring",
  [UsageType.VOICE]: "Voice Services",
  [UsageType.KNOWLEDGE_BASE]: "Knowledge Base",
};

/**
 * service_code → UsageType fallback for consumption whose caller did not tag it
 * (e.g. agent-service builds older than the usage_type field). Keys are DB-normalized codes
 * (lowercase, spaces → underscores, hyphens and dots kept — see service_price.normalize_service_code).
 * Only codes that belong to exactly one feature may go here: codes shared across features (generic LLM models,
 * and tavily-search — billed by both the courseware authoring agent and interactive Q&A search) must stay untagged
 * (NULL), or older untagged callers get misclassified; display falls back to the code's
 * service_name.
 */
export const SERVICE_CODE_USAGE_TYPE: Record<string, UsageType> = {
  "fishaudio-s1": UsageType.VOICE,
  "fishaudio-s2.1-pro": UsageType.VOICE,
  // MiniMax canonical code + the underscore spelling from before the dot migration: where an environment still resolves to
  // the speech-2_8-hd service price row, untagged /v1/credits consumption still counts as VOICE.
  "speech-2.8-hd": UsageType.VOICE,
  "speech-2_8-hd": UsageType.VOICE,
  "gemini-3.8-flash-tts": UsageType.VOICE,
  "gemini-3.8-flash-lite-tts": UsageType.VOICE,
  "whisper-1": UsageType.VOICE,
  "gpt-4o-transcribe": UsageType.VOICE,
  "gpt-4o-mini-transcribe": UsageType.VOICE,
  "gpt-image-2": UsageType.COURSEWARE,
  "gpt-image-2.5-flare": UsageType.COURSEWARE,
  "gpt-image-2.5-sunburst": UsageType.COURSEWARE,
  "gemini-3-pro-image": UsageType.COURSEWARE,
  "video-render": UsageType.COURSEWARE,
};

/**
 * Best-effort usage type derived from a feature-specific service_code.
 *
 * Generic LLM model codes return None — several features share them, so only write-time tagging can classify them.
 */
export function deriveUsageTypeFromServiceCode(
  serviceCode: string | null | undefined,
): UsageType | null {
  if (!serviceCode) {
    return null;
  }
  const code = serviceCode.trim().toLowerCase();
  const direct = SERVICE_CODE_USAGE_TYPE[code];
  if (direct !== undefined) {
    return direct;
  }
  // digit_digit → digit.digit: lets the folded spelling from before the service_code migration still hit the canonical key.
  const canonical = code.replace(/(?<=\d)_(?=\d)/g, ".");
  if (canonical !== code) {
    const viaCanonical = SERVICE_CODE_USAGE_TYPE[canonical];
    if (viaCanonical !== undefined) {
      return viaCanonical;
    }
  }
  // Realtime voice pseudo-codes: "<model>-live-…-audio" / "…-text"
  // (per-modality billing codes synthesized by live_session_credits_wrapper).
  if (code.includes("-live-") && (code.endsWith("-audio") || code.endsWith("-text"))) {
    return UsageType.VOICE;
  }
  return null;
}
