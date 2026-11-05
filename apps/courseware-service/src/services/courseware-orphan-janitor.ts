// SPDX-License-Identifier: AGPL-3.0-only
import { dataSource } from '../db/db.ts';
import { clearAllAgentHistoryForCourseware } from './conversation-service.ts';

/**
 * Empty shell courseware cleanup (R2): the AI courseware create flow **writes the courseware row first and then opens the planning stream** — when the planning stream fails /
 * is interrupted it leaves orphan rows with tiny content (≈1KB scaffold), no session transcript and no versions,
 * piling up endlessly in the management list (red team measured 8 rows from one session on 2026-09-06).
 *
 * Criteria (four conservative checks; better to miss than to delete wrongly): tiny content + created over 48h ago + zero transcript rows
 * (project_key LIKE %courseware id%, across the /code → /app key forms) + zero versions. Only when all four hit
 * is it deleted — a purely hand-built empty courseware that never had a conversation and saw no update in 48h is reclaimable too.
 */

const JANITOR_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 60 * 1000;
const MIN_AGE_HOURS = 48;
const MAX_SCAFFOLD_CONTENT_BYTES = 2000;
const BATCH_LIMIT = 50;

function janitorEnabled(): boolean {
  return process.env.COURSEWARE_ORPHAN_JANITOR !== 'false';
}

async function sweepOnce(): Promise<number> {
  if (!dataSource.isInitialized) {
    return 0;
  }
  const rows = (await dataSource.query(
    `SELECT c.id::text AS id, c.title AS title
       FROM courseware c
      WHERE length(c.content::text) < $1
        AND c.created_at < now() - ($2 || ' hours')::interval
        AND NOT EXISTS (
              SELECT 1 FROM courseware_session_transcript_line t
               WHERE t.project_key LIKE '%' || c.id::text || '%')
        AND NOT EXISTS (
              SELECT 1 FROM courseware_version v
               WHERE v.courseware_id = c.id)
      LIMIT $3`,
    [MAX_SCAFFOLD_CONTENT_BYTES, String(MIN_AGE_HOURS), BATCH_LIMIT],
  )) as Array<{ id: string; title: string }>;

  let removed = 0;
  for (const row of rows) {
    try {
      // Reuse the existing cleanup: conversations/transcripts/workspaces are cleared together
      await clearAllAgentHistoryForCourseware(row.id);
      // The FK cascade also deletes section binding rows: record the affected sections first and recompute after the delete
      // the backend has_courseware_bound flag (course_section written directly in the same database)
      // The delete and the flag recompute share one transaction: if the recompute fails the delete rolls back and the next sweep retries
      await dataSource.transaction(async (tx) => {
        const boundSections = (await tx.query(
          `SELECT DISTINCT section_id::text AS section_id
             FROM courseware_section_binding WHERE courseware_id::text = $1`,
          [row.id],
        )) as Array<{ section_id: string }>;
        await tx.query('DELETE FROM courseware WHERE id::text = $1', [row.id]);
        if (boundSections.length > 0) {
          await tx.query(
            `UPDATE course_section cs
               SET has_courseware_bound = EXISTS (
                     SELECT 1 FROM courseware_section_binding b
                     WHERE b.section_id = cs.section_id
                   ),
                   updated_at = NOW()
             WHERE cs.section_id = ANY($1::uuid[])`,
            [boundSections.map((r) => r.section_id)],
          );
        }
      });
      removed += 1;
      console.info(`[orphan-janitor] removed empty scaffold courseware ${row.id} (${row.title})`);
    } catch (error) {
      console.warn(
        '[orphan-janitor] row cleanup failed:',
        error instanceof Error ? error.message : error,
      );
    }
  }
  return removed;
}

let janitorTickInProgress = false;

async function tick(): Promise<void> {
  if (janitorTickInProgress) {
    return;
  }
  janitorTickInProgress = true;
  try {
    const removed = await sweepOnce();
    if (removed > 0) {
      console.info(`[orphan-janitor] sweep removed ${removed} empty scaffold courseware(s)`);
    }
  } catch (error) {
    console.warn('[orphan-janitor] tick failed:', error instanceof Error ? error.message : error);
  } finally {
    janitorTickInProgress = false;
  }
}

export function startCoursewareOrphanJanitor(): void {
  if (!janitorEnabled()) {
    return;
  }
  setTimeout(() => {
    void tick().catch(() => {});
  }, INITIAL_DELAY_MS);
  setInterval(() => {
    void tick().catch(() => {});
  }, JANITOR_INTERVAL_MS);
  console.info(
    `[orphan-janitor] worker started intervalMs=${JANITOR_INTERVAL_MS} minAgeHours=${MIN_AGE_HOURS}`,
  );
}
