// SPDX-License-Identifier: AGPL-3.0-only
import type { ParsedArgs } from "../args.ts";
import {
  clearSession,
  getSessionId,
  hasSession,
  readSessionRaw,
  sessionStat,
  stateFilePath,
} from "../state.ts";
import { deserializeScene } from "@ainobi/courseware-core";
import { printSuccess, type OutputOptions } from "../output.ts";

export const handleStatus = (_args: ParsedArgs, output: OutputOptions): void => {
  const sessionId = getSessionId();
  const file = stateFilePath();
  if (!hasSession()) {
    printSuccess(
      {
        session_id: sessionId,
        state_file: file,
        loaded: false,
      },
      output,
    );
    return;
  }
  const session = readSessionRaw()!;
  const scene = deserializeScene(session.scene);
  printSuccess(
    {
      session_id: sessionId,
      state_file: file,
      loaded: true,
      source_path: session.source_path,
      work_dir: session.work_dir ?? null,
      live_preview_session_id: session.live_preview_session_id ?? null,
      live_preview_stream_key: session.live_preview_stream_key ?? null,
      loaded_at: session.loaded_at,
      saved_at: session.saved_at,
      dirty: session.dirty,
      file_stat: sessionStat(),
      scene: {
        scene_id: scene.scene_id,
        name: scene.name,
        slide_count: scene.slide_elements.length,
        vtuber_count: scene.vtuber_elements.length,
        has_quiz: !!scene.quiz,
        transitions: scene.transitions,
      },
    },
    output,
  );
};

export const handleReset = (_args: ParsedArgs, output: OutputOptions): void => {
  const sessionId = getSessionId();
  const file = stateFilePath();
  const had = hasSession();
  if (had) clearSession();
  printSuccess(
    {
      session_id: sessionId,
      state_file: file,
      cleared: had,
    },
    output,
  );
};
