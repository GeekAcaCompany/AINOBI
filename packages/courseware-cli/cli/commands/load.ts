// SPDX-License-Identifier: AGPL-3.0-only
import { resolve } from "node:path";
import { flagBool, flagString, type ParsedArgs } from "../args.ts";
import { normalizeTeacherList } from "../ai-teachers.ts";
import { AinobiCliError } from "../errors.ts";
import { readJsonFile, readPossiblyPipedJson } from "../input.ts";
import {
  createBoundSessionId,
  createSessionWorkDir,
  saveSessionRecord,
  stateFilePath,
} from "../state.ts";
import { collectDuplicateElementIdIssues } from "../scene-integrity.ts";
import { parseScene } from "../validate.ts";
import { printSuccess, type OutputOptions } from "../output.ts";
import { rejectAgentSceneRebootstrap, workDirCleanupInstruction } from "../runtime.ts";
import { serializeScene } from "@ainobi/courseware-core";
import { cliEnv } from "../env.ts";

const isPipedStdin = (): boolean => !process.stdin.isTTY;

const loadTeachersFromArgs = (args: ParsedArgs) => {
  const teacherFile = flagString(args, "teacher-file") ?? flagString(args, "teachers");
  return teacherFile ? normalizeTeacherList(readJsonFile(resolve(teacherFile))) : undefined;
};

export const handleLoad = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  rejectAgentSceneRebootstrap();

  const positional = args.positionals[0];
  const fileFlag = flagString(args, "file");
  const allowSkip = flagBool(args, "skip-invalid", false);

  let raw: unknown;
  let sourcePath: string | null = null;

  if (positional === "-" || flagBool(args, "stdin", false)) {
    raw = readPossiblyPipedJson("ainobi load -");
  } else if (fileFlag) {
    sourcePath = resolve(fileFlag);
    raw = readJsonFile(sourcePath);
  } else if (positional) {
    sourcePath = resolve(positional);
    raw = readJsonFile(sourcePath);
  } else if (isPipedStdin()) {
    raw = readPossiblyPipedJson("ainobi load");
  } else {
    throw new AinobiCliError(
      "USAGE",
      "Specify a path, use `-`, or pipe JSON via stdin.",
      { hint: "Examples: `ainobi load scene.json` or `cat scene.json | ainobi load -`." },
    );
  }

  const { scene, warnings } = parseScene(raw, { allowSkip });
  const duplicateIdIssues = collectDuplicateElementIdIssues(scene);
  const aiTeachers = loadTeachersFromArgs(args);
  const sessionId = createBoundSessionId();
  const workDir = createSessionWorkDir(sessionId);
  const serialized = serializeScene(scene);

  const syncedAtFromHost = cliEnv().AINOBI_COURSEWARE_SYNCED_AT?.trim();
  const session = {
    session_id: sessionId,
    source_path: sourcePath,
    loaded_at: new Date().toISOString(),
    saved_at: null,
    dirty: false,
    work_dir: workDir,
    scene: serialized,
    ...(syncedAtFromHost ? { courseware_synced_at: syncedAtFromHost } : {}),
    ...(aiTeachers ? { ai_teachers: aiTeachers } : {}),
  };

  saveSessionRecord(session);

  printSuccess(
    {
      session_id: sessionId,
      state_file: stateFilePath(sessionId),
      source_path: sourcePath,
      work_dir: workDir,
      work_dir_instruction: workDirCleanupInstruction(),
      scene: {
        scene_id: scene.scene_id,
        name: scene.name,
        slide_count: scene.slide_elements.length,
        vtuber_count: scene.vtuber_elements.length,
        has_quiz: !!scene.quiz,
      },
      warnings_count: warnings.length + duplicateIdIssues.length,
      duplicate_element_id_count: duplicateIdIssues.length,
      ...(aiTeachers ? { ai_teacher_count: aiTeachers.length } : {}),
    },
    output,
    warnings.length + duplicateIdIssues.length > 0 ? [...warnings, ...duplicateIdIssues] : undefined,
  );
};
