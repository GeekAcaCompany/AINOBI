// SPDX-License-Identifier: AGPL-3.0-only
import { flagBool, flagNumber, flagString, type ParsedArgs } from "../args.ts";
import {
  aiTeacherMetadata,
  applyTtsCatalogToTeacher,
  normalizeTeacherList,
  resolveTeacherTtsSettings,
  selectAITeacher,
} from "../ai-teachers.ts";
import { AinobiCliError } from "../errors.ts";
import type { CliIssue } from "../errors.ts";
import { assertNoReplacementCharsInFlags } from "../replacement-char-guard.ts";
import { newElementId } from "../ids.ts";
import { readJsonFile } from "../input.ts";
import { getSessionAiTeachers, getSessionTtsVoices, readSessionRaw, requireScene, saveScene, saveSessionRecord } from "../state.ts";
import { getElementScaffold } from "../templates.ts";
import { parseElement, parseScene } from "../validate.ts";
import { printSuccess, type OutputOptions } from "../output.ts";
import {
  clampSerializedChildrenToMaxEnd,
  extendSerializedChildrenEndByDelta,
} from "../narration-slide-extend.ts";
import { normalizeMultilineCliText } from "../cli-text.ts";
import { buildTranscriptLanguageMismatchWarning } from "../narration-language-detect.ts";
import {
  assertNarrationTtsLineBreakPolicy,
  resolveNarrationTranscriptStored,
  resolveNarrationTtsSource,
} from "../narration-transcript-rules.ts";
import { runNarrationInsertViaHost } from "../narration-host-job.ts";
import { isAiTeachersHostFlush, isNarrationHostFlush } from "../runtime.ts";
import { findTtsVoiceById } from "../tts-catalog.ts";
import { fetchAiTeachersViaHost } from "../ai-teachers-host-job.ts";
import { fetchTtsListViaHost, isTtsHostFlush } from "../tts-host-job.ts";
import { buildTtsSegments, splitTranscriptForTts } from "../tts.ts";
import { resolveTtsStylePrompt } from "../tts-style-presets.ts";
import {
  listSlideNarrationTimelineRefs,
  resolveNextNarrationStartAt,
  serializeElement,
  serializeScene,
  type Element,
  type SlideElement,
} from "@ainobi/courseware-core";
import { cliEnv } from "../env.ts";

const findSlideIndex = (slides: SlideElement[], ref: string | undefined): number => {
  if (ref === undefined || ref === "") {
    throw new AinobiCliError("USAGE", "Missing slide reference (id or index).");
  }
  if (/^-?\d+$/.test(ref)) {
    const idx = Number(ref);
    if (idx < 0 || idx >= slides.length) {
      throw new AinobiCliError(
        "NOT_FOUND",
        `slide index ${idx} is out of range (0..${slides.length - 1}).`,
      );
    }
    return idx;
  }
  const idx = slides.findIndex((slide) => slide.element_id === ref);
  if (idx < 0) {
    throw new AinobiCliError("NOT_FOUND", `slide not found: "${ref}".`);
  }
  return idx;
};

const loadExternalTeachers = (args: ParsedArgs) => {
  const teacherFile = flagString(args, "teacher-file") ?? flagString(args, "teachers");
  return teacherFile ? normalizeTeacherList(readJsonFile(teacherFile)) : undefined;
};

const totalTtsDurationMs = (segments: Array<{ duration_ms: number; gap_ms: number }>): number =>
  segments.reduce((sum, segment) => sum + segment.duration_ms + segment.gap_ms, 0);

export const rejectNarrationTtsOptOut = (args: ParsedArgs): void => {
  if (args.flags.tts === false) {
    throw new AinobiCliError("USAGE", "TTS cannot be disabled for narration insert.", {
      hint: "TTS synthesis is always required for narration insert; transient failures retry automatically.",
    });
  }
};

/** If the session directory lacks `--tts-id`, fetch it once under the agent host and write it into the session. */
const ensureTtsCatalogVoiceForOverride = async (ttsIdOverride: string): Promise<void> => {
  const session = readSessionRaw();
  if (!session) return;
  if (findTtsVoiceById(getSessionTtsVoices(session), ttsIdOverride)) return;
  if (!isTtsHostFlush()) return;

  const orgId = cliEnv().AINOBI_COURSEWARE_ORG_ID?.trim() || undefined;
  const result = await fetchTtsListViaHost({ orgId });
  const voices = [...result.voices];
  if (!findTtsVoiceById(voices, ttsIdOverride)) {
    // Narration of an existing courseware may store an old, hidden (inactive) voice ID (FishAudio / MiniMax).
    // Only that one entry is added; the catalog the agent picks from still holds only active voices.
    const inactive = await fetchTtsListViaHost({ orgId, status: "inactive" });
    const legacy = findTtsVoiceById(inactive.voices, ttsIdOverride);
    if (legacy) voices.push(legacy);
  }
  saveSessionRecord({
    ...session,
    tts_voices: voices,
  });
};

/**
 * When editing an existing courseware, `load` does not bring in ai_teachers; fetch them once under the agent host,
 * so a delete&&insert voice swap does not leave broken narration because the teacher catalog was never loaded.
 * Fetched only when the session has no catalog yet (key missing); an empty array means the organization really has no teachers.
 */
const ensureAiTeacherCatalogLoaded = async (): Promise<void> => {
  const session = readSessionRaw();
  if (!session) return;
  if (Array.isArray(session.ai_teachers)) return;
  if (!isAiTeachersHostFlush()) return;

  const result = await fetchAiTeachersViaHost({
    orgId: cliEnv().AINOBI_COURSEWARE_ORG_ID?.trim() || undefined,
  });
  saveSessionRecord({
    ...session,
    ai_teachers: [...result.teachers],
  });
};

export const handleNarrationInsert = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  rejectNarrationTtsOptOut(args);
  // Refuse garbled text before TTS synthesis, so we don't synthesize � and get billed only to fail later in saveScene.
  assertNoReplacementCharsInFlags({
    "--transcript": flagString(args, "transcript"),
    "--script": flagString(args, "script"),
    "--teacher-name": flagString(args, "teacher-name"),
    "--tts-style": flagString(args, "tts-style"),
  });
  await ensureAiTeacherCatalogLoaded();
  const ttsIdOverride = flagString(args, "tts-id")?.trim();
  if (ttsIdOverride) {
    await ensureTtsCatalogVoiceForOverride(ttsIdOverride);
  }
  if (isNarrationHostFlush()) {
    await runNarrationInsertViaHost(output);
    return;
  }
  const { session, scene } = requireScene();
  const slideIdx = findSlideIndex(scene.slide_elements, args.positionals[0]);
  const slide = scene.slide_elements[slideIdx];
  const teacherId = flagString(args, "teacher-id")?.trim();
  if (!teacherId) {
    throw new AinobiCliError(
      "USAGE",
      "Narration insert requires --teacher-id <ai_teacher_id>.",
      {
        hint:
          "Run `ainobi ai-teachers list` to list the organization catalog, present the options to the user (when they have not picked one), then call `narration insert <slide> --teacher-id <uuid> --transcript …`.",
      },
    );
  }
  const explicitTeachers = loadExternalTeachers(args);
  const sessionHasCatalog = Array.isArray(session.ai_teachers);
  const sessionTeachers = getSessionAiTeachers(session);
  const teacherPool = explicitTeachers ?? sessionTeachers;
  if (teacherPool.length === 0) {
    if (!explicitTeachers && sessionHasCatalog) {
      throw new AinobiCliError(
        "NOT_FOUND",
        "The organization has no AI teachers configured — narration insert cannot run.",
        {
          hint:
            "Stop and tell the user (in their language) that the platform admin must add at least one AI teacher under “教师管理 > AI 教师” (Teacher Management > AI Teachers) on the AINOBI platform. The agent cannot create AI teachers from here. After an admin adds one, rerun `ainobi ai-teachers list --save` and then `narration insert`.",
        },
      );
    }
    throw new AinobiCliError(
      "NOT_LOADED",
      "No AI teacher catalog is loaded for this session.",
      {
        hint:
          "Run `ainobi ai-teachers list --save` (or `ainobi ai-teachers sync`) before `narration insert`, or pass `--teacher-file <path>` with the catalog JSON. If that query returns an empty list, ask the platform admin to add an AI teacher under “教师管理 > AI 教师”.",
      },
    );
  }
  const { teacher, source } = selectAITeacher(teacherPool, teacherId);
  if (source === "builtin" || teacher.ai_teacher_id !== teacherId) {
    throw new AinobiCliError(
      "NOT_FOUND",
      `AI teacher "${teacherId}" not found in the current catalog.`,
      {
        hint:
          "Run `ainobi ai-teachers list` to see available ai_teacher_id values, then pass `--teacher-id` with one of them.",
      },
    );
  }
  let effectiveTeacher = teacher;
  if (ttsIdOverride) {
    let catalogVoice = findTtsVoiceById(getSessionTtsVoices(session), ttsIdOverride);
    if (!catalogVoice) {
      await ensureTtsCatalogVoiceForOverride(ttsIdOverride);
      const refreshed = readSessionRaw();
      catalogVoice = refreshed
        ? findTtsVoiceById(getSessionTtsVoices(refreshed), ttsIdOverride)
        : undefined;
    }
    if (!catalogVoice) {
      throw new AinobiCliError(
        "NOT_FOUND",
        `TTS voice "${ttsIdOverride}" not found in the session catalog.`,
        {
          hint:
            "Run `ainobi tts list --save` first, then pass `--tts-id <tts_id>` from that catalog.",
        },
      );
    }
    effectiveTeacher = applyTtsCatalogToTeacher(teacher, catalogVoice);
  }
  const ttsSettings = resolveTeacherTtsSettings(effectiveTeacher);
  // --tts-style: agent-facing style override — recommended presets only (the
  // full persona catalog is human-facing; see backend configs/tts_styles.json).
  const ttsStyleOverrideKey = flagString(args, "tts-style")?.trim() || "";
  // --tts-style has two meanings: a recommended key looks up the preset; any other value passes through as custom free text (same as the backend)
  const ttsStyleOverridePrompt = ttsStyleOverrideKey
    ? resolveTtsStylePrompt(ttsStyleOverrideKey)
    : null;
  const effectiveTtsSettings = ttsStyleOverridePrompt
    ? { ...ttsSettings, style: ttsStyleOverridePrompt }
    : ttsSettings;
  const vtuberId = newElementId("vtuber");
  const narrationId = newElementId("narration");
  const script = normalizeMultilineCliText(flagString(args, "script") ?? "");
  const transcript = normalizeMultilineCliText(flagString(args, "transcript") ?? "");
  const transcriptStored = resolveNarrationTranscriptStored(script, transcript);
  const ttsSource = resolveNarrationTtsSource(script, transcript);
  const teacherName = flagString(args, "teacher-name") ?? teacher.ai_teacher_name;
  assertNarrationTtsLineBreakPolicy(ttsSource);
  const languageMismatchWarning = buildTranscriptLanguageMismatchWarning({
    transcript: ttsSource,
    teacherLanguage: teacher.ai_teacher_language,
    warningPath: `slide_elements[${slideIdx}].children_elements`,
  });
  const ttsGapMs = Math.max(0, flagNumber(args, "tts-gap-ms") ?? 100);
  const ttsTexts = splitTranscriptForTts(ttsSource);
  const ttsBuild = await buildTtsSegments(ttsSource, {
    gapMs: ttsGapMs,
    settings: effectiveTtsSettings,
    requestedVoiceId: effectiveTeacher.ai_teacher_tts_voice ?? effectiveTeacher.ai_teacher_tts_id,
  });
  const segments = ttsBuild.segments;
  if (ttsBuild.voice_fallback_applied) {
    ttsSettings.voice_id = ttsBuild.voice_id;
  }
  const fitSlide = flagBool(args, "fit-slide", true);
  const subtitleVisible = flagBool(args, "subtitle-visible", true);
  const fitTailMs = Math.max(0, flagNumber(args, "tail-ms") ?? 500);
  const staggerGapMs = Math.max(0, flagNumber(args, "stagger-gap-ms") ?? 0);
  const synthesizedDurationMs = totalTtsDurationMs(segments);
  const existingNarrations = listSlideNarrationTimelineRefs(slide);
  const startAt = resolveNextNarrationStartAt(slide.timeline.start_at, existingNarrations, {
    gapMs: staggerGapMs,
  });
  const fallbackDurationMs = Math.max(
    1,
    (flagNumber(args, "duration") ?? Math.max(slide.timeline.end_at - startAt, 1)),
  );
  const audioBasedEnd =
    synthesizedDurationMs > 0 ? startAt + synthesizedDurationMs + fitTailMs : null;
  let endAt: number;
  if (fitSlide && audioBasedEnd !== null) {
    endAt = audioBasedEnd;
  } else if (audioBasedEnd !== null) {
    endAt = Math.max(startAt + fallbackDurationMs, audioBasedEnd);
  } else {
    endAt = startAt + fallbackDurationMs;
  }
  const previousSlideEnd = slide.timeline.end_at;
  // First narrated track may shrink the slide to audio; additional tracks only extend.
  const targetSlideEnd =
    fitSlide && audioBasedEnd !== null && existingNarrations.length === 0
      ? endAt
      : Math.max(previousSlideEnd, endAt);
  const extendExistingChildrenMs = Math.max(0, targetSlideEnd - previousSlideEnd);
  const fitWarnings: CliIssue[] = [];
  if (languageMismatchWarning) {
    fitWarnings.push(languageMismatchWarning);
  }
  if (ttsBuild.voice_fallback_applied) {
    fitWarnings.push({
      path: `slide_elements[${slideIdx}].children_elements`,
      message:
        "Teacher TTS voice was not supported by the speech provider; narration used the platform default voice automatically.",
    });
  }
  if (fitSlide && synthesizedDurationMs <= 0) {
    fitWarnings.push({
      path: `slide_elements[${slideIdx}].children_elements`,
      message: "Cannot fit slide to narration because no synthesized TTS duration is available.",
    });
  }
  if (existingNarrations.length > 0 && startAt > slide.timeline.start_at) {
    fitWarnings.push({
      path: `slide_elements[${slideIdx}].children_elements`,
      message:
        `Slide already has ${existingNarrations.length} narration track(s); ` +
        `new narration+vtuber was auto-staggered to start_at=${startAt} (gap_ms=${staggerGapMs}) so AI-teacher audio does not overlap.`,
      value: {
        narration_start_at: startAt,
        existing_narration_count: existingNarrations.length,
        stagger_gap_ms: staggerGapMs,
      },
    });
  }

  const vtuberPayload = {
    ...getElementScaffold("vtuber"),
    element_id: vtuberId,
    locked: true,
    name: teacherName,
    model_id: teacher.ai_teacher_id,
    expression: "default",
    motion: "idle",
    timeline: { start_at: startAt, end_at: endAt },
    style: { opacity: 1, rotation_deg: 0, z_index: 0 },
    metadata: {
      // Keep speech fields in sync with narration when --tts-id overrides the voice.
      ...aiTeacherMetadata(effectiveTeacher),
      ai_teacher_name: teacherName,
    },
    ...(effectiveTeacher.ai_teacher_tts_id
      ? { ai_teacher_tts_id: effectiveTeacher.ai_teacher_tts_id }
      : {}),
    ...(ttsStyleOverrideKey && ttsSettings.provider === "google"
      ? { ai_teacher_tts_style: ttsStyleOverrideKey }
      : {}),
    ...(effectiveTeacher.ai_teacher_tts_speed !== undefined
      ? { ai_teacher_tts_speed: effectiveTeacher.ai_teacher_tts_speed }
      : {}),
    ...(effectiveTeacher.ai_teacher_tts_volume !== undefined
      ? { ai_teacher_tts_volume: effectiveTeacher.ai_teacher_tts_volume }
      : {}),
    ...(effectiveTeacher.ai_teacher_tts_pitch !== undefined
      ? { ai_teacher_tts_pitch: effectiveTeacher.ai_teacher_tts_pitch }
      : {}),
    ...(effectiveTeacher.ai_teacher_language
      ? { ai_teacher_language: effectiveTeacher.ai_teacher_language }
      : {}),
    keyframes: [
      {
        at: startAt,
        position: { x: 1343.901207911271, y: 11.318788268716897 },
        size: { width: 677.2763761467891, height: 1070.9489678899083 },
        rotation_deg: 0,
        opacity: 1,
        easing: "ease-in-out",
      },
      {
        at: endAt,
        position: { x: 1340.7037329421792, y: 15.806841481217372 },
        size: { width: 677.2763761467891, height: 1070.9489678899083 },
        rotation_deg: 0,
        opacity: 1,
        easing: "ease-in-out",
      },
    ],
  };

  const narrationPayload = {
    ...getElementScaffold("narration"),
    element_id: narrationId,
    locked: true,
    name: `${teacherName} 讲解`,
    ai_teacher_id: teacher.ai_teacher_id,
    ai_teacher_name: teacherName,
    ...(effectiveTeacher.ai_teacher_tts_id
      ? { ai_teacher_tts_id: effectiveTeacher.ai_teacher_tts_id }
      : {}),
    ...(ttsStyleOverrideKey && ttsSettings.provider === "google"
      ? { ai_teacher_tts_style: ttsStyleOverrideKey }
      : {}),
    ...(effectiveTeacher.ai_teacher_tts_speed !== undefined
      ? { ai_teacher_tts_speed: effectiveTeacher.ai_teacher_tts_speed }
      : {}),
    ...(effectiveTeacher.ai_teacher_tts_volume !== undefined
      ? { ai_teacher_tts_volume: effectiveTeacher.ai_teacher_tts_volume }
      : {}),
    ...(effectiveTeacher.ai_teacher_tts_pitch !== undefined
      ? { ai_teacher_tts_pitch: effectiveTeacher.ai_teacher_tts_pitch }
      : {}),
    ...(effectiveTeacher.ai_teacher_language
      ? { ai_teacher_language: effectiveTeacher.ai_teacher_language }
      : {}),
    vtuber_element_id: vtuberId,
    script,
    transcript: transcriptStored,
    segments,
    timeline: { start_at: startAt, end_at: endAt },
    style: { opacity: 1, rotation_deg: 0, z_index: 1 },
    metadata: {
      ...aiTeacherMetadata(effectiveTeacher),
      ai_teacher_name: teacherName,
      vtuber_element_id: vtuberId,
      tts: {
        provider: ttsSettings.provider,
        model: ttsSettings.model,
        voice_id: ttsSettings.voice_id,
        speed: ttsSettings.speed,
        volume: ttsSettings.vol,
        pitch: ttsSettings.pitch,
        ...(ttsSettings.language_boost ? { language: ttsSettings.language_boost } : {}),
        segment_count: segments.length,
        source_line_count: ttsTexts.length,
        ...(ttsIdOverride ? { tts_id_override: ttsIdOverride } : {}),
      },
    },
    subtitle_text_color: "#FFFFFF",
    subtitle_visible: subtitleVisible,
  };

  const { element: vtuber } = parseElement(vtuberPayload, `slide[${slideIdx}].children_elements[]`);
  const { element: narration } = parseElement(narrationPayload, `slide[${slideIdx}].children_elements[]`);
  const sceneJson = serializeScene(scene) as Record<string, unknown>;
  const slidesArr = [...(sceneJson.slide_elements as Record<string, unknown>[])];
  const childrenArr = [...((slidesArr[slideIdx].children_elements as unknown[]) ?? [])];
  let childrenWithTiming = childrenArr;
  if (extendExistingChildrenMs > 0) {
    childrenWithTiming = extendSerializedChildrenEndByDelta(childrenWithTiming, extendExistingChildrenMs, {
      onlyIfEndAtLeastMs: previousSlideEnd,
    });
  }
  if (targetSlideEnd < previousSlideEnd) {
    childrenWithTiming = clampSerializedChildrenToMaxEnd(childrenWithTiming, targetSlideEnd);
  }
  childrenWithTiming.push(serializeElement(vtuber), serializeElement(narration));
  const slideJson = slidesArr[slideIdx];
  slidesArr[slideIdx] = {
    ...slideJson,
    timeline: {
      ...(slideJson.timeline as Record<string, unknown> | undefined),
      end_at: targetSlideEnd,
    },
    children_elements: childrenWithTiming,
  };
  sceneJson.slide_elements = slidesArr;

  const { scene: validatedScene, warnings } = parseScene(sceneJson);
  await saveScene(session, validatedScene);
  const insertedSlide = validatedScene.slide_elements[slideIdx];
  const inserted = insertedSlide.children_elements.slice(-2) as Element[];

  printSuccess(
    {
      slide_index: slideIdx,
      slide_id: insertedSlide.element_id,
      teacher_source: source,
      teacher: {
        ai_teacher_id: teacher.ai_teacher_id,
        ai_teacher_name: teacherName,
      },
      vtuber_element_id: vtuber.element_id,
      narration_element_id: narration.element_id,
      narration_start_at: startAt,
      narration_end_at: endAt,
      ...(existingNarrations.length > 0
        ? {
            auto_staggered: true,
            existing_narration_count: existingNarrations.length,
            stagger_gap_ms: staggerGapMs,
          }
        : {}),
      inserted: inserted.map((element, offset) => ({
        index: insertedSlide.children_elements.length - inserted.length + offset,
        element_id: element.element_id,
        element_type: element.element_type,
        name: element.name,
      })),
      ...(fitSlide
        ? {
            fit_slide: synthesizedDurationMs > 0,
            narration_duration_ms: synthesizedDurationMs || null,
            tail_ms: fitTailMs,
            slide_end_at: insertedSlide.timeline.end_at,
          }
        : {}),
      ...(extendExistingChildrenMs > 0 ? { slide_extension_ms: extendExistingChildrenMs } : {}),
      ...(previousSlideEnd > targetSlideEnd ? { slide_shrink_ms: previousSlideEnd - targetSlideEnd } : {}),
      tts_segments: segments.length,
      tts_provider: ttsSettings.provider,
    },
    output,
    [...warnings, ...fitWarnings],
  );
};
