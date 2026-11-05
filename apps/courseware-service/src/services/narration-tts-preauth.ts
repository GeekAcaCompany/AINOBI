// SPDX-License-Identifier: AGPL-3.0-only
import { access, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  DEFAULT_TTS_PROVIDER,
  normalizeTtsProvider,
  resolveTeacherTtsProvider,
  type AITeacher,
} from '@ainobi/courseware-cli/cli/ai-teachers.ts';
import {
  findTtsVoiceById,
  type PlatformTtsVoice,
} from '@ainobi/courseware-cli/cli/tts-catalog.ts';
import {
  narrationArgvFlagValue,
  normalizeNarrationTtsProvider,
  type NarrationTtsProvider,
} from './narration-tts-credits.ts';

type SessionCatalogFile = {
  session_id?: string;
  ai_teachers?: unknown;
  tts_voices?: unknown;
};

const DEFAULT_NARRATION_TTS_PROVIDER: NarrationTtsProvider = DEFAULT_TTS_PROVIDER;

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const sanitizeSessionId = (value: string): string =>
  value.trim().replace(/[^A-Za-z0-9._-]/g, '_');

export async function resolveSessionJsonPath(args: {
  stateDir: string;
  sessionId?: string;
  shellSession?: string;
}): Promise<string | null> {
  const stateDir = resolve(args.stateDir);
  if (!(await pathExists(stateDir))) {
    return null;
  }

  const explicitId = args.sessionId?.trim();
  if (explicitId) {
    const path = join(stateDir, `${sanitizeSessionId(explicitId)}.json`);
    return (await pathExists(path)) ? path : null;
  }

  const shell = args.shellSession?.trim();
  if (shell) {
    const pointer = join(stateDir, '.current', `${sanitizeSessionId(shell)}.txt`);
    if (await pathExists(pointer)) {
      const sessionId = sanitizeSessionId(await readFile(pointer, 'utf8'));
      if (sessionId) {
        const path = join(stateDir, `${sessionId}.json`);
        if (await pathExists(path)) {
          return path;
        }
      }
    }
  }

  const currentDir = join(stateDir, '.current');
  if (await pathExists(currentDir)) {
    const currentNames = await readdir(currentDir);
    for (const name of currentNames) {
      if (!name.endsWith('.txt')) {
        continue;
      }
      const sessionId = sanitizeSessionId(await readFile(join(currentDir, name), 'utf8'));
      if (!sessionId) {
        continue;
      }
      const path = join(stateDir, `${sessionId}.json`);
      if (await pathExists(path)) {
        return path;
      }
    }
  }

  let newest: { path: string; mtime: number } | null = null;
  for (const name of await readdir(stateDir)) {
    if (!name.endsWith('.json')) {
      continue;
    }
    const path = join(stateDir, name);
    const fileStat = await stat(path);
    if (!newest || fileStat.mtimeMs > newest.mtime) {
      newest = { path, mtime: fileStat.mtimeMs };
    }
  }
  return newest?.path ?? null;
}

function asTeacherList(value: unknown): AITeacher[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: AITeacher[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const rec = row as Record<string, unknown>;
    const id = typeof rec.ai_teacher_id === 'string' ? rec.ai_teacher_id.trim() : '';
    if (!id) {
      continue;
    }
    out.push(row as AITeacher);
  }
  return out;
}

function asVoiceList(value: unknown): PlatformTtsVoice[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: PlatformTtsVoice[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const rec = row as Record<string, unknown>;
    const id = typeof rec.tts_id === 'string' ? rec.tts_id.trim() : '';
    const provider = typeof rec.tts_provider === 'string' ? rec.tts_provider.trim() : '';
    if (!id || !provider) {
      continue;
    }
    out.push(row as PlatformTtsVoice);
  }
  return out;
}

/**
 * Resolve TTS provider for narration pre-charge from session catalog + argv.
 * Falls back to the CLI default provider (Google) when catalog/teacher cannot be resolved
 * (same as post-run default).
 */
export async function resolveNarrationTtsProviderForPreauth(args: {
  stateDir: string;
  sessionId?: string;
  shellSession?: string;
  argv: string[];
}): Promise<NarrationTtsProvider> {
  const teacherId = narrationArgvFlagValue(args.argv, '--teacher-id')?.trim();
  const ttsId = narrationArgvFlagValue(args.argv, '--tts-id')?.trim();

  const sessionPath = await resolveSessionJsonPath(args);
  if (!sessionPath) {
    console.warn(
      `[credits] narration TTS provider fallback=${DEFAULT_NARRATION_TTS_PROVIDER} (session catalog not found for preauth)`,
    );
    return DEFAULT_NARRATION_TTS_PROVIDER;
  }

  let session: SessionCatalogFile;
  try {
    session = JSON.parse(await readFile(sessionPath, 'utf8')) as SessionCatalogFile;
  } catch {
    console.warn(
      `[credits] narration TTS provider fallback=${DEFAULT_NARRATION_TTS_PROVIDER} (failed to parse session for preauth)`,
    );
    return DEFAULT_NARRATION_TTS_PROVIDER;
  }

  if (ttsId) {
    const voice = findTtsVoiceById(asVoiceList(session.tts_voices), ttsId);
    if (voice) {
      return normalizeNarrationTtsProvider(voice.tts_provider);
    }
  }

  if (teacherId) {
    const teachers = asTeacherList(session.ai_teachers);
    const teacher = teachers.find(
      (row) =>
        row.ai_teacher_id === teacherId ||
        row.ai_teacher_tts_id === teacherId,
    );
    if (teacher) {
      // Same inference as synthesis (resolveTeacherTtsSettings): provider-less legacy
      // records with a native voice id stay on MiniMax, so billing matches the run.
      return resolveTeacherTtsProvider({
        ...teacher,
        ai_teacher_tts_provider: normalizeTtsProvider(teacher.ai_teacher_tts_provider),
      });
    } else {
      console.warn(
        `[credits] narration TTS provider fallback=${DEFAULT_NARRATION_TTS_PROVIDER} (teacher ${teacherId} not in session catalog)`,
      );
      return DEFAULT_NARRATION_TTS_PROVIDER;
    }
  } else {
    console.warn(
      `[credits] narration TTS provider fallback=${DEFAULT_NARRATION_TTS_PROVIDER} (missing --teacher-id for preauth)`,
    );
    return DEFAULT_NARRATION_TTS_PROVIDER;
  }

  return DEFAULT_NARRATION_TTS_PROVIDER;
}

/**
 * Teacher / catalog-voice languages for a narration job, resolved from the CLI session
 * catalog + argv exactly like the provider pre-auth (`--teacher-id`, `--tts-id`).
 * Missing catalog or unknown ids simply leave the field unset.
 */
export async function resolveNarrationTtsLanguagesForPreauth(args: {
  stateDir: string;
  sessionId?: string;
  shellSession?: string;
  argv: string[];
}): Promise<{ teacherLanguage?: string; voiceLanguage?: string }> {
  const teacherId = narrationArgvFlagValue(args.argv, '--teacher-id')?.trim();
  const ttsId = narrationArgvFlagValue(args.argv, '--tts-id')?.trim();
  const sessionPath = await resolveSessionJsonPath(args);
  if (!sessionPath) {
    return {};
  }
  let session: SessionCatalogFile;
  try {
    session = JSON.parse(await readFile(sessionPath, 'utf8')) as SessionCatalogFile;
  } catch {
    return {};
  }

  const out: { teacherLanguage?: string; voiceLanguage?: string } = {};
  if (teacherId) {
    const teacher = asTeacherList(session.ai_teachers).find(
      (row) => row.ai_teacher_id === teacherId || row.ai_teacher_tts_id === teacherId,
    );
    const language = teacher?.ai_teacher_language?.trim();
    if (language) {
      out.teacherLanguage = language;
    }
  }
  if (ttsId) {
    const voice = findTtsVoiceById(asVoiceList(session.tts_voices), ttsId);
    const language = voice?.tts_language?.trim();
    if (language) {
      out.voiceLanguage = language;
    }
  }
  return out;
}

/**
 * Persist AI teacher / TTS voice catalogs into the loaded CLI session JSON
 * (same shape as `ainobi ai-teachers list --save` / `ainobi tts list --save`).
 * Required so MCP preauth and `narration insert --tts-id` resolve against the catalog.
 */
export async function patchSessionNarrationCatalogs(args: {
  stateDir: string;
  sessionId?: string;
  shellSession?: string;
  aiTeachers?: unknown;
  ttsVoices?: unknown;
}): Promise<boolean> {
  if (args.aiTeachers === undefined && args.ttsVoices === undefined) {
    return false;
  }
  const sessionPath = await resolveSessionJsonPath(args);
  if (!sessionPath) {
    return false;
  }
  let session: Record<string, unknown>;
  try {
    session = JSON.parse(await readFile(sessionPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return false;
  }
  if (!session || typeof session !== 'object') {
    return false;
  }
  if (args.aiTeachers !== undefined) {
    session.ai_teachers = args.aiTeachers;
  }
  if (args.ttsVoices !== undefined) {
    session.tts_voices = args.ttsVoices;
  }
  await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
  return true;
}
