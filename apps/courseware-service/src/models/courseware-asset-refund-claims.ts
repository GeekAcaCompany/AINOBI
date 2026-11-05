// SPDX-License-Identifier: AGPL-3.0-only
import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

/**
 * Durable "this org's charge for contentMd5 has been refunded" marker.
 *
 * The advisory-lock serialization of the last-reference decision cannot make
 * the second concurrent delete a no-op by itself — both see zero remaining
 * rows after both transactions committed. This claim row is the durable
 * state: INSERT ... ON CONFLICT DO NOTHING wins exactly once per
 * (orgId, contentMd5); the loser skips its decrement. Cleared when a new
 * charge for the same (org, md5) lands so future deletes can refund again.
 */
@Entity("courseware_asset_refund_claims")
export class CoursewareAssetRefundClaim {
  @PrimaryColumn({ name: "org_id", type: "uuid" })
  orgId: string;

  @PrimaryColumn({ name: "content_md5", type: "char", length: 32 })
  contentMd5: string;

  @CreateDateColumn({ name: "claimed_at", type: "timestamptz", default: () => "now()" })
  claimedAt: Date;

  /** false = claimed but the debit hasn't succeeded yet (retryable); true = the quota was returned. */
  @Column({ name: "refunded", type: "boolean", default: false })
  refunded: boolean;
}
