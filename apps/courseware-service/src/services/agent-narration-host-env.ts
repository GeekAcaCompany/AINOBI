// SPDX-License-Identifier: AGPL-3.0-only
import type { HostNarrationRunPayload } from './agent-narration-host-run.ts';
import {
  AINOBI_TTS_JA_KANA_LINES_FILE_ENV,
  AINOBI_TTS_PRONUNCIATION_DICT_FILE_ENV,
} from '@ainobi/courseware-cli/cli/tts-pronunciation-apply.ts';

type NarrationHostJobEnv = Omit<
  HostNarrationRunPayload,
  'pronunciation_dict_json' | 'ja_kana_lines_json'
> & {
  job_id?: string;
  /**
   * Path of the temp file holding the merged pronunciation dict JSON (written and
   * removed by runHostNarration). `null` clears the key; `undefined` leaves it unset.
   */
  pronunciation_dict_file?: string | null;
  /** Path of the temp file holding the host-computed `{ [line]: kana }` map (same lifecycle). */
  ja_kana_lines_file?: string | null;
};

const HOST_NARRATION_KEYS = new Set([
  'PATH',
  'HOME',
  'TMPDIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'AINOBI_TTS_STUB',
  'AINOBI_TTS_MAX_RETRIES',
  'AINOBI_TTS_RETRY_DELAY_MS',
  // AINOBI_TTS_PRONUNCIATION_DICT_FILE / AINOBI_TTS_JA_KANA_LINES_FILE are
  // deliberately NOT forwarded from the host env: both paths reach the child only
  // via the job (temp files written per run by runHostNarration), otherwise a stale
  // host value would leak another org's readings.
  'AINOBI_COURSEWARE_ORG_ID',
]);

const isNarrationHostEnvKey = (key: string): boolean => {
  if (key.startsWith('DB_') || key.startsWith('REDIS_')) {
    return false;
  }
  if (HOST_NARRATION_KEYS.has(key)) {
    return true;
  }
  return (
    key.startsWith('OSS_') ||
    key.startsWith('GEMINI_TTS_') ||
    // Google TTS on Vertex AI's Interactions API (resolveGoogleTtsTarget): the service account, project, and
    // relay; host-side child only.
    key === 'GOOGLE_APPLICATION_CREDENTIALS' ||
    key === 'GOOGLE_APPLICATION_CREDENTIALS_JSON' ||
    key === 'GOOGLE_CLOUD_PROJECT' ||
    key === 'VERTEXAI_PROJECT_ID' ||
    key === 'VERTEXAI_BASE_URL' ||
    key.startsWith('MINIMAX_') ||
    key.startsWith('FISH_AUDIO_') ||
    key.startsWith('ALIYUN_') ||
    // The storage backend choice must match the main process: when missing the subprocess defaults to aliyun_oss, so TTS output
    // lands on aliyun while the main process derives/normalizes scene URLs for oci_s3 — bytes and references split apart,
    // and playback 404s (the root cause of the 2026-09-05 narration regeneration incident).
    key === 'STORAGE_BACKEND' ||
    key.startsWith('OCI_S3_')
  );
};

/** TTS + OSS credentials for host-side `ainobi narration` spawns (not forwarded to the agent). */
export function pickNarrationHostSubprocessEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && isNarrationHostEnvKey(key)) {
      env[key] = value;
    }
  }
  return env;
}

/**
 * Build child-only env for host narration.
 * The pronunciation dict and the kana line map come ONLY from the job's temp-file paths;
 * the child never inherits a host process.env value, so concurrent requests and MCP
 * paths cannot leak another organization's entries.
 */
export function buildHostNarrationEnv(job: NarrationHostJobEnv): NodeJS.ProcessEnv {
  const env = pickNarrationHostSubprocessEnv(process.env);
  env.AINOBI_STATE_DIR = job.state_dir;
  if (job.shell_session) {
    env.AINOBI_SHELL_SESSION = job.shell_session;
  }
  if (job.session_id) {
    env.AINOBI_SESSION = job.session_id;
  }
  env.AINOBI_CLI_RUNTIME = 'agent';
  delete env.AINOBI_NARRATION_HOST_FLUSH;

  if (job.pronunciation_dict_file !== undefined) {
    const file = job.pronunciation_dict_file?.trim();
    if (file) {
      env[AINOBI_TTS_PRONUNCIATION_DICT_FILE_ENV] = file;
    } else {
      delete env[AINOBI_TTS_PRONUNCIATION_DICT_FILE_ENV];
    }
  }
  // Same contract for the Japanese kana line map file path: job field only, never the host env.
  if (job.ja_kana_lines_file !== undefined) {
    const file = job.ja_kana_lines_file?.trim();
    if (file) {
      env[AINOBI_TTS_JA_KANA_LINES_FILE_ENV] = file;
    } else {
      delete env[AINOBI_TTS_JA_KANA_LINES_FILE_ENV];
    }
  }

  return env;
}
