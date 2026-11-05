// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from "typeorm";

export class RenderTaskDistributed1783502852053 implements MigrationInterface {
  name = "RenderTaskDistributed1783502852053";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "render_task"
        ADD COLUMN IF NOT EXISTS "render_mode" character varying(20) NOT NULL DEFAULT 'single',
        ADD COLUMN IF NOT EXISTS "plan_oss_prefix" character varying(512),
        ADD COLUMN IF NOT EXISTS "plan_hash" character varying(128),
        ADD COLUMN IF NOT EXISTS "chunk_count" integer,
        ADD COLUMN IF NOT EXISTS "distributed_phase" character varying(32)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "render_task_chunk" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "task_id" uuid NOT NULL,
        "chunk_index" integer NOT NULL,
        "start_frame" integer NOT NULL,
        "end_frame" integer NOT NULL,
        "status" character varying(20) NOT NULL,
        "affinity_id" uuid NOT NULL,
        "oss_key" character varying(512),
        "error_message" text,
        "frames_encoded" integer,
        "queued_at" TIMESTAMPTZ NOT NULL,
        "started_at" TIMESTAMPTZ,
        "heartbeat_at" TIMESTAMPTZ,
        "completed_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_render_task_chunk" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_render_task_chunk_task_index" UNIQUE ("task_id", "chunk_index"),
        CONSTRAINT "FK_render_task_chunk_task"
          FOREIGN KEY ("task_id") REFERENCES "render_task"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_render_task_chunk_task_status"
        ON "render_task_chunk" ("task_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_render_task_chunk_affinity"
        ON "render_task_chunk" ("affinity_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_render_task_chunk_affinity"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_render_task_chunk_task_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "render_task_chunk"`);
    await queryRunner.query(`
      ALTER TABLE "render_task"
        DROP COLUMN IF EXISTS "distributed_phase",
        DROP COLUMN IF EXISTS "chunk_count",
        DROP COLUMN IF EXISTS "plan_hash",
        DROP COLUMN IF EXISTS "plan_oss_prefix",
        DROP COLUMN IF EXISTS "render_mode"
    `);
  }
}
