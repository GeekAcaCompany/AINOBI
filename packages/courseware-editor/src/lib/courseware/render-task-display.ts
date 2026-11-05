// SPDX-License-Identifier: AGPL-3.0-only
import type { NewTranslationKey } from "@ainobi/courseware-player/hooks/useI18nNew";

const STAGE_LABEL_KEYS: Record<string, NewTranslationKey> = {
  preparing: "coursewareEditor.exportVideo.stagePreparing",
  preprocessing: "coursewareEditor.exportVideo.stagePreprocessing",
  /** Distributed Hyperframes: plan → chunk × N → assemble. */
  planning: "coursewareEditor.exportVideo.stagePlanning",
  /** Same copy as single-instance rendering — chunks are an implementation detail. */
  chunking: "coursewareEditor.exportVideo.stageRendering",
  rendering: "coursewareEditor.exportVideo.stageRendering",
  encoding: "coursewareEditor.exportVideo.stageEncoding",
  assembling: "coursewareEditor.exportVideo.stageAssembling",
  uploading: "coursewareEditor.exportVideo.stageUploading",
};

/** Hyperframes `updateJobStatus` human messages already stored on older tasks. */
const STAGE_MESSAGE_ALIASES: Record<string, keyof typeof STAGE_LABEL_KEYS> = {
  "compiling composition": "preprocessing",
  "extracting video frames": "preprocessing",
  "processing audio tracks": "preprocessing",
  "starting frame capture": "rendering",
  "writing png sequence": "encoding",
  "encoding gif": "encoding",
  "encoding video": "encoding",
  "assembling final video": "assembling",
  "render complete": "rendering",
};

/** Hyperframes `currentStage` values that differ from our canonical keys. */
const STAGE_ALIASES: Record<string, keyof typeof STAGE_LABEL_KEYS> = {
  compile: "preprocessing",
  compiled: "preprocessing",
  browser_probe: "preprocessing",
  probe: "preprocessing",
  extract: "preprocessing",
  prerender: "preprocessing",
  video_extract: "preprocessing",
  audio_process: "preprocessing",
  file_server: "preprocessing",
  pipeline: "preparing",
  init: "preparing",
  initial: "preparing",
  browser: "preparing",
  encode: "encoding",
  assemble: "assembling",
  screenshot: "rendering",
  capture_streaming: "rendering",
  capture_disk: "rendering",
  capture_calibration: "rendering",
  capture_hdr_layered: "rendering",
  capture_strategy: "rendering",
  worker_resolve: "rendering",
  hdr_detection: "preprocessing",
};

const ERROR_LABEL_KEYS: Record<string, NewTranslationKey> = {
  "interrupted:service_restart": "coursewareEditor.exportVideo.errorInterruptedServiceRestart",
  "interrupted:stale_heartbeat": "coursewareEditor.exportVideo.errorInterruptedStaleHeartbeat",
  "cancelled:user": "coursewareEditor.exportVideo.errorCancelledUser",
};

function normalizeRenderTaskStageKey(stage: string): string {
  return stage.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isRenderTaskRenderingStage(stage: string | null | undefined): boolean {
  if (!stage?.trim()) return false;
  const normalized = normalizeRenderTaskStageKey(stage);
  if (normalized === "rendering" || normalized === "chunking") return true;
  if (STAGE_ALIASES[normalized] === "rendering") return true;
  if (normalized.startsWith("capture_")) return true;
  const fromMessage = STAGE_MESSAGE_ALIASES[stage.trim().toLowerCase()];
  return fromMessage === "rendering";
}

export function resolveRenderTaskStageLabel(
  stage: string | null | undefined,
  t: (key: NewTranslationKey) => string,
): string | null {
  if (!stage?.trim()) return null;
  const trimmed = stage.trim();
  const normalized = normalizeRenderTaskStageKey(trimmed);
  const direct = STAGE_LABEL_KEYS[normalized];
  if (direct) return t(direct);
  const alias = STAGE_ALIASES[normalized];
  if (alias) return t(STAGE_LABEL_KEYS[alias]);
  if (normalized.startsWith("capture_")) {
    return t(STAGE_LABEL_KEYS.rendering);
  }
  const fromMessage = STAGE_MESSAGE_ALIASES[trimmed.toLowerCase()];
  if (fromMessage) return t(STAGE_LABEL_KEYS[fromMessage]);
  return null;
}

export function resolveRenderTaskProcessLabel(
  task: {
    status: string;
    stage?: string | null;
    framesRendered?: number | null;
    totalFrames?: number | null;
  },
  t: (key: NewTranslationKey, variables?: Record<string, string | number>) => string,
): string | null {
  if (task.status !== "running") return null;

  const stageLabel =
    resolveRenderTaskStageLabel(task.stage, t) ??
    t("coursewareEditor.exportVideo.stagePreparing");

  if (
    isRenderTaskRenderingStage(task.stage) &&
    typeof task.framesRendered === "number" &&
    typeof task.totalFrames === "number" &&
    task.totalFrames > 0
  ) {
    return t("coursewareEditor.exportVideo.stageRenderingFrames", {
      stage: stageLabel,
      current: task.framesRendered,
      total: task.totalFrames,
    });
  }

  return stageLabel;
}

function parseTaskTimeMs(iso: string | null | undefined): number | null {
  if (!iso?.trim()) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function resolveRenderTaskElapsedMs(
  task: {
    status: string;
    createdAt?: string | null;
    queuedAt?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    result?: { render?: { takes?: number } } | null;
  },
  nowMs = Date.now(),
): number | null {
  const createdMs = parseTaskTimeMs(task.createdAt);
  const queuedMs = parseTaskTimeMs(task.queuedAt) ?? createdMs;
  const startedMs = parseTaskTimeMs(task.startedAt);
  const completedMs = parseTaskTimeMs(task.completedAt);

  if (
    task.status === "completed" ||
    task.status === "failed" ||
    task.status === "interrupted" ||
    task.status === "cancelled"
  ) {
    const startMs = startedMs ?? queuedMs ?? createdMs;
    if (startMs != null && completedMs != null) {
      return Math.max(0, completedMs - startMs);
    }
    const takes = task.result?.render?.takes;
    return typeof takes === "number" && takes > 0 ? takes : null;
  }

  if (task.status === "running") {
    const startMs = startedMs ?? queuedMs ?? createdMs;
    return startMs == null ? null : Math.max(0, nowMs - startMs);
  }

  if (task.status === "queued") {
    return queuedMs == null ? null : Math.max(0, nowMs - queuedMs);
  }

  return null;
}

export function formatRenderTaskDurationMs(
  ms: number,
  t: (key: NewTranslationKey, variables?: Record<string, string | number>) => string,
): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return t("coursewareEditor.exportVideo.durationHoursMinutes", { hours, minutes });
  }
  if (minutes > 0) {
    return t("coursewareEditor.exportVideo.durationMinutesSeconds", { minutes, seconds });
  }
  return t("coursewareEditor.exportVideo.durationSeconds", { seconds });
}

export function resolveRenderTaskElapsedLabel(
  task: {
    status: string;
    createdAt?: string | null;
    queuedAt?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    result?: { render?: { takes?: number } } | null;
  },
  t: (key: NewTranslationKey, variables?: Record<string, string | number>) => string,
  nowMs = Date.now(),
): string | null {
  const elapsedMs = resolveRenderTaskElapsedMs(task, nowMs);
  if (elapsedMs == null) return null;
  const duration = formatRenderTaskDurationMs(elapsedMs, t);
  if (task.status === "queued" || task.status === "running") {
    return t("coursewareEditor.exportVideo.elapsedRunning", { duration });
  }
  return t("coursewareEditor.exportVideo.elapsed", { duration });
}

/** Video content length from `result.render.duration` (ms). Only meaningful for completed tasks. */
export function resolveRenderTaskVideoDurationMs(task: {
  status: string;
  result?: { render?: { duration?: number } } | null;
}): number | null {
  if (task.status !== "completed") return null;
  const durationMs = task.result?.render?.duration;
  return typeof durationMs === "number" && durationMs > 0 ? durationMs : null;
}

export function resolveRenderTaskVideoDurationLabel(
  task: {
    status: string;
    result?: { render?: { duration?: number } } | null;
  },
  t: (key: NewTranslationKey, variables?: Record<string, string | number>) => string,
): string | null {
  const durationMs = resolveRenderTaskVideoDurationMs(task);
  if (durationMs == null) return null;
  return t("coursewareEditor.exportVideo.videoDuration", {
    duration: formatRenderTaskDurationMs(durationMs, t),
  });
}

export function resolveRenderTaskErrorLabel(
  errorMessage: string | null | undefined,
  t: (key: NewTranslationKey) => string,
): string | null {
  if (!errorMessage?.trim()) return null;
  const trimmed = errorMessage.trim();
  const known = ERROR_LABEL_KEYS[trimmed];
  if (known) return t(known);
  if (/worker instance stopped responding/i.test(trimmed)) {
    return t("coursewareEditor.exportVideo.errorInterruptedStaleHeartbeat");
  }
  return trimmed;
}
