// SPDX-License-Identifier: AGPL-3.0-only
import { flagBool, flagNumber, flagString, type ParsedArgs } from "../args.ts";
import { DEFAULT_AI_TEACHERS, type AITeacher } from "../ai-teachers.ts";
import { fetchAiTeachersViaHost } from "../ai-teachers-host-job.ts";
import { AinobiCliError } from "../errors.ts";
import { printSuccess, type OutputOptions } from "../output.ts";
import { isAiTeachersHostFlush } from "../runtime.ts";
import {
  readSessionRaw,
  requireSession,
  saveSessionRecord,
} from "../state.ts";
import { cliEnv } from "../env.ts";

const resolveOrgId = (args: ParsedArgs): string | undefined => {
  const explicit = flagString(args, "org-id") ?? flagString(args, "org_id");
  if (explicit?.trim()) {
    return explicit.trim();
  }
  const fromEnv = cliEnv().AINOBI_COURSEWARE_ORG_ID?.trim();
  return fromEnv || undefined;
};

const fetchTeachers = async (args: ParsedArgs): Promise<{
  source: "platform" | "builtin";
  org_id: string | null;
  teachers: AITeacher[];
  count: number;
  total_count: number;
}> => {
  if (isAiTeachersHostFlush()) {
    const pageSize = flagNumber(args, "page-size");
    return fetchAiTeachersViaHost({
      orgId: resolveOrgId(args),
      pageSize: pageSize !== undefined ? Math.floor(pageSize) : undefined,
    });
  }

  const orgId = resolveOrgId(args);
  if (orgId) {
    throw new AinobiCliError(
      "USAGE",
      "Listing organization AI teachers requires the AINOBI agent host.",
      {
        hint:
          "Run `ainobi ai-teachers list` inside agent chat, or pass `--teacher-file` / use session teachers from a prior agent sync.",
      },
    );
  }

  const teachers = [...DEFAULT_AI_TEACHERS];
  return {
    source: "builtin",
    org_id: null,
    teachers,
    count: teachers.length,
    total_count: teachers.length,
  };
};

const EMPTY_CATALOG_GUIDANCE =
  "The organization has no AI teachers configured, so narration insert cannot run. " +
  "Tell the user (in their language) that the platform admin must add at least one AI teacher under " +
  "“教师管理 > AI 教师” (Teacher Management > AI Teachers) on the AINOBI platform — the agent cannot create teachers from here. " +
  "Once an active teacher exists, rerun `ainobi ai-teachers list --save` and then `narration insert`.";

export const handleAiTeachersList = async (
  args: ParsedArgs,
  output: OutputOptions,
): Promise<void> => {
  const result = await fetchTeachers(args);
  const save = flagBool(args, "save", false);
  const emptyCatalog = result.teachers.length === 0;

  if (save) {
    const session = readSessionRaw();
    if (!session) {
      throw new AinobiCliError("NOT_LOADED", "No courseware session is loaded.", {
        hint: "Run `ainobi load` or `ainobi init` before `ainobi ai-teachers list --save`.",
      });
    }
    saveSessionRecord({
      ...session,
      ai_teachers: [...result.teachers],
    });
  }

  const warnings = emptyCatalog
    ? [
        {
          path: "ai_teachers",
          message: EMPTY_CATALOG_GUIDANCE,
        },
      ]
    : undefined;

  if (emptyCatalog) {
    process.stderr.write(
      `[ainobi] WARN: ${EMPTY_CATALOG_GUIDANCE}\n`,
    );
  }

  printSuccess(
    {
      source: result.source,
      org_id: result.org_id,
      count: result.count,
      total_count: result.total_count,
      saved_to_session: save,
      empty_catalog: emptyCatalog,
      ...(emptyCatalog
        ? {
            action_required: {
              reason: "no_active_ai_teacher_for_org",
              message: EMPTY_CATALOG_GUIDANCE,
              admin_path: "教师管理 > AI 教师 (Teacher Management > AI Teachers)",
              next_steps: [
                "Stop the narration workflow and inform the user in their language.",
                "Ask the user (or the organization admin) to add an AI teacher on the AINOBI platform.",
                "After the admin adds a teacher, rerun `ainobi ai-teachers list --save` and then `narration insert`.",
              ],
            },
          }
        : {}),
      teachers: result.teachers.map((teacher) => ({
        ai_teacher_id: teacher.ai_teacher_id,
        ai_teacher_name: teacher.ai_teacher_name,
        ai_teacher_live2d_model_url: teacher.ai_teacher_live2d_model_url,
        ...(teacher.ai_teacher_tts_id ? { ai_teacher_tts_id: teacher.ai_teacher_tts_id } : {}),
        ...(teacher.ai_teacher_tts_provider
          ? { ai_teacher_tts_provider: teacher.ai_teacher_tts_provider }
          : {}),
        ...(teacher.ai_teacher_tts_voice
          ? { ai_teacher_tts_voice: teacher.ai_teacher_tts_voice }
          : {}),
        ...(teacher.ai_teacher_tts_model
          ? { ai_teacher_tts_model: teacher.ai_teacher_tts_model }
          : {}),
        ...(teacher.ai_teacher_language ? { ai_teacher_language: teacher.ai_teacher_language } : {}),
      })),
    },
    output,
    warnings,
  );
};

export const handleAiTeachersSync = async (
  args: ParsedArgs,
  output: OutputOptions,
): Promise<void> => {
  requireSession();
  args.flags.save = true;
  await handleAiTeachersList(args, output);
};
