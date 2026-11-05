// SPDX-License-Identifier: AGPL-3.0-only
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { flagBool, flagString, type ParsedArgs } from "../args.ts";
import { saveCoursewareViaPersistence } from "../courseware-persistence-save.ts";
import { AinobiCliError } from "../errors.ts";
import { assertNoOrphanQuizQuestions, assertSceneElementIdsUnique } from "../scene-integrity.ts";
import {
  cleanupSessionWorkDir,
  requireScene,
  saveSessionRecord,
  getSessionId,
  type SessionRecord,
} from "../state.ts";
import { serializeScene } from "@ainobi/courseware-core";
import { prepareSceneAssetUrlsForCliPersistence } from "../asset-url-persistence.ts";
import { printSuccess, type OutputOptions } from "../output.ts";
import { isAgentCliRuntime, isPersistenceHostFlush } from "../runtime.ts";
import { cliEnv } from "../env.ts";

const slugifySceneName = (name: string): string => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "courseware";
};

const resolveDefaultSaveTarget = (sceneName: string): string | null => {
  const outputDir = cliEnv().AINOBI_OUTPUT_DIR?.trim();
  if (!outputDir) return null;
  const dir = resolve(outputDir);
  mkdirSync(dir, { recursive: true });
  return resolve(dir, `${slugifySceneName(sceneName)}.scene.json`);
};

const finalizeSaveSession = (
  session: SessionRecord,
  serialized: ReturnType<typeof serializeScene>,
  patch?: Partial<SessionRecord>,
): ReturnType<typeof cleanupSessionWorkDir> => {
  const cleanup = cleanupSessionWorkDir(session);
  saveSessionRecord({
    ...session,
    ...patch,
    saved_at: new Date().toISOString(),
    dirty: false,
    work_dir: cleanup.cleaned ? null : session.work_dir,
    scene: serialized,
  });
  return cleanup;
};

export const handleSave = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  const { session, scene } = requireScene();
  assertSceneElementIdsUnique(scene);
  assertNoOrphanQuizQuestions(scene);
  const stdout = flagBool(args, "stdout", false) || args.positionals[0] === "-";

  const serialized = serializeScene(prepareSceneAssetUrlsForCliPersistence(scene));
  const pretty = flagBool(args, "pretty", true);
  const json = pretty ? JSON.stringify(serialized, null, 2) : JSON.stringify(serialized);

  if (stdout) {
    process.stdout.write(`${json}\n`);
    finalizeSaveSession(session, serialized);
    return;
  }

  if (isAgentCliRuntime()) {
    const cleanup = finalizeSaveSession(session, serialized);
    if (isPersistenceHostFlush()) {
      const coursewareKey = cliEnv().AINOBI_COURSEWARE_KEY?.trim();
      if (!coursewareKey) {
        throw new AinobiCliError(
          "USAGE",
          "Agent save requires `AINOBI_COURSEWARE_KEY` (set by the AINOBI host for this chat).",
          {
            hint:
              "Bind the chat to a courseware record before saving, or use `ainobi save --stdout` for a local JSON dump only.",
          },
        );
      }
      printSuccess(
        {
          session_id: getSessionId(),
          saved_via: "host_flush",
          courseware_key: coursewareKey,
          courseware_title: scene.name,
          slide_count: scene.slide_elements.length,
          work_dir: cleanup.work_dir,
          work_dir_cleaned: cleanup.cleaned,
        },
        output,
        cleanup.warning ? [cleanup.warning] : undefined,
      );
      return;
    }
    const persisted = await saveCoursewareViaPersistence(serialized as Record<string, unknown>, {
      title: scene.name,
    });
    printSuccess(
      {
        session_id: getSessionId(),
        saved_via: "persistence",
        courseware_key: persisted.key,
        courseware_title: persisted.title,
        updated_at: persisted.updatedAt,
        version_count: persisted.versionCount,
        slide_count: scene.slide_elements.length,
        work_dir: cleanup.work_dir,
        work_dir_cleaned: cleanup.cleaned,
      },
      output,
      cleanup.warning ? [cleanup.warning] : undefined,
    );
    return;
  }

  const target =
    args.positionals[0] ??
    flagString(args, "to") ??
    session.source_path ??
    resolveDefaultSaveTarget(scene.name);

  if (!target) {
    throw new AinobiCliError(
      "USAGE",
      "No save target specified.",
      {
        hint:
          "Provide a path: `ainobi save scene.json`, use `--stdout`, load from a file so the original path is reused, or set `AINOBI_OUTPUT_DIR` for a default output folder.",
      },
    );
  }

  const resolved = resolve(target);
  try {
    writeFileSync(resolved, `${json}\n`, "utf-8");
  } catch (error) {
    throw new AinobiCliError(
      "IO_ERROR",
      `Failed to write to ${resolved}: ${(error as Error).message}`,
    );
  }

  const cleanup = finalizeSaveSession(session, serialized, { source_path: resolved });

  printSuccess(
    {
      session_id: getSessionId(),
      saved_to: resolved,
      bytes: Buffer.byteLength(json, "utf-8"),
      slide_count: scene.slide_elements.length,
      work_dir: cleanup.work_dir,
      work_dir_cleaned: cleanup.cleaned,
    },
    output,
    cleanup.warning ? [cleanup.warning] : undefined,
  );
};
