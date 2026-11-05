// SPDX-License-Identifier: AGPL-3.0-only
import { AinobiCliError } from '@ainobi/courseware-cli/cli/errors.ts';
import {
  applyTtsCatalogToTeacher,
  resolveTeacherTtsSettings,
  type AITeacher,
  type AITeacherTtsSettings,
} from '@ainobi/courseware-cli/cli/ai-teachers.ts';
import {
  synthesizeAndUploadTtsLine,
  trimNarrationLine,
} from '@ainobi/courseware-cli/cli/tts.ts';
import { dataSource } from '../db/db.ts';
import { CoursewareTtsStorageRef } from '../models/courseware-tts-storage-refs.ts';
import {
  acquireCoursewareUploadStorageLock,
  confirmCoursewareUploadStorageLock,
  decrementCoursewareObjectStorage,
  orgStorageErrorStatus,
  releaseCoursewareUploadStorageLock,
} from './courseware-asset-org-storage.ts';
import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import { resolveManagedOrgIds } from '../auth/ainobi-org-access.ts';
import {
  assertCanQueryOrgAiTeachers,
  fetchOrgAiTeachersFromPlatform,
} from './ainobi-ai-teachers.ts';
import {
  assertCanQueryOrgTts,
  fetchOrgTtsByIdFromPlatform,
} from './ainobi-tts.ts';
import { resolveTtsStylePrompt } from '@ainobi/courseware-cli/cli/tts-style-presets.ts';
import { billNarrationTtsCredits } from './narration-tts-billing.ts';
import { resolveCoursewarePlatformOrgId } from './courseware-platform-org.ts';
import {
  countTtsTextCharacters,
  normalizeNarrationTtsProvider,
  type NarrationTtsBillingOutcome,
  type NarrationTtsProvider,
} from './narration-tts-credits.ts';
import {
  normalizePronunciationSourceKey,
  shouldApplyPronunciationDict,
  type PronunciationDictEntry,
  type PronunciationDictLanguage,
} from '@ainobi/courseware-cli/cli/tts-pronunciation-apply.ts';
import { loadMergedPronunciationDictEntries } from './tts-platform-pronunciation-dict.ts';
import {
  isJapaneseNarrationLanguage,
  rewriteJapaneseTextToKanaForTts,
} from './tts-japanese-auto-kana.ts';

export type CoursewareTtsPronunciationOverride = {
  sourceText: string;
  language: PronunciationDictLanguage;
  pronunciation: string;
};

export type CoursewareTtsSynthesizeInput = {
  text: string;
  format?: string;
  ai_teacher_id: string;
  /** Optional platform TTS catalog id — overrides the teacher's bound voice. */
  tts_id?: string;
  /** Optional narration style key (recommended preset or style-catalog key). */
  tts_style?: string;
  speech_rate?: number;
  courseware_id?: string;
  courseware_org_id?: string;
  conversation_id?: string;
  course_id?: string;
  /** Single-synthesis override (pronunciation dictionary preview): takes priority over the organization dictionary entry with the same source */
  pronunciation_override?: CoursewareTtsPronunciationOverride;
};

export type CoursewareTtsSynthesizePrep = {
  text: string;
  format: string;
  settings: AITeacherTtsSettings;
  requestedVoiceId: string | undefined;
  orgId: string;
  coursewareId?: string;
  aiTeacherId: string;
  ttsProvider: NarrationTtsProvider;
  pronunciationOverride?: CoursewareTtsPronunciationOverride;
  /** Teacher or selected catalog voice language is Japanese → full-text kana rewrite. */
  japaneseAutoKana: boolean;
};

export type CoursewareTtsSynthesizeResult = {
  tts_url: string;
  object_key: string;
  format: string;
  content_type: string;
  duration_ms: number;
  tts_provider: NarrationTtsProvider;
  voice_fallback_applied: boolean;
  org_id: string;
  courseware_id?: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const matchAiTeacherLookupId = (teacher: AITeacher, lookupId: string): boolean =>
  teacher.ai_teacher_id === lookupId || teacher.ai_teacher_tts_id === lookupId;

async function resolveAiTeacher(
  session: AinobiAuthorizedSession,
  orgId: string,
  lookupId: string,
): Promise<AITeacher> {
  // Synthesis bills and writes to OSS: managed_list is required, membership alone isn't enough.
  await assertCanQueryOrgAiTeachers(session.accessToken, orgId, resolveManagedOrgIds);

  let lastCount = 0;
  for (const status of ['active', ''] as const) {
    const catalog = await fetchOrgAiTeachersFromPlatform(session.accessToken, orgId, {
      fetchAllPages: true,
      aiTeacherStatus: status,
    });
    lastCount = catalog.teachers.length;
    const matched = catalog.teachers.find((row) => matchAiTeacherLookupId(row, lookupId));
    if (matched) {
      return matched;
    }
  }

  throw new AinobiCliError(
    'NOT_FOUND',
    `AI teacher not found: ${lookupId} (organization ${orgId}, ${lastCount} teacher(s) loaded). ` +
      'Use the platform AI teacher id (`ai_teacher_id`), not the TTS catalog id (`ai_teacher_tts_id`). ' +
      'Ensure the teacher belongs to the courseware organization and is active.',
  );
}

function applySpeechRate(
  settings: AITeacherTtsSettings,
  speechRate: number | undefined,
): AITeacherTtsSettings {
  if (speechRate == null || !Number.isFinite(speechRate) || speechRate <= 0) {
    return settings;
  }
  return { ...settings, speed: speechRate };
}

/**
 * Resolve org / teacher / TTS settings without synthesizing.
 * Used so credits can be pre-charged before TTS provider work.
 */
export async function prepareCoursewareTtsSynthesize(
  session: AinobiAuthorizedSession,
  input: CoursewareTtsSynthesizeInput,
): Promise<CoursewareTtsSynthesizePrep> {
  const text = input.text?.trim();
  if (!text) {
    throw new AinobiCliError('USAGE', 'text is required.');
  }

  const aiTeacherId = input.ai_teacher_id?.trim();
  if (!aiTeacherId || !UUID_RE.test(aiTeacherId)) {
    throw new AinobiCliError('USAGE', 'ai_teacher_id must be a valid UUID.');
  }

  // Synthesis bills prep.orgId and uploads audio: the target org must be in managed_list.
  const { orgId, coursewareId } = await resolveCoursewarePlatformOrgId(
    session,
    {
      courseware_id: input.courseware_id,
      courseware_org_id: input.courseware_org_id,
    },
    { access: 'manage' },
  );
  const teacher = await resolveAiTeacher(session, orgId, aiTeacherId);
  let effectiveTeacher = teacher;
  let voiceLanguage: string | undefined;
  const ttsId = input.tts_id?.trim();
  if (ttsId) {
    if (!UUID_RE.test(ttsId)) {
      throw new AinobiCliError('USAGE', 'tts_id must be a valid UUID.');
    }
    await assertCanQueryOrgTts(session.accessToken, orgId, resolveManagedOrgIds);
    const catalogVoice = await fetchOrgTtsByIdFromPlatform(
      session.accessToken,
      orgId,
      ttsId,
    );
    // inactive = old voices hidden from the selection list (FishAudio / MiniMax); narration of coursewares that saved such a voice
    // must still be re-synthesizable by tts_id; only deleted is refused (the platform's by-id endpoint doesn't return deleted ones anyway).
    const voiceStatus = catalogVoice.tts_status?.trim().toLowerCase() ?? '';
    if (voiceStatus === 'deleted') {
      throw new AinobiCliError(
        'USAGE',
        `TTS voice "${ttsId}" has been deleted (status: ${catalogVoice.tts_status}).`,
      );
    }
    effectiveTeacher = applyTtsCatalogToTeacher(teacher, catalogVoice);
    voiceLanguage = catalogVoice.tts_language?.trim() || undefined;
  }
  const settings = applySpeechRate(resolveTeacherTtsSettings(effectiveTeacher), input.speech_rate);
  // Narration style: only an explicit tts_style (narration override / CLI --tts-style) overrides the synthesis prompt.
  // The teacher path's settings.style was already resolved by the backend (ai_teacher_tts_style_prompt,
  // falling back to the platform default) — don't override it by resolving the key again (legacy catalog keys or
  // custom text would be mismapped by the preset table).
  // Two-way resolution: a recommended key looks up the preset; any other non-empty value passes through as custom text (same as the backend).
  // Only Google consumes this field; the other providers' payloads don't read it.
  const styleOverride = input.tts_style?.trim();
  if (styleOverride && settings.provider === 'google') {
    const stylePrompt = resolveTtsStylePrompt(styleOverride);
    if (stylePrompt) {
      settings.style = stylePrompt;
    }
  }
  const format = input.format?.trim() || 'mp3';

  return {
    text,
    format,
    settings,
    requestedVoiceId: effectiveTeacher.ai_teacher_tts_voice ?? effectiveTeacher.ai_teacher_tts_id,
    orgId,
    coursewareId,
    aiTeacherId,
    ttsProvider: normalizeNarrationTtsProvider(settings.provider),
    pronunciationOverride: input.pronunciation_override,
    japaneseAutoKana: isJapaneseNarrationLanguage(teacher.ai_teacher_language, voiceLanguage),
  };
}

function mergePronunciationDictEntries(
  orgEntries: PronunciationDictEntry[],
  override: CoursewareTtsPronunciationOverride | undefined,
): PronunciationDictEntry[] {
  if (!override) return orgEntries;
  const sourceText = override.sourceText.trim();
  const pronunciation = override.pronunciation.trim();
  if (!sourceText || !pronunciation) return orgEntries;
  const next: PronunciationDictEntry = {
    sourceText,
    language: override.language,
    pronunciation,
    enabled: true,
  };
  const overrideKey = normalizePronunciationSourceKey(sourceText);
  return [
    next,
    ...orgEntries.filter(
      (e) => normalizePronunciationSourceKey(e.sourceText) !== overrideKey,
    ),
  ];
}

/** Synthesize + upload using a prepared TTS request. */
export async function executeCoursewareTtsSynthesize(
  prep: CoursewareTtsSynthesizePrep,
  accessToken?: string | null,
): Promise<CoursewareTtsSynthesizeResult> {
  // Every provider: the org pronunciation dict is handed to the CLI as an
  // explicit argument. Never stage it in process.env: this host serves
  // concurrent requests from different organizations and a process-global
  // value leaks between them (do NOT reintroduce the env transport).
  // Org dict first, then the platform dict (backend table, same DB) for keys the
  // org did not define; the one-off preview override still wins over both. The
  // platform dict (ja-only) is merged only when the teacher / voice language is ja.
  const pronunciationDict = shouldApplyPronunciationDict(prep.ttsProvider)
    ? mergePronunciationDictEntries(
        await loadMergedPronunciationDictEntries(prep.orgId, {
          includePlatform: prep.japaneseAutoKana,
        }),
        prep.pronunciationOverride,
      )
    : [];

  // Japanese full-text kana (teacher / voice language ja): dictionary first, then
  // kuroshiro. This runs AFTER the credits pre-charge in the HTTP handler on purpose:
  // billing uses the pre-rewrite text. Do not move it before billing.
  const kanaRewrite =
    prep.japaneseAutoKana && shouldApplyPronunciationDict(prep.ttsProvider)
      ? await rewriteJapaneseTextToKanaForTts(trimNarrationLine(prep.text), pronunciationDict)
      : undefined;

  console.info("[courseware-tts] synthesize", {
    text: prep.text,
    provider: prep.ttsProvider,
    orgId: prep.orgId,
    coursewareId: prep.coursewareId,
    hasPronunciationOverride: Boolean(prep.pronunciationOverride),
    pronunciationOverride: prep.pronunciationOverride ?? null,
    pronunciationDictEntries: pronunciationDict.length,
    japaneseAutoKana: prep.japaneseAutoKana,
    note: "ja: full-text kana when teacher/voice is ja, else dict kana (all providers); zh tone: minimax only",
  });

  const synthesized = await synthesizeAndUploadTtsLine({
    text: prep.text,
    settings: prep.settings,
    format: prep.format,
    requestedVoiceId: prep.requestedVoiceId,
    pronunciationDict,
    kanaRewrite,
  });

  // Organization storage billing (per-org ownership rule): OSS's content-addressed dedupe (existed) is decoupled from
  // billing — only a row for (org, object_key) in the refs table means that organization has paid for these bytes.
  // A first synthesis (or a retry of an object kept after a confirmed failure) always goes through lock+confirm,
  // and registers the refs row on success (coursewareId for refunds when the whole courseware is deleted).
  if (synthesized.bytes > 0) {
    const refsRepo = dataSource.getRepository(CoursewareTtsStorageRef);
    const alreadyOwned = await refsRepo.findOne({
      where: { orgId: prep.orgId, objectKey: synthesized.object_key },
    });
    if (!alreadyOwned) {
      let storageLock: Awaited<ReturnType<typeof acquireCoursewareUploadStorageLock>>;
      try {
        storageLock = await acquireCoursewareUploadStorageLock(
          accessToken ?? null,
          prep.orgId,
          synthesized.bytes,
          `tts:${prep.coursewareId}`,
        );
      } catch (quotaError) {
        const message = quotaError instanceof Error ? quotaError.message : String(quotaError);
        throw new AinobiCliError(
          "INTERNAL",
          `Organization storage quota exceeded, TTS audio not charged: ${message}`,
        );
      }
      try {
        await confirmCoursewareUploadStorageLock(
          accessToken ?? null,
          storageLock,
          synthesized.bytes,
        );
      } catch (accountingError) {
        await releaseCoursewareUploadStorageLock(accessToken ?? null, storageLock);
        const message =
          accountingError instanceof Error ? accountingError.message : String(accountingError);
        throw new AinobiCliError(
          "INTERNAL",
          `Organization storage accounting failed — please retry: ${message}`,
        );
      }
      // Charge landed — record per-org ownership (idempotent: a concurrent
      // identical request may have inserted the ref already; the loser's
      // confirmed charge is refunded). ONLY a unique-violation counts as a
      // race: any other insert failure is surfaced as retryable instead of
      // returning an unaccounted URL.
      try {
        await refsRepo.insert({
          orgId: prep.orgId,
          objectKey: synthesized.object_key,
          sizeBytes: synthesized.bytes,
          coursewareId: prep.coursewareId ?? null,
        });
      } catch (refError) {
        const driver = (refError as { driverError?: { code?: string } })
          .driverError;
        const isUniqueRace = driver?.code === "23505";
        if (!isUniqueRace) {
          // The charge landed but ownership was not persisted: refund the
          // just-confirmed bytes before failing, otherwise every client
          // retry confirms ANOTHER charge (no ref row exists to dedupe).
          await decrementCoursewareObjectStorage(
            accessToken ?? null,
            prep.orgId,
            synthesized.bytes,
            `tts-ref-failed:${synthesized.object_key}`,
          );
          throw new AinobiCliError(
            "INTERNAL",
            `TTS storage ownership write failed — please retry: ${refError instanceof Error ? refError.message : String(refError)}`,
          );
        }
        await decrementCoursewareObjectStorage(
          accessToken ?? null,
          prep.orgId,
          synthesized.bytes,
          `tts-ref-race:${synthesized.object_key}`,
        );
        console.warn(
          `[org-storage] tts ref insert raced (charge refunded): ${refError instanceof Error ? refError.message : String(refError)}`,
        );
      }
    }
  }

  return {
    tts_url: synthesized.tts_url,
    object_key: synthesized.object_key,
    format: synthesized.format,
    content_type: synthesized.content_type,
    duration_ms: synthesized.duration_ms,
    tts_provider: prep.ttsProvider,
    voice_fallback_applied: synthesized.voice_fallback_applied,
    org_id: prep.orgId,
    courseware_id: prep.coursewareId,
  };
}

export async function runCoursewareTtsSynthesize(
  session: AinobiAuthorizedSession,
  input: CoursewareTtsSynthesizeInput,
): Promise<CoursewareTtsSynthesizeResult> {
  const prep = await prepareCoursewareTtsSynthesize(session, input);
  return executeCoursewareTtsSynthesize(prep, session.accessToken ?? null);
}

/** Pre-charge TTS credits by character count before synthesis/narration. */
export async function billCoursewareTtsSynthesize(
  session: AinobiAuthorizedSession,
  args: {
    text: string;
    ttsProvider: NarrationTtsProvider;
    coursewareOrgId?: string;
    conversationId?: string;
    aiTeacherId: string;
    courseId?: string;
  },
): Promise<NarrationTtsBillingOutcome | null> {
  const characterCount = countTtsTextCharacters(args.text);
  const billingArgs = {
    session,
    characterCount,
    coursewareOrgId: args.coursewareOrgId,
    conversationId: args.conversationId,
    aiTeacherId: args.aiTeacherId,
  };
  void args.courseId;
  return billNarrationTtsCredits(args.ttsProvider, billingArgs);
}

export function mapTtsSynthesizeErrorStatus(error: unknown): number {
  // Org-storage rejections (quota exceeded, permission, etc.) are client-side
  // business failures — never 502. AinobiOrgStorageError instances carry the
  // right status; message-matching covers wrapped/re-thrown variants.
  const storageStatus = orgStorageErrorStatus(error);
  if (storageStatus) {
    return storageStatus;
  }
  const rawMessage = error instanceof Error ? error.message : String(error);
  if (/storage quota exceeded/i.test(rawMessage)) {
    return 422;
  }
  if (error instanceof AinobiCliError) {
    if (error.code === 'USAGE' || error.code === 'INVALID_INPUT' || error.code === 'VALIDATION_ERROR') {
      return 400;
    }
    if (error.code === 'NOT_FOUND') {
      return 404;
    }
    if (error.code === 'UNSUPPORTED') {
      return 415;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/do not have access/i.test(message)) {
    return 403;
  }
  if (/not found/i.test(message)) {
    return 404;
  }
  return 502;
}
