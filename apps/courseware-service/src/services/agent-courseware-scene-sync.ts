// SPDX-License-Identifier: AGPL-3.0-only
import { createHash } from 'node:crypto';
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { agentAinobiStateDir } from './agent-workspace.ts';
import {
  invalidateAgentWorkspaceSessionCache,
  readAgentWorkspaceSession,
} from './agent-live-preview-flush.ts';

export type CliSessionSyncRecord = {
  scene: unknown;
  dirty?: boolean;
  loaded_at?: string;
  saved_at?: string | null;
  courseware_synced_at?: string | null;
};

export type SceneSyncAssessment =
  | { status: 'in_sync' }
  | {
      status: 'stale';
      reason: 'db_updated_at' | 'content_mismatch';
      hadUnsavedCliChanges: boolean;
    };

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

/** Canonical JSON for stable content comparison (sorted object keys). */
const stableStringify = (value: unknown): string => {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      return v.map(normalize);
    }
    if (v && typeof v === 'object') {
      const record = v as Record<string, unknown>;
      return Object.keys(record)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = normalize(record[key]);
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(normalize(value));
};

export const sceneContentFingerprint = (content: Record<string, unknown>): string =>
  createHash('sha256').update(stableStringify(content)).digest('hex');

/**
 * True when the on-disk ainobi CLI session is behind the database courseware row.
 * Prefers `courseware.updated_at` when recorded on the session; falls back to content hash.
 */
export const assessCliSessionVsDatabase = (
  session: CliSessionSyncRecord,
  dbContent: Record<string, unknown>,
  dbUpdatedAt: Date,
): SceneSyncAssessment => {
  const dbMs = dbUpdatedAt.getTime();
  const syncedRaw =
    session.courseware_synced_at?.trim() ||
    session.saved_at?.trim() ||
    session.loaded_at?.trim() ||
    null;
  const syncedMs = syncedRaw ? Date.parse(syncedRaw) : Number.NaN;
  const dirty = session.dirty === true;
  const dbFp = sceneContentFingerprint(dbContent);
  const cliScene =
    session.scene && typeof session.scene === 'object'
      ? (session.scene as Record<string, unknown>)
      : {};
  const cliFp = sceneContentFingerprint(cliScene);

  if (Number.isFinite(syncedMs) && dbMs > syncedMs) {
    return { status: 'stale', reason: 'db_updated_at', hadUnsavedCliChanges: dirty };
  }

  if (dbFp !== cliFp) {
    if (dirty && Number.isFinite(syncedMs) && dbMs <= syncedMs) {
      return { status: 'in_sync' };
    }
    return { status: 'stale', reason: 'content_mismatch', hadUnsavedCliChanges: dirty };
  }

  return { status: 'in_sync' };
};

/** Remove bound ainobi CLI session files so `ainobi load` can run again in agent runtime. */
export const clearAgentWorkspaceCliSession = async (workspaceDir: string): Promise<void> => {
  const stateDir = agentAinobiStateDir(workspaceDir);
  if (!(await pathExists(stateDir))) {
    invalidateAgentWorkspaceSessionCache(workspaceDir);
    return;
  }

  const names = await readdir(stateDir);
  await Promise.all(
    names.map(async (name) => {
      const path = join(stateDir, name);
      if (name === '.current') {
        const currentNames = await readdir(path);
        await Promise.all(currentNames.map((child) => rm(join(path, child), { force: true })));
        return;
      }
      if (name.startsWith('ainobi-') && name.endsWith('.json')) {
        await rm(path, { force: true });
      }
    }),
  );
  invalidateAgentWorkspaceSessionCache(workspaceDir);
};

/** After host persistence, align session baseline with the saved courseware row. */
export const patchAgentWorkspaceSessionSyncedAt = async (
  workspaceDir: string,
  coursewareUpdatedAt: string,
): Promise<void> => {
  const syncedAt = coursewareUpdatedAt.trim();
  if (!syncedAt) {
    return;
  }

  const sessionPath = await findSessionFilePath(workspaceDir);
  if (!sessionPath) {
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await readFile(sessionPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return;
  }

  parsed.courseware_synced_at = syncedAt;
  parsed.dirty = false;
  await writeFile(sessionPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  invalidateAgentWorkspaceSessionCache(workspaceDir);
};

async function findSessionFilePath(workspaceDir: string): Promise<string | null> {
  const session = await readAgentWorkspaceSession(workspaceDir);
  if (!session?.session_id?.trim()) {
    return null;
  }
  return join(agentAinobiStateDir(workspaceDir), `${session.session_id.trim()}.json`);
}

export const COURSEWARE_REFRESHED_SYSTEM_PROMPT = [
  '**Courseware refreshed from database (host):** The on-disk ainobi CLI session was older than the saved courseware in the database. The host re-ran `ainobi load` with the latest content before this turn.',
  'The loaded scene (including element positions from the editor) is the source of truth. Do not restore layout from earlier turns in this conversation.',
  'A full field-level diff (page 1) is injected below when available; use `ainobi inspect scene-sync --page N` for additional pages.',
  'Start with `ainobi scene info --verbose` or `ainobi element get` for the target element before editing.',
  'Do not run `ainobi load` or `ainobi init` again unless the user asks to start over.',
].join(' ');

/** Injected every agent chat — users are editors, not CLI operators. */
export const COURSEWARE_USER_COMMUNICATION_SYSTEM_PROMPT = [
  '**User-facing language (required):** The user is authoring courseware in the AINOBI editor, not operating a terminal.',
  'In chat replies, describe outcomes in editor terms only (slides, copy, narration/voiceover, motion, quizzes, layout, preview).',
  'Never mention `ainobi`, CLI subcommands, flags, shell, `work_dir`, session files, or raw JSON tool output.',
  'Do not paste command examples, bash blocks, or implementation checklists.',
  'Never ask the user to run commands, install tools, open a terminal, or perform technical steps on your behalf — you execute all authoring yourself.',
  'Progress updates state what changed for the course (e.g. "Added the entrance animation for the page-2 title", written in the user\'s language), not which CLI step ran.',
  'When you need input, ask about content and design (message, tone, AI teacher voice, slide goals), not tooling.',
].join(' ');

/** Injected every agent chat so typography-only requests do not overwrite editor layout. */
export const COURSEWARE_NARROW_EDIT_SYSTEM_PROMPT = [
  '**Layout preservation:** When the user asks for a narrow change (font size, color, bold, text content, etc.), run `ainobi element get` first, then `ainobi element update` with only the fields they requested.',
  'Do not set `position`, `size`, or `align` unless the user explicitly asks to move, resize, center, or realign.',
  'Never "fix" or re-center elements to match a previous turn after the editor or database scene has changed.',
].join(' ');
