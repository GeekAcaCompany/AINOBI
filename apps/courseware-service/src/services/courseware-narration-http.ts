// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from 'node:http';

import { getAuthorizedSession } from '../api-auth.ts';
import { sendJsonWithCors } from '../http/cors.ts';
import { readJsonBody } from '../http/request.ts';
import { runHostNarration, type HostNarrationRunPayload } from './agent-narration-host-run.ts';
import { billNarrationTtsCredits } from './narration-tts-billing.ts';
import {
  findBlockedNarrationCatalogFileFlag,
  logNarrationTtsPreauthChargedButWorkFailed,
  resolveNarrationTtsBillingFailureResponse,
  type NarrationTtsBillingOutcome,
} from './narration-tts-credits.ts';
import { resolveNarrationTtsProviderForPreauth } from './narration-tts-preauth.ts';
import { resolveNarrationPronunciationDictJson } from './narration-pronunciation-dict-env.ts';
import {
  resolveNarrationJaKanaLinesJsonForJob,
  resolveNarrationLanguagesForJob,
} from './tts-japanese-auto-kana.ts';

type NarrationRunBody = {
  workspace_dir?: string;
  state_dir?: string;
  argv?: string[];
  pretty?: boolean;
  shell_session?: string;
  session_id?: string;
  /** Courseware org for organization credits billing (from agent env). */
  courseware_org_id?: string;
  conversation_id?: string;
};

function parseNarrationRunBody(raw: NarrationRunBody): HostNarrationRunPayload | null {
  const workspace_dir = raw.workspace_dir?.trim();
  const state_dir = raw.state_dir?.trim();
  const argv = raw.argv?.filter((arg) => typeof arg === 'string' && arg.length > 0);
  if (!workspace_dir || !state_dir || !argv?.length) {
    return null;
  }
  return {
    workspace_dir,
    state_dir,
    argv,
    pretty: raw.pretty !== false,
    shell_session: raw.shell_session?.trim() || undefined,
    session_id: raw.session_id?.trim() || undefined,
  };
}

function creditsTtsPayload(
  billing: Extract<NarrationTtsBillingOutcome, { kind: 'charged' }>,
): Record<string, unknown> {
  return {
    creditsTts: {
      provider: billing.provider,
      serviceCode: billing.result.serviceCode,
      characters: billing.characterCount,
      creditsConsumed: billing.result.creditsConsumed,
      remainingCredits: billing.result.remainingCredits,
    },
  };
}

/**
 * POST `/courseware/narration/run` — agent sandbox delegates TTS/OSS to the host (sync HTTP).
 * Pre-charges credits by argv character count before running host narration.
 * Body: `{ workspace_dir, state_dir, argv, pretty?, shell_session?, session_id? }`.
 */
export async function handleCoursewareNarrationRun(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!getAuthorizedSession(req)) {
    sendJsonWithCors(res, 401, { ok: false, error: 'Unauthorized' });
    return;
  }

  let raw: NarrationRunBody;
  try {
    raw = await readJsonBody<NarrationRunBody>(req);
  } catch (error) {
    sendJsonWithCors(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const payload = parseNarrationRunBody(raw);
  if (!payload) {
    sendJsonWithCors(res, 400, {
      ok: false,
      error: 'Invalid body: workspace_dir, state_dir, and non-empty argv are required.',
    });
    return;
  }

  // Same rule as the MCP path: catalogs come from the session (`ai-teachers list --save`
  // / `tts list --save`), never from a client-supplied file — the host language resolver
  // only sees the session catalog. Answer with the run-payload shape carrying a CLI
  // envelope so the sandbox CLI surfaces a proper USAGE error (see runHostNarration).
  const blockedCatalogFileFlag = findBlockedNarrationCatalogFileFlag(payload.argv);
  if (blockedCatalogFileFlag) {
    sendJsonWithCors(res, 400, {
      ok: false,
      exit_code: 2,
      stdout: '',
      stderr: JSON.stringify({
        ok: false,
        error: {
          code: 'USAGE',
          message: `${blockedCatalogFileFlag} is not allowed on host narration; the AI teacher / TTS voice must come from the session catalog.`,
          hint: 'Drop the flag and run `ainobi ai-teachers list --save` (or `ainobi tts list --save`) before `narration insert`.',
        },
      }),
    });
    return;
  }

  const session = getAuthorizedSession(req);
  const orgId = raw.courseware_org_id?.trim() || undefined;
  const conversationId = raw.conversation_id?.trim() || undefined;

  try {
    let creditsBilling: Record<string, unknown> | undefined;
    let charged: Extract<NarrationTtsBillingOutcome, { kind: 'charged' }> | undefined;

    if (session) {
      const insertIdx = payload.argv.indexOf('insert');
      const slideRef =
        insertIdx >= 0
          ? payload.argv.slice(insertIdx + 1).find((arg) => !arg.startsWith('-'))
          : undefined;
      const ttsProvider = await resolveNarrationTtsProviderForPreauth({
        stateDir: payload.state_dir,
        sessionId: payload.session_id,
        shellSession: payload.shell_session,
        argv: payload.argv,
      });
      const billingArgs = {
        session,
        argv: payload.argv,
        coursewareOrgId: orgId,
        conversationId,
        slideRef,
      };
      // Pre-charge on the ORIGINAL transcript. The Japanese kana rewrite (dictionary +
      // full-text auto kana) is computed below and applied in the child process; it must
      // stay after this call: billing uses the pre-rewrite text by design. Do not reorder.
      const billing =
        await billNarrationTtsCredits(ttsProvider, billingArgs);
      if (billing?.kind === 'failed') {
        const failure = resolveNarrationTtsBillingFailureResponse(billing);
        sendJsonWithCors(res, failure.status, failure.body);
        return;
      }
      if (billing?.kind === 'charged') {
        charged = billing;
        creditsBilling = creditsTtsPayload(billing);
      }

      // Teacher / voice languages first: they decide whether the platform (ja) dict is
      // merged and whether the kana line map is built. Keep this before the dict.
      const languages = await resolveNarrationLanguagesForJob({
        stateDir: payload.state_dir,
        sessionId: payload.session_id,
        shellSession: payload.shell_session,
        argv: payload.argv,
      });

      // MiniMax / FishAudio: the pronunciation dictionary is injected into the subprocess env (the global process.env isn't rewritten)
      const pronunciationDictJson = await resolveNarrationPronunciationDictJson({
        orgId,
        ttsProvider,
        includePlatform: languages.japanese,
      });
      if (pronunciationDictJson !== undefined) {
        payload.pronunciation_dict_json = pronunciationDictJson;
      }

      // Japanese full-text kana (teacher / voice language ja): the host computes the
      // per-line rewrites, the child only looks them up (job field only, like the dict).
      const jaKanaLinesJson = await resolveNarrationJaKanaLinesJsonForJob({
        argv: payload.argv,
        ttsProvider,
        languages,
        pronunciationDictJson,
      });
      if (jaKanaLinesJson !== undefined) {
        payload.ja_kana_lines_json = jaKanaLinesJson;
      }
    }

    let result;
    try {
      result = await runHostNarration(payload);
    } catch (error) {
      if (charged) {
        logNarrationTtsPreauthChargedButWorkFailed({
          phase: 'narration',
          provider: charged.provider,
          characterCount: charged.characterCount,
          ledgerId: charged.result.ledgerId,
          error,
        });
      }
      throw error;
    }

    if (!result.ok && charged) {
      logNarrationTtsPreauthChargedButWorkFailed({
        phase: 'narration',
        provider: charged.provider,
        characterCount: charged.characterCount,
        ledgerId: charged.result.ledgerId,
        error: result.stderr.trim() || `host narration exit ${result.exit_code}`,
      });
    }

    const status = result.ok ? 200 : 502;
    sendJsonWithCors(res, status, { ok: result.ok, ...result, ...creditsBilling });
  } catch (error) {
    sendJsonWithCors(res, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
