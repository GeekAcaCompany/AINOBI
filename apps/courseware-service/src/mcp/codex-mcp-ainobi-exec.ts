// SPDX-License-Identifier: AGPL-3.0-only
import { spawn } from 'node:child_process';

import { ainobiCliEntry } from '../runtime-paths.ts';
import { assertSafeAinobiExecArgv } from './codex-mcp-ainobi-policy.ts';
import {
  buildCodexMcpAinobiEnv,
  type CodexMcpWorkspaceSession,
} from './codex-mcp-session.ts';

const ainobiBin = ainobiCliEntry;

export type AinobiExecResult = {
  ok: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
};

const execTimeoutMs = (): number =>
  Number(process.env.AINOBI_CODEX_MCP_EXEC_TIMEOUT_MS ?? 300_000) || 300_000;

function spawnAinobi(
  argv: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
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
    }, execTimeoutMs());

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolvePromise({ status: code, stdout: decode('stdout'), stderr: decode('stderr') });
    });
  });
}

/** Run a single allowed `ainobi` argv in the MCP workspace (no shell). */
export async function runCodexMcpAinobiExec(
  session: CodexMcpWorkspaceSession,
  accessToken: string,
  argv: unknown,
): Promise<AinobiExecResult> {
  const policy = assertSafeAinobiExecArgv(argv, { scenePreloaded: true });
  if (!policy.ok) {
    return {
      ok: false,
      exit_code: 1,
      stdout: '',
      stderr: JSON.stringify({ ok: false, error: { code: 'POLICY', message: policy.reason } }),
    };
  }

  const result = await spawnAinobi(policy.argv, {
    cwd: session.workspaceDir,
    env: buildCodexMcpAinobiEnv(session, accessToken),
  });

  return {
    ok: result.status === 0,
    exit_code: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
