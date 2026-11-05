// SPDX-License-Identifier: AGPL-3.0-only
import { Column, Entity, PrimaryColumn } from "typeorm";

/**
 * Read-only mapping of the education backend's `tts_pronunciation` table: the
 * platform-level pronunciation dictionary maintained by platform admins.
 *
 * The table lives in the same Postgres database and is OWNED AND MIGRATED BY
 * ainobi-backend (Alembic). This service only reads it. `synchronize: false`
 * keeps `yarn db:migration:generate` from emitting a migration for it. Do NOT
 * add a TypeORM migration or write to this table from here.
 */
@Entity({ name: "tts_pronunciation", synchronize: false })
export class TtsPronunciationPlatform {
  @PrimaryColumn({ type: "uuid" })
  id: string;

  @Column({ name: "source_text", type: "varchar", length: 256 })
  sourceText: string;

  @Column({ type: "varchar", length: 8 })
  language: string;

  @Column({ type: "varchar", length: 512 })
  pronunciation: string;

  @Column({ type: "boolean" })
  enabled: boolean;

  @Column({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt: Date | null;
}
