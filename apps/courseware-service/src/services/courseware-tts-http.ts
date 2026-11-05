// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from 'node:http';

import { getAuthorizedSession } from '../api-auth.ts';
import { ensureDataSource } from '../db/ensure-data-source.ts';
import { sendJsonWithCors } from '../http/cors.ts';
import { readJsonBody } from '../http/request.ts';
import {
  billCoursewareTtsSynthesize,
  executeCoursewareTtsSynthesize,
  mapTtsSynthesizeErrorStatus,
  prepareCoursewareTtsSynthesize,
  type CoursewareTtsSynthesizeInput,
} from './courseware-tts-service.ts';
import {
  logNarrationTtsPreauthChargedButWorkFailed,
  resolveNarrationTtsBillingFailureResponse,
  type NarrationTtsBillingOutcome,
} from './narration-tts-credits.ts';

type TtsSynthesizeBody = {
  text?: string;
  format?: string;
  ai_teacher_id?: string;
  tts_id?: string;
  tts_style?: string;
  speech_rate?: number;
  courseware_id?: string;
  courseware_org_id?: string;
  conversation_id?: string;
  course_id?: string;
  pronunciation_override?: {
    source_text?: string;
    language?: string;
    pronunciation?: string;
  };
};

function parsePronunciationOverride(
  raw: TtsSynthesizeBody['pronunciation_override'],
): CoursewareTtsSynthesizeInput['pronunciation_override'] | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const sourceText = raw.source_text?.trim() ?? '';
  const pronunciation = raw.pronunciation?.trim() ?? '';
  const language = raw.language?.trim().toLowerCase();
  if (!sourceText || !pronunciation) return undefined;
  if (language !== 'zh' && language !== 'ja') return undefined;
  return { sourceText, language, pronunciation };
}

function parseTtsSynthesizeBody(raw: TtsSynthesizeBody): CoursewareTtsSynthesizeInput | null {
  const text = raw.text?.trim();
  const aiTeacherId = raw.ai_teacher_id?.trim();
  if (!text || !aiTeacherId) {
    return null;
  }
  const speechRate =
    typeof raw.speech_rate === 'number' && Number.isFinite(raw.speech_rate)
      ? raw.speech_rate
      : undefined;
  return {
    text,
    format: raw.format?.trim() || 'mp3',
    ai_teacher_id: aiTeacherId,
    tts_id: raw.tts_id?.trim() || undefined,
    tts_style:
      typeof raw.tts_style === "string" && raw.tts_style.trim()
        ? raw.tts_style.trim()
        : undefined,
    speech_rate: speechRate,
    courseware_id: raw.courseware_id?.trim() || undefined,
    courseware_org_id: raw.courseware_org_id?.trim() || undefined,
    conversation_id: raw.conversation_id?.trim() || undefined,
    course_id: raw.course_id?.trim() || undefined,
    pronunciation_override: parsePronunciationOverride(raw.pronunciation_override),
  };
}

/**
 * POST `/courseware/tts/synthesize` — prepare voice, pre-charge credits, then synthesize + upload.
 */
export async function handleCoursewareTtsSynthesize(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const session = getAuthorizedSession(req);
  if (!session) {
    sendJsonWithCors(res, 401, { ok: false, error: 'Unauthorized' });
    return;
  }

  let raw: TtsSynthesizeBody;
  try {
    raw = await readJsonBody<TtsSynthesizeBody>(req);
  } catch (error) {
    sendJsonWithCors(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const payload = parseTtsSynthesizeBody(raw);
  if (!payload) {
    sendJsonWithCors(res, 400, {
      ok: false,
      error: 'Invalid body: non-empty text and ai_teacher_id are required.',
    });
    return;
  }

  try {
    await ensureDataSource();
    const prep = await prepareCoursewareTtsSynthesize(session, payload);

    let creditsBilling: Record<string, unknown> | undefined;
    let charged: Extract<NarrationTtsBillingOutcome, { kind: 'charged' }> | undefined;

    // Pre-charge on the ORIGINAL text. The Japanese kana rewrite (dictionary + full-text
    // auto kana) runs later inside executeCoursewareTtsSynthesize and must stay after
    // this call: billing uses the pre-rewrite text by design. Do not reorder.
    const billing = await billCoursewareTtsSynthesize(session, {
      text: prep.text,
      ttsProvider: prep.ttsProvider,
      coursewareOrgId: prep.orgId,
      conversationId: payload.conversation_id,
      aiTeacherId: prep.aiTeacherId,
      courseId: payload.course_id,
    });
    if (billing?.kind === 'failed') {
      const failure = resolveNarrationTtsBillingFailureResponse(billing);
      sendJsonWithCors(res, failure.status, failure.body);
      return;
    }
    if (billing?.kind === 'charged') {
      charged = billing;
      creditsBilling = {
        creditsTts: {
          provider: billing.provider,
          serviceCode: billing.result.serviceCode,
          characters: billing.characterCount,
          creditsConsumed: billing.result.creditsConsumed,
          remainingCredits: billing.result.remainingCredits,
        },
      };
    }

    let data;
    try {
      // Session token threads through to the org-storage lock/confirm —
      // without it the storage helper silently no-ops and TTS via this HTTP
      // endpoint would bypass quota accounting entirely.
      data = await executeCoursewareTtsSynthesize(prep, session.accessToken ?? null);
    } catch (error) {
      if (charged) {
        logNarrationTtsPreauthChargedButWorkFailed({
          phase: 'synthesize',
          provider: charged.provider,
          characterCount: charged.characterCount,
          ledgerId: charged.result.ledgerId,
          error,
        });
      }
      throw error;
    }

    sendJsonWithCors(res, 200, { ok: true, data, ...creditsBilling });
  } catch (error) {
    const status = mapTtsSynthesizeErrorStatus(error);
    sendJsonWithCors(res, status, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
