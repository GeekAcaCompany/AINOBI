// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from "typeorm";

export class RenderTask1783502852051 implements MigrationInterface {
  name = "RenderTask1783502852051";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "render_task" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "org_id" uuid,
        "user_id" uuid,
        "courseware_id" uuid,
        "status" character varying(20) NOT NULL,
        "stage" character varying(64),
        "progress" smallint NOT NULL DEFAULT 0,
        "request" jsonb NOT NULL,
        "result" jsonb,
        "error_message" text,
        "retry_count" integer NOT NULL DEFAULT 0,
        "queued_at" TIMESTAMPTZ NOT NULL,
        "started_at" TIMESTAMPTZ,
        "heartbeat_at" TIMESTAMPTZ,
        "completed_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_render_task" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_render_task_courseware_created"
        ON "render_task" ("courseware_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_render_task_user_created"
        ON "render_task" ("user_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "ix_render_task_status"
        ON "render_task" ("status")
    `);
    // Dispatcher scans queued tasks frequently; keep that lookup on a small partial index.
    await queryRunner.query(`
      CREATE INDEX "ix_render_task_status_queued"
        ON "render_task" ("created_at")
        WHERE "status" = 'queued'
    `);
    // Reconciliation sweep scans running tasks for stale heartbeats.
    await queryRunner.query(`
      CREATE INDEX "ix_render_task_status_running"
        ON "render_task" ("heartbeat_at")
        WHERE "status" = 'running'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_render_task_status_running"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_render_task_status_queued"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_render_task_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_render_task_user_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_render_task_courseware_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "render_task"`);
  }
}
