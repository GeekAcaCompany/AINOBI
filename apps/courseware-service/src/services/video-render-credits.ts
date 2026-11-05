// SPDX-License-Identifier: AGPL-3.0-only
import {
  AinobiCreditsConsumeError,
  isVideoRenderCreditsConsumptionEnabled,
  resolveCreditsOrgId,
  resolveVideoRenderCreditsServiceCode,
  type CreditsConsumeResult,
} from './ainobi-credits.ts';
import { isOrgStorageIntegrationEnabled } from './ainobi-org-storage.ts';
import { consumeAinobiCredits } from './credits-consume-retry.ts';
import {
  savePendingRenderTaskBilling,
  takePendingRenderTaskBilling,
  type PendingRenderTaskBilling,
} from '../models/render-task-billing.ts';
import {
  commitRenderTaskOrganizationStorage,
  type StoragedRenderTask,
  type VideoRenderStorageOutcome,
} from './video-render-org-storage.ts';

const MS_PER_MINUTE = 60_000;

/** Minimal shape of a render task response needed to settle credits + org storage. */
export type BillableRenderTask = StoragedRenderTask & {
  result?: {
    render?: {
      /** Output video duration ms (not used for credits). */
      duration?: number;
      /** Parent wall-clock ms (legacy / observability). */
      takes?: number;
      /**
       * Sum of per-instance wall clocks (plan + chunks + assemble).
       * Preferred for billing after distributed renders; falls back to `takes`.
       */
      computeTakes?: number;
    } | null;
    oss?: { sizeBytes?: number } | null;
    cover?: { sizeBytes?: number } | null;
  } | null;
};

export type VideoRenderBillingOutcome =
  | { kind: 'charged'; result: CreditsConsumeResult; minutes: number; billableTakesMs: number }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; error: string };

export type VideoRenderSettlementOutcome = {
  billing: VideoRenderBillingOutcome;
  storage: VideoRenderStorageOutcome;
};

/**
 * Prefer `computeTakes` (sum of instance work) so distributed parallelization still
 * bills total FC compute; fall back to wall-clock `takes` for older single-path rows.
 */
export function resolveVideoRenderBillableTakesMs(task: BillableRenderTask): number | null {
  const computeTakes = task.result?.render?.computeTakes;
  if (typeof computeTakes === 'number' && Number.isFinite(computeTakes) && computeTakes > 0) {
    return computeTakes;
  }
  const takes = task.result?.render?.takes;
  if (typeof takes === 'number' && Number.isFinite(takes) && takes > 0) {
    return takes;
  }
  return null;
}

/** CountBased minutes: ceil(ms/60000), minimum 1. */
export function computeVideoRenderBillableMinutes(billableTakesMs: number): number {
  return Math.max(1, Math.ceil(billableTakesMs / MS_PER_MINUTE));
}

function buildVideoRenderBillingContent(args: {
  taskId: string;
  coursewareId: string;
  minutes: number;
  billableTakesMs: number;
}): string {
  return (
    `Courseware video export, task=${args.taskId}, courseware=${args.coursewareId}, ` +
    `renderMinutes=${args.minutes}, billableTakesMs=${args.billableTakesMs}`
  );
}

async function billWithPending(
  task: BillableRenderTask,
  pending: PendingRenderTaskBilling,
): Promise<VideoRenderBillingOutcome> {
  if (!isVideoRenderCreditsConsumptionEnabled()) {
    return { kind: 'skipped', reason: 'billing disabled' };
  }

  const billableTakesMs = resolveVideoRenderBillableTakesMs(task);
  if (billableTakesMs == null) {
    console.warn(
      `[credits] video render task=${task.id} completed with no usable computeTakes/takes; skipping billing`,
    );
    return { kind: 'skipped', reason: 'missing render computeTakes/takes' };
  }
  const minutes = computeVideoRenderBillableMinutes(billableTakesMs);

  const serviceCode = resolveVideoRenderCreditsServiceCode();
  if (!serviceCode) {
    return { kind: 'skipped', reason: 'no service code configured' };
  }

  try {
    const result = await consumeAinobiCredits(
      pending.accessToken,
      {
        serviceCode,
        orgId: resolveCreditsOrgId(pending.orgId),
        amountUnit: 'tokens',
        amount: String(minutes),
        unitCount: minutes,
        count: minutes,
        content: buildVideoRenderBillingContent({
          taskId: task.id,
          coursewareId: pending.coursewareId,
          minutes,
          billableTakesMs,
        }),
        idempotencyKey: `video-render:${task.id}`,
        // Feature bucket for usage breakdown: video export inside courseware authoring
        usageType: 'courseware',
      },
      { phase: 'video_render' },
    );
    console.info(
      `[credits] video render task=${task.id} billableTakesMs=${billableTakesMs} minutes=${minutes} credits=${result.creditsConsumed}`,
    );
    return { kind: 'charged', result, minutes, billableTakesMs };
  } catch (error) {
    const message =
      error instanceof AinobiCreditsConsumeError || error instanceof Error ? error.message : String(error);
    console.warn(`[credits] video render billing failed task=${task.id}:`, message);
    return { kind: 'failed', error: message };
  }
}

/**
 * Settles a completed render task exactly once: credits (if enabled) + org storage (if enabled).
 * Uses the access token captured at create time. Never throws.
 *
 * Both webhook and list-fallback call this; the pending Redis record is taken at most once so
 * concurrent callers cannot double-charge credits or storage.
 */
export async function settleCompletedRenderTask(
  task: BillableRenderTask,
): Promise<VideoRenderSettlementOutcome> {
  if (task.status !== 'completed') {
    return {
      billing: { kind: 'skipped', reason: 'task is not completed' },
      storage: { kind: 'skipped', reason: 'task is not completed' },
    };
  }

  const creditsWanted = isVideoRenderCreditsConsumptionEnabled();
  const pending = await takePendingRenderTaskBilling(task.id);
  if (!pending) {
    return {
      billing: {
        kind: 'skipped',
        reason: creditsWanted
          ? 'no pending billing record (already settled, anonymous, or expired)'
          : 'no pending settlement record',
      },
      storage: { kind: 'skipped', reason: 'no pending settlement record' },
    };
  }

  const billing = await billWithPending(task, pending);
  const storage = isOrgStorageIntegrationEnabled(pending.orgId)
    ? await commitRenderTaskOrganizationStorage({
        task,
        accessToken: pending.accessToken,
        orgId: pending.orgId,
      })
    : { kind: 'skipped' as const, reason: 'org storage disabled or missing org' };

  if (storage.kind === 'failed') {
    await savePendingRenderTaskBilling(task.id, pending);
  }

  return { billing, storage };
}

/**
 * @deprecated Prefer {@link settleCompletedRenderTask} — kept for call sites/tests that only
 * assert billing. Still settles storage when a pending record is present.
 */
export async function maybeBillCompletedRenderTask(
  task: BillableRenderTask,
): Promise<VideoRenderBillingOutcome> {
  const outcome = await settleCompletedRenderTask(task);
  return outcome.billing;
}
