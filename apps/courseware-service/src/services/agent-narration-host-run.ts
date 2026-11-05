// SPDX-License-Identifier: AGPL-3.0-only
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { coursewareCliRoot } from '../runtime-paths.ts';
import { buildHostNarrationEnv } from './agent-narration-host-env.ts';

const ainobiBin = resolve(coursewareCliRoot, 'bin', 'ainobi.mjs');

export type HostNarrationRunPayload = {
  workspace_dir: string;
  state_dir: string;
  argv: string[];
  shell_session?: string;
  session_id?: string;
  pretty: boolean;
  /**
   * JSON string of the merged (org + platform) pronunciation dict entries for the child
   * process only. Written to a temp file for the child (path in env, removed after the
   * run), so its size is not capped by the env limit. The child never inherits a host
   * env value: `null` and `undefined` both mean "no dict" (`null` additionally clears an
   * explicitly set key).
   */
  pronunciation_dict_json?: string | null;
  /**
   * JSON `{ [line]: kana }` of host-computed Japanese kana rewrites for the TTS lines.
   * Same temp-file transport and `null` / `undefined` semantics as the dict above.
   */
  ja_kana_lines_json?: string | null;
};

export type HostNarrationRunResult = {
  ok: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
};

const narrationHostTimeoutMs = (): number =>
  Number(process.env.AINOBI_NARRATION_HOST_TIMEOUT_MS ?? 600_000) || 600_000;

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const spawnAinobiNarration = (
  argv: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ status: number | null; stdout: string; stderr: string }> =>
  new Promise((resolvePromise, reject) => {
    const maxBuffer = 32 * 1024 * 1024;
    const child = spawn(process.execPath, [ainobiBin, ...argv], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Collect Buffers and decode once at the end: calling toString per chunk would decode multi-byte characters split across chunk boundaries
    // (Chinese/Japanese) into U+FFFD, and the agent would copy the garbage back into the courseware.
    const streams = {
      stdout: { chunks: [] as Buffer[], bytes: 0 },
      stderr: { chunks: [] as Buffer[], bytes: 0 },
    };
    let killed = false;

    const append = (chunk: Buffer, target: 'stdout' | 'stderr'): void => {
      const stream = streams[target];
      stream.chunks.push(chunk);
      stream.bytes += chunk.length;
      if (stream.bytes > maxBuffer && !killed) {
        killed = true;
        child.kill('SIGTERM');
      }
    };
    const decode = (target: 'stdout' | 'stderr'): string =>
      Buffer.concat(streams[target].chunks).toString('utf-8');

    child.stdout?.on('data', (chunk) => append(chunk, 'stdout'));
    child.stderr?.on('data', (chunk) => append(chunk, 'stderr'));

    const timeout = setTimeout(() => {
      if (!killed) {
        killed = true;
        child.kill('SIGKILL');
      }
    }, narrationHostTimeoutMs());

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolvePromise({ status: code, stdout: decode('stdout'), stderr: decode('stderr') });
    });
  });

type StagedChildFile = { file: string | null | undefined; cleanup: () => Promise<void> };

/**
 * Stage host-computed JSON (merged pronunciation dict, kana line map) as a temp FILE for
 * the child; only the path goes into the env. A single env value is capped at 128 KiB on
 * Linux, so JSON passed as an env string would fail the spawn with E2BIG after credits
 * were already pre-charged. Staging failures degrade to "no file" (no dict / dictionary-
 * only rewrite) instead of failing the run.
 */
async function stageChildJsonFile(
  json: string | null | undefined,
  target: { prefix: string; name: string; label: string },
): Promise<StagedChildFile> {
  if (json === undefined) {
    return { file: undefined, cleanup: async () => {} };
  }
  const content = json?.trim();
  if (!content) {
    return { file: null, cleanup: async () => {} };
  }
  let dir: string | undefined;
  try {
    const tempDir = await mkdtemp(join(tmpdir(), target.prefix));
    dir = tempDir;
    const file = join(tempDir, target.name);
    await writeFile(file, content, 'utf8');
    return {
      file,
      cleanup: async () => {
        await rm(tempDir, { recursive: true, force: true }).catch((error) => {
          console.warn(`[narration] failed to remove ${target.label} temp dir`, {
            dir: tempDir,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      },
    };
  } catch (error) {
    console.warn(`[narration] failed to stage ${target.label} file, continuing without it`, {
      error: error instanceof Error ? error.message : String(error),
    });
    // mkdtemp may have succeeded before writeFile failed: drop the empty dir so retries
    // do not accumulate ainobi-tts-dict-* / ainobi-ja-kana-* directories.
    if (dir) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    return { file: null, cleanup: async () => {} };
  }
}

/** Run `ainobi narration …` on the host with TTS/OSS credentials (not in the agent sandbox). */
export async function runHostNarration(
  payload: HostNarrationRunPayload,
): Promise<HostNarrationRunResult> {
  const workspaceDir = resolve(payload.workspace_dir.trim());
  if (!(await pathExists(workspaceDir))) {
    return {
      ok: false,
      exit_code: 1,
      stdout: '',
      stderr: JSON.stringify({
        ok: false,
        error: {
          code: 'INTERNAL',
          message: `Narration host workspace does not exist: ${workspaceDir}`,
          hint: 'Retry after fixing workspace_dir (leading / was missing).',
        },
      }),
    };
  }

  const prettyFlag = payload.pretty ? '--pretty' : '--no-pretty';
  const args = [...payload.argv];
  if (!args.some((arg) => arg === '--pretty' || arg === '--no-pretty')) {
    args.push(prettyFlag);
  }

  // Both JSON payloads reach the child as temp-file paths only (buildHostNarrationEnv).
  const dictFile = await stageChildJsonFile(payload.pronunciation_dict_json, {
    prefix: 'ainobi-tts-dict-',
    name: 'dict.json',
    label: 'pronunciation dict',
  });
  const kanaLines = await stageChildJsonFile(payload.ja_kana_lines_json, {
    prefix: 'ainobi-ja-kana-',
    name: 'lines.json',
    label: 'kana line map',
  });

  const job = {
    job_id: 'http',
    workspace_dir: workspaceDir,
    state_dir: payload.state_dir.trim(),
    argv: args,
    shell_session: payload.shell_session?.trim() || undefined,
    session_id: payload.session_id?.trim() || undefined,
    pretty: payload.pretty,
    created_at: new Date().toISOString(),
    ...(dictFile.file !== undefined ? { pronunciation_dict_file: dictFile.file } : {}),
    ...(kanaLines.file !== undefined ? { ja_kana_lines_file: kanaLines.file } : {}),
  };

  let result: Awaited<ReturnType<typeof spawnAinobiNarration>>;
  try {
    result = await spawnAinobiNarration(args, {
      cwd: workspaceDir,
      env: buildHostNarrationEnv(job),
    });
  } finally {
    await Promise.all([dictFile.cleanup(), kanaLines.cleanup()]);
  }

  const ok = result.status === 0;
  if (ok) {
    console.info('[narration] host TTS/OSS completed', {
      workspace: workspaceDir,
    });
  } else {
    console.warn('[narration] host TTS/OSS failed', {
      workspace: workspaceDir,
      exitCode: result.status ?? 1,
      stderr: (result.stderr || result.stdout).slice(0, 800),
    });
  }

  return {
    ok,
    exit_code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}
