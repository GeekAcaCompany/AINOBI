// SPDX-License-Identifier: AGPL-3.0-only
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ainobiCliEntry } from "../runtime-paths.ts";

export type AinobiLoadResult =
  | { ok: true; stdout: string }
  | { ok: false; stdout: string; stderr: string; status: number | null };

/**
 * Write the scene JSON to disk and run `ainobi load` in the given cwd/env (with AINOBI_SHELL_SESSION),
 * sharing the same ainobi shell state as the later Bash tool in the Claude Agent SDK.
 */
export function writeSceneJsonAndAinobiLoad(params: {
  scenePath: string;
  content: Record<string, unknown>;
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** DB `courseware.updated_at` ISO string — stored on the CLI session as sync baseline. */
  coursewareUpdatedAt?: string | null;
}): AinobiLoadResult {
  mkdirSync(dirname(params.scenePath), { recursive: true });
  writeFileSync(params.scenePath, `${JSON.stringify(params.content)}\n`, "utf8");

  const env = { ...params.env };
  const syncedAt = params.coursewareUpdatedAt?.trim();
  if (syncedAt) {
    env.AINOBI_COURSEWARE_SYNCED_AT = syncedAt;
  }

  const proc = spawnSync(process.execPath, [ainobiCliEntry, "load", params.scenePath], {
    cwd: params.cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout = proc.stdout ?? "";
  const stderr = proc.stderr ?? "";
  if (proc.error) {
    return { ok: false, stdout, stderr: `${stderr}\n${proc.error.message}`.trim(), status: null };
  }
  if (proc.status !== 0) {
    return { ok: false, stdout, stderr, status: proc.status };
  }
  return { ok: true, stdout };
}

/**
 * Only write the scene JSON into the agent workspace (without triggering `ainobi load`).
 */
export function writeSceneJsonToAgentWorkspace(params: {
  scenePath: string;
  content: Record<string, unknown>;
  /** Large files such as reference coursewares are best pretty-printed, for the agent's Read/Grep. */
  pretty?: boolean;
}): void {
  mkdirSync(dirname(params.scenePath), { recursive: true });
  const json = params.pretty
    ? `${JSON.stringify(params.content, null, 2)}\n`
    : `${JSON.stringify(params.content)}\n`;
  writeFileSync(params.scenePath, json, "utf8");
}
