// SPDX-License-Identifier: AGPL-3.0-only
import { flagBool, flagNumber, flagString, type ParsedArgs } from "../args.ts";
import { AinobiCliError } from "../errors.ts";
import { printSuccess, type OutputOptions } from "../output.ts";
import { readSessionRaw, requireSession, saveSessionRecord } from "../state.ts";
import { fetchTtsListViaHost, isTtsHostFlush } from "../tts-host-job.ts";
import { cliEnv } from "../env.ts";

const resolveOrgId = (args: ParsedArgs): string | undefined => {
  const explicit = flagString(args, "org-id") ?? flagString(args, "org_id");
  if (explicit?.trim()) {
    return explicit.trim();
  }
  const fromEnv = cliEnv().AINOBI_COURSEWARE_ORG_ID?.trim();
  return fromEnv || undefined;
};

export const handleTtsList = async (
  args: ParsedArgs,
  output: OutputOptions,
): Promise<void> => {
  if (!isTtsHostFlush()) {
    throw new AinobiCliError(
      "USAGE",
      "Listing TTS voices requires the AINOBI agent host.",
      {
        hint:
          "Run `ainobi tts list` inside agent chat. Outside the agent, use the platform TTS admin API.",
      },
    );
  }

  const pageSize = flagNumber(args, "page-size");
  const result = await fetchTtsListViaHost({
    orgId: resolveOrgId(args),
    provider: flagString(args, "provider") ?? undefined,
    language: flagString(args, "language") ?? undefined,
    pageSize: pageSize !== undefined ? Math.floor(pageSize) : undefined,
  });

  const save = flagBool(args, "save", false);
  if (save) {
    const session = readSessionRaw();
    if (!session) {
      throw new AinobiCliError("NOT_LOADED", "No courseware session is loaded.", {
        hint: "Run `ainobi load` or `ainobi init` before `ainobi tts list --save`.",
      });
    }
    saveSessionRecord({
      ...session,
      tts_voices: [...result.voices],
    });
  }

  printSuccess(
    {
      source: result.source,
      org_id: result.org_id,
      count: result.count,
      total_count: result.total_count,
      saved_to_session: save,
      empty_catalog: result.voices.length === 0,
      voices: result.voices.map((voice) => ({
        tts_id: voice.tts_id,
        tts_name: voice.tts_name,
        tts_provider: voice.tts_provider,
        tts_model: voice.tts_model,
        tts_voice: voice.tts_voice,
        ...(voice.tts_language ? { tts_language: voice.tts_language } : {}),
      })),
    },
    output,
  );
};

export const handleTtsSync = async (
  args: ParsedArgs,
  output: OutputOptions,
): Promise<void> => {
  requireSession();
  args.flags.save = true;
  await handleTtsList(args, output);
};
