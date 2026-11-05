// SPDX-License-Identifier: AGPL-3.0-only
import {
  listEnabledPlatformPronunciationDictEntries,
  loadMergedPronunciationDictEntries,
} from './tts-platform-pronunciation-dict.ts';
import type { PronunciationDictEntry } from './tts-pronunciation-apply.ts';

/**
 * Load the merged pronunciation dict (org entries first, then platform entries
 * not shadowed by the org) for a Google / MiniMax / FishAudio narration host spawn.
 * A session without an org (e.g. an unbound chat courseware) still gets the
 * platform dict when the job is Japanese. runHostNarration writes the JSON to a
 * temp file for the child (path in env), so there is no size cap. Returns the
 * JSON, `null` when empty (clears an inherited key), or `undefined` when the
 * provider does not use the dict or there is neither an org nor a Japanese job.
 */
export async function resolveNarrationPronunciationDictJson(args: {
  orgId?: string | null;
  ttsProvider?: string | null;
  /**
   * Japanese job (teacher / voice language ja) → merge the platform dict. Resolve it
   * from the session catalog BEFORE calling this (see `resolveNarrationLanguagesForJob`).
   */
  includePlatform: boolean;
  /** Test seam; production uses the DB-backed merged loader. */
  loadMerged?: (
    orgId: string,
    options: { includePlatform: boolean },
  ) => Promise<PronunciationDictEntry[]>;
  /** Test seam for org-less sessions; production reads the cached platform dict. */
  listPlatform?: () => Promise<PronunciationDictEntry[]>;
}): Promise<string | null | undefined> {
  const orgId = args.orgId?.trim();
  const provider = args.ttsProvider?.trim().toLowerCase();
  if (provider !== 'google' && provider !== 'minimax' && provider !== 'fishaudio') {
    return undefined;
  }
  if (!orgId && !args.includePlatform) {
    return undefined;
  }
  try {
    const entries = orgId
      ? await (args.loadMerged ?? loadMergedPronunciationDictEntries)(orgId, {
          includePlatform: args.includePlatform,
        })
      : await (args.listPlatform ?? listEnabledPlatformPronunciationDictEntries)();
    return entries.length === 0 ? null : JSON.stringify(entries);
  } catch (error) {
    console.warn(
      '[tts-pronunciation-dict] failed to load dict for narration host:',
      error instanceof Error ? error.message : String(error),
    );
    return undefined;
  }
}
