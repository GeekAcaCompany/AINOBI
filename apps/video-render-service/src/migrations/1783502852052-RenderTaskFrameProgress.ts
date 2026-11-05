// SPDX-License-Identifier: AGPL-3.0-only
import type { MigrationInterface, QueryRunner } from "typeorm";

export class RenderTaskFrameProgress1783502852052 implements MigrationInterface {
  name = "RenderTaskFrameProgress1783502852052";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "render_task"
        ADD COLUMN "frames_rendered" integer,
        ADD COLUMN "total_frames" integer
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "render_task"
        DROP COLUMN IF EXISTS "frames_rendered",
        DROP COLUMN IF EXISTS "total_frames"
    `);
  }
}
