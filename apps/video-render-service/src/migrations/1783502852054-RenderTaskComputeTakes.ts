// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Per-instance timing for distributed billing:
 * - render_task.plan_takes_ms: plan+upload wall on the plan instance
 * - render_task_chunk.duration_ms: download+renderChunk+upload wall on each chunk instance
 */
export class RenderTaskComputeTakes1783502852054 implements MigrationInterface {
  name = "RenderTaskComputeTakes1783502852054";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "render_task"
        ADD COLUMN IF NOT EXISTS "plan_takes_ms" integer
    `);
    await queryRunner.query(`
      ALTER TABLE "render_task_chunk"
        ADD COLUMN IF NOT EXISTS "duration_ms" integer
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "render_task_chunk"
        DROP COLUMN IF EXISTS "duration_ms"
    `);
    await queryRunner.query(`
      ALTER TABLE "render_task"
        DROP COLUMN IF EXISTS "plan_takes_ms"
    `);
  }
}
