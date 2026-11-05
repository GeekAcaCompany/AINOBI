// SPDX-License-Identifier: AGPL-3.0-only
import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import { useNavigate } from "react-router";
import toast from "react-hot-toast";
import { usePlaybackPlayheadMs } from "../hooks/usePlaybackPlayheadMs.ts";
import { useNarrationSegmentPlayback } from "../hooks/useNarrationSegmentPlayback.ts";
import { useOrgStudentIdentity } from "../host/org-identity.ts";
import {
  ArrowLeft,
  Download,
  File as FileIcon,
  Loader2,
  Lock,
  Maximize2,
  Menu,
  MessageCircle,
  MessageCircleQuestionMark,
  Mic,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Send,
  SkipBack,
  SkipForward,
  Type,
  Volume2,
  X,
} from "lucide-react";
import courseApi from "../host/course-api.ts";
import courseSectionApi from "../host/course-section-api.ts";
import publicCourseApi from "../host/public-course-api.ts";
import coursewareApi, {
  type CoursewareQuizAnswerContent,
  type SubmitCoursewareQuizAnswerResponse,
} from "../api/courseware.ts";
import coursewareAgentApi, {
  applyCoursewareAgentChatUiEvents,
  coursewareAgentChatStreamErrorUiEvents,
  coursewareAiAssistantBlocksToPlainText,
  createAgentChatStreamState,
  dedupeSceneElementIds,
  isCoursewareApiConfigured,
  mapSdkMessageToChatUiEvents,
  parseCoursewareAgentChatUiSsePayload,
  readRedisStreamCursorFromSseEvent,
  type CoursewareAgentChatUiEvent,
  type CoursewareAgentConversationHistoryMessage,
  type CoursewareAiAssistantBlock,
} from "../api/courseware_agent.ts";
import {
  AiAssistantInsufficientPersonalCreditsCard,
  assistantPanelBubbleHasVisibleBody,
  CoursewareAiAssistantMessageBody,
} from "../components/courseware-ai-assistant/CoursewareAiAssistantMessageBody.tsx";
import { MicAnalyserWaveform } from "../components/MicAnalyserWaveform.tsx";
import {
  buildInteractionAgentChatStreamBody,
  fetchInteractionConversationHistory,
  isInteractionApiConfigured,
  postInteractionChatStream,
  postInteractionChatStreamAbort,
  postInteractionPermissionAnswer,
  readInteractionAgentSseSessionFields,
  type InteractionConversationHistoryResult,
} from "../host/interaction-agent.ts";
import {
  useWhisperVoiceDictation,
  type WhisperVoiceDictationError,
  type WhisperVoiceDictationState,
} from "../host/whisper-dictation.ts";
import coursewareQuizAnswerRecordingsApi from "../api/courseware_quiz_answer_recordings.ts";
import sessionManager from "../host/session-manager.ts";
import {
  applyCoursewareApiTitleToScene,
  CoursewareAccessForbiddenError,
  clearCoursewareEditorLocalDraft,
  evaluateCoursewareRemoteAccess,
  isCoursewareAccessForbiddenError,
} from "../lib/courseware-access.ts";
import { fixRecordedWebmBlob } from "../lib/fix-recorded-webm-blob.ts";
import { measureBlobAudioDurationSec } from "../lib/measure-blob-audio-duration.ts";
import {
  buildQuestionStackRenderUnits,
  collectSlideCanvasAudioElementsForMixer,
  getCanvasAudioDisplayMode,
  createSceneScriptRuntime,
  deserializeScene,
  executeElementBinding,
  getElementHighlightSegments,
  interpolateElementTransformInSlide,
  isElementHighlightActiveAtTime,
  isElementVisibleAtTime,
  isElementVisibleAtTimeInSlide,
  getQuizQuestionPlaybackPauseStartAt,
  getQuizQuestionGroupBoundsSlidePx,
  computeElementEnterExitEffectVisual,
  QUIZ_PREVIEW_ELEMENT_OPACITY_TRANSITION_MS,
  tryPresignSceneAssetUrls,
  getSlideBackgroundImageLayerStyle,
  type ElementHighlight,
  type QuizSlideElement,
  type QuizConfig,
  type QuizQuestion,
  type SlideElement,
  type Element as CourseElement,
  type ElementScriptRuntime,
  type NarrationElement,
  type NarrationSegment,
  type Scene,
  type SceneScriptRuntime,
  type Transition,
  type VtuberElement,
  type ImageElement,
  type SvgElement,
  type AudioElement,
  type PPTElement,
  type VideoElement,
  clampSlideLocalSnapshotTime,
  resolvePptSlideIndexForTimeline,
  resolveTextLineHeight,
  buildTextElementContainerStyle,
  getVtuberSourceKey,
  listVtubersOnSlide,
  resolveVtuberLipSyncValue,
  computeQuizAggregateScore,
  ensureQuizScoreSummaryConfig,
  type QuizAggregateScoreSnapshot,
} from "../lib/courseware/index.ts";
import { resolveSceneAiTeacherId } from "../lib/courseware/resolve-scene-ai-teacher-id.ts";
import { makePreviewStorageKey, readPreviewSceneBundle } from "../lib/coursewarePreviewSceneStorage.ts";
import { presignLoadedScene } from "../lib/courseware-renderer/scene-loader.ts";
import { resolveQuizSubmitDisplayFeedback } from "../lib/courseware/quiz-submit-feedback.ts";
import { resolveQuizSubmitErrorMessage } from "../lib/courseware/quiz-submit-feedback.ts";
import {
  findFlowPauseCrossing,
  getSceneFlowPauseMarkers,
  getSlideFlowPausePoints,
  resolveFlowPauseResumePlayheadMs,
  syncFlowPauseAcknowledgementsOnSeek,
  type SceneFlowPauseMarker,
} from "@ainobi/courseware-core/slide-flow-pause.ts";
import {
  readCoursewarePreviewSectionContext,
  type CoursewarePreviewSectionContext,
} from "../lib/courseware-preview-section-context.ts";
import {
  collectRequiredQuizWrapperIds,
  computeCoursewareLearningProgressPercent,
  slideHasQuizScoreSummary,
} from "@ainobi/courseware-core/learning-progress.ts";
import {
  buildCoursewarePlaybackResumeKey,
  migrateStandaloneCoursewarePlaybackResume,
  readCoursewarePlaybackResume,
  saveCoursewarePlaybackResume,
} from "../lib/courseware/playback-resume.ts";
import {
  buildCoursewareQuizSkippedAnswer,
  buildTopLevelQuizWrapperIndex,
  canCompleteQuizHomework,
  countQuizQuestionsExpectedForCompletion,
  findTopLevelQuizWrapper,
  hasPlayableContentAfterQuizWrapper,
  isNextBoundQuizOnSameSlide,
} from "@ainobi/courseware-core/quiz-preview-wrappers.ts";
import {
  buildQuizAttemptSessionStorageKey,
  clearQuizAttemptSessionId,
  persistQuizAttemptSessionId,
  readQuizAttemptSessionId,
} from "../lib/courseware/quiz-attempt-session.ts";
import { getHeadlessTransitionLayerStyle } from "../lib/courseware-renderer/slide-transition.ts";
import { mergeQuizStateFromAttemptAnswers, fetchQuizAnswersForPreviewRestore, shouldSyncQuizAnswersOnPreviewLoad } from "../lib/courseware/quiz-attempt-sync.ts";
import { ProtectedRoute } from "../host/protected-route.ts";
import { CoursewareRasterImage } from "../components/CoursewareRasterImage.tsx";
import { CoursewareShapeContent } from "../components/CoursewareShapeContent.tsx";
import { CoursewareSvgContent } from "../components/CoursewareSvgContent.tsx";
import { CanvasAudioStageWidget } from "../components/courseware/CanvasAudioStageWidget.tsx";
import { CoursewareHtmlStageEmbed } from "../components/courseware/CoursewareHtmlStageEmbed.tsx";
import { SlideBackgroundHtmlLayer } from "../components/courseware/SlideBackgroundHtmlLayer.tsx";
import { QuizRenderer, type QuizSubmissionPayload } from "../components/courseware/quiz/index.ts";
import { QuizScoreSummaryRenderer } from "../components/courseware/quiz-score-summary/index.ts";
import { RichRenderer } from "../components/courseware/rich/RichRenderer.tsx";
import { GlobalAudioTracks } from "../components/courseware/GlobalAudioTracks.tsx";
import { PPTRenderer } from "../components/courseware/PPTRenderer.tsx";
import { VtuberModelLoadingPlaceholder } from "@ainobi/avatar/VtuberModelLoadingPlaceholder";
import Live2DModelComponent from "@ainobi/avatar/Live2DModel";
import Inochi2DModelComponent from "@ainobi/avatar/Inochi2DModel";
import {
  buildCoursewareInochiStageModelProps,
  buildCoursewareLive2dStageModelProps,
} from "@ainobi/avatar/inochi-stage-render";
import { getVtuberModelUrlFromMetadata } from "@ainobi/avatar/vtuber-model-defaults";
import {
  getVtuberModelCacheKey,
  isVtuberModelWarmInCache,
  getRememberedLive2dUnlockForMountSig,
  rememberLive2dUnlockForMountSig,
  resolveInitialLive2dUnlockedThroughIndex,
  shouldPreserveLive2dUnlockAcrossMountSigChange,
} from "@ainobi/avatar/vtuber-model-cache";
import { CourseSectionType } from "@ainobi/api-contracts/enums/course_section.ts";
import { useAuth } from "../host/auth.ts";
import { useI18nNew } from "../hooks/useI18nNew.tsx";
import { getCourseSectionLockedReason } from "../lib/course-access.ts";
import {
  findSectionNodeInTree,
  resolveSectionNavigationUrl,
} from "../lib/course-navigation.ts";
import type { CourseKnowledgeFileInfo } from "../schemas/course_knowledge_file.ts";
import type { CourseTreeNode } from "../schemas/course_tree.ts";
import type { CourseTreeResponse } from "../schemas/response/course_tree.ts";
import {
  buildQuizPostSubmitPrimaryLabel,
  type CoursewareTranslateFn,
} from "../lib/i18n/coursewareRoutesI18n.ts";
import { resolveSlideDisplayName } from "../lib/courseware/slide-display-name.ts";
import logger from "../host/logger.ts";
import { findNarrationSegmentIndexAtTime } from "../lib/courseware/narration-segments.ts";
import { resolveNarrationSegmentPlaybackUrl } from "../lib/courseware/narration-preload.ts";
import { narrationPendingStartElapsedMs, NARRATION_COLD_START_HOLD_MS } from "../lib/courseware/narration-pending-start.ts";
import { INSUFFICIENT_CREDITS_FRAME_CODE } from "@ainobi/api-contracts/core/credit-errors";

// ---------- constants ----------

const SLIDE_LOGICAL_WIDTH = 1920;
const SLIDE_LOGICAL_HEIGHT = 1080;
const DEFAULT_DURATION_MS = 5_000;
const TRANSITION_MS = 450;
const HIGHLIGHT_TRANSITION_MS = 260;
/** Refresh interval of the sidebar/control bar time UI; the stage goes through playheadRef + usePlaybackPlayheadMs */
const PLAYBACK_UI_PUBLISH_MS = 80;
const MEDIA_PRELOAD_BUCKET_MS = 500;
/** Top/bottom bars in fullscreen: collapse automatically after the mouse stays still longer than this */
const PREVIEW_FULLSCREEN_CHROME_IDLE_MS = 3_000;
/** In fullscreen with the bars hidden: they expand only when the pointer enters the top/bottom edge of the screen (px) */
const PREVIEW_FULLSCREEN_CHROME_EDGE_TOP_PX = 40;
const PREVIEW_FULLSCREEN_CHROME_EDGE_BOTTOM_PX = 56;
/** Preview page arrow keys: left/right adjust the playback position (ms) */
const PREVIEW_KEYBOARD_SEEK_MS = 5_000;
/** Preview page arrow keys: up/down adjust the master volume (percentage step) */
const PREVIEW_KEYBOARD_VOLUME_STEP = 5;
/** Floating position/volume hint: how long it stays visible */
const PREVIEW_ACTION_HINT_VISIBLE_MS = 650;
/** Floating position/volume hint: fade-out animation duration */
const PREVIEW_ACTION_HINT_EXIT_MS = 220;
/** Narrow screens: the bottom bar hides speak/text input (both PCs and touch devices) */
const PREVIEW_NARROW_VIEWPORT_MEDIA = "(max-width: 1023px)";
/** Touch devices with narrow screens: only then is the landscape rotation fullscreen allowed (not enabled on PCs even when the window is narrowed) */
const PREVIEW_FORCE_LANDSCAPE_VIEWPORT_MEDIA = "(max-width: 1023px) and (hover: none)";
/** Landscape floating buttons: hide automatically after inactivity (ms) */
const PREVIEW_LANDSCAPE_BUTTON_IDLE_MS = 3_000;
/** Landscape fullscreen gesture: minimum swipe distance (px) */
const PREVIEW_LANDSCAPE_GESTURE_MIN_PX = 36;
/** Landscape fullscreen gesture: the main axis must clearly exceed the cross axis */
const PREVIEW_LANDSCAPE_GESTURE_DOMINANCE_RATIO = 1.25;
/** Landscape fullscreen gesture: seek milliseconds per px of a left/right swipe on the picture */
const PREVIEW_LANDSCAPE_GESTURE_SEEK_MS_PER_PX = 80;
/** Landscape fullscreen gesture: seek limit of a single gesture (ms) */
const PREVIEW_LANDSCAPE_GESTURE_SEEK_MAX_MS = 120_000;
/** Landscape fullscreen gesture: volume change per step of an up/down swipe on the picture (px) */
const PREVIEW_LANDSCAPE_GESTURE_VOLUME_PX_PER_STEP = 40;

type SlideTransitionState = {
  key: number;
  fromSlide: SlideElement;
  fromTime: number;
  toSlideId: string;
  transition: Transition;
  direction: 1 | -1;
  /** Hyperframes seek capture: 0–1 progress within the transition window. */
  seekProgress?: number;
};

// ---------- helpers ----------

const genId = (prefix: string): string => {
  const rand =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}_${rand}`;
};

const genUuid = (): string => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const applyHtmlMediaPlaybackRate = (media: HTMLMediaElement, rate: number): void => {
  try {
    media.playbackRate = Math.max(0.1, rate);
  } catch {
    /* noop */
  }
};

const transitionBetweenSlides = (
  scene: Scene,
  fromIndex: number,
  toIndex: number,
): Transition => {
  if (Math.abs(toIndex - fromIndex) !== 1) return "none";
  return scene.transitions[Math.min(fromIndex, toIndex)] ?? "none";
};

const previewTransitionDirection = (
  transition: Transition,
  direction: 1 | -1,
): "left" | "right" | "up" | "down" | null => {
  const invert = (value: "left" | "right" | "up" | "down"): "left" | "right" | "up" | "down" => {
    if (value === "left") return "right";
    if (value === "right") return "left";
    if (value === "up") return "down";
    return "up";
  };
  const base = transition.endsWith("_left")
    ? "left"
    : transition.endsWith("_right")
      ? "right"
      : transition.endsWith("_up")
        ? "up"
        : transition.endsWith("_down")
          ? "down"
          : null;
  if (!base) return null;
  return direction === 1 ? base : invert(base);
};

const oppositeTransitionDirection = (
  direction: "left" | "right" | "up" | "down",
): "left" | "right" | "up" | "down" => {
  if (direction === "left") return "right";
  if (direction === "right") return "left";
  if (direction === "up") return "down";
  return "up";
};

const getPreviewTransitionLayerStyle = (
  transition: Transition,
  role: "from" | "to",
  direction: 1 | -1,
): CSSProperties => {
  const duration = `${TRANSITION_MS}ms`;
  const fillMode = "both";
  if (transition === "fade") {
    return role === "to"
      ? { animation: `previewFadeIn ${duration} ease-out ${fillMode}` }
      : {};
  }
  if (transition === "cross_fade") {
    return {
      animation:
        role === "to"
          ? `previewFadeIn ${duration} ease-out ${fillMode}`
          : `previewFadeOut ${duration} ease-out ${fillMode}`,
    };
  }
  if (transition === "dissolve") {
    return role === "to"
      ? { animation: `previewDissolveIn ${duration} steps(12, end) ${fillMode}` }
      : { animation: `previewDissolveOut ${duration} steps(12, end) ${fillMode}` };
  }
  if (transition === "zoom_in") {
    return {
      animation:
        role === "to"
          ? `previewZoomInTo ${duration} ease-out ${fillMode}`
          : `previewZoomInFrom ${duration} ease-out ${fillMode}`,
    };
  }
  if (transition === "zoom_out") {
    return {
      animation:
        role === "to"
          ? `previewZoomOutTo ${duration} ease-out ${fillMode}`
          : `previewZoomOutFrom ${duration} ease-out ${fillMode}`,
    };
  }
  if (transition.startsWith("push_")) {
    const outDirection = previewTransitionDirection(transition, direction);
    if (!outDirection) return {};
    const inDirection = oppositeTransitionDirection(outDirection);
    return {
      animation:
        role === "to"
          ? `previewPushIn${inDirection} ${duration} ease-out ${fillMode}`
          : `previewPushOut${outDirection} ${duration} ease-out ${fillMode}`,
    };
  }
  if (transition.startsWith("wipe_")) {
    const wipeDirection = previewTransitionDirection(transition, direction);
    if (!wipeDirection || role === "from") return {};
    return { animation: `previewWipeIn${wipeDirection} ${duration} ease-out ${fillMode}` };
  }
  return {};
};

const applyOpacityToHexColor = (hexColor: string, opacity: number): string => {
  const matched = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hexColor.trim());
  if (!matched) return hexColor;
  const [, rHex, gHex, bHex] = matched;
  const r = Number.parseInt(rHex, 16);
  const g = Number.parseInt(gHex, 16);
  const b = Number.parseInt(bHex, 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(opacity, 0, 1)})`;
};

interface HighlightRegion {
  highlight: ElementHighlight;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  opacityMultiplier: number;
}

const getActiveHighlightRegions = (slide: SlideElement, time: number): HighlightRegion[] =>
  slide.children_elements.flatMap((element) => {
    if (!isElementVisibleAtTimeInSlide(element, time, slide)) return [];
    const transform = interpolateElementTransformInSlide(element, time, slide);
    return getElementHighlightSegments(element)
      .filter(
        (highlight) =>
          isElementHighlightActiveAtTime(highlight, time) ||
          (time > highlight.end_at && time <= highlight.end_at + HIGHLIGHT_TRANSITION_MS),
      )
      .map((highlight) => {
        const entering = time < highlight.start_at + HIGHLIGHT_TRANSITION_MS;
        const exiting = time > highlight.end_at;
        const enterProgress = clamp(
          (time - highlight.start_at) / HIGHLIGHT_TRANSITION_MS,
          0,
          1,
        );
        const exitProgress = clamp(
          (time - highlight.end_at) / HIGHLIGHT_TRANSITION_MS,
          0,
          1,
        );
        const scale = entering && !exiting ? 1.5 - 0.5 * enterProgress : 1;
        const opacityMultiplier = exiting
          ? 1 - exitProgress
          : entering
            ? enterProgress
            : 1;
        const padding = highlight.padding_px;
        const baseWidth = transform.size.width + padding * 2;
        const baseHeight = transform.size.height + padding * 2;
        const cx = transform.position.x + transform.size.width / 2;
        const cy = transform.position.y + transform.size.height / 2;
        const x = clamp(cx - (baseWidth * scale) / 2, 0, SLIDE_LOGICAL_WIDTH);
        const y = clamp(cy - (baseHeight * scale) / 2, 0, SLIDE_LOGICAL_HEIGHT);
        const right = clamp(cx + (baseWidth * scale) / 2, 0, SLIDE_LOGICAL_WIDTH);
        const bottom = clamp(cy + (baseHeight * scale) / 2, 0, SLIDE_LOGICAL_HEIGHT);
        return {
          highlight,
          x,
          y,
          width: Math.max(0, right - x),
          height: Math.max(0, bottom - y),
          zIndex: element.style.z_index,
          opacityMultiplier,
        };
      });
  });

const roundedRectPath = (
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): string => {
  const r = clamp(radius, 0, Math.min(width, height) / 2);
  const right = x + width;
  const bottom = y + height;
  if (r <= 0) return `M${x} ${y}H${right}V${bottom}H${x}Z`;
  return [
    `M${x + r} ${y}`,
    `H${right - r}`,
    `A${r} ${r} 0 0 1 ${right} ${y + r}`,
    `V${bottom - r}`,
    `A${r} ${r} 0 0 1 ${right - r} ${bottom}`,
    `H${x + r}`,
    `A${r} ${r} 0 0 1 ${x} ${bottom - r}`,
    `V${y + r}`,
    `A${r} ${r} 0 0 1 ${x + r} ${y}`,
    "Z",
  ].join("");
};

type DecodedLipSyncBuffer = { data: Float32Array; sampleRate: number };

let sharedDecodeContextRef: AudioContext | null = null;
const getDecodeAudioContext = (): AudioContext | null => {
  if (typeof window === "undefined") return null;
  if (sharedDecodeContextRef && sharedDecodeContextRef.state !== "closed") {
    return sharedDecodeContextRef;
  }
  try {
    const Ctor =
      window.AudioContext ||
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    sharedDecodeContextRef = new Ctor();
    return sharedDecodeContextRef;
  } catch {
    return null;
  }
};

const lipSyncBufferCache = new Map<string, DecodedLipSyncBuffer>();
const lipSyncBufferLoading = new Map<string, Promise<DecodedLipSyncBuffer | null>>();

const loadLipSyncBuffer = (url: string): Promise<DecodedLipSyncBuffer | null> => {
  const resolvedUrl = resolveNarrationSegmentPlaybackUrl(url.trim()) || url.trim();
  if (!resolvedUrl) return Promise.resolve(null);
  const cached = lipSyncBufferCache.get(resolvedUrl);
  if (cached) return Promise.resolve(cached);
  const pending = lipSyncBufferLoading.get(resolvedUrl);
  if (pending) return pending;
  const ctx = getDecodeAudioContext();
  if (!ctx) return Promise.resolve(null);
  const promise = (async (): Promise<DecodedLipSyncBuffer | null> => {
    try {
      const res = await fetch(resolvedUrl, { mode: "cors", credentials: "omit" });
      if (!res.ok) return null;
      const arrayBuffer = await res.arrayBuffer();
      const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
        try {
          const maybePromise = ctx.decodeAudioData(
            arrayBuffer,
            (buf) => resolve(buf),
            (err) => reject(err),
          );
          if (maybePromise && typeof (maybePromise as Promise<AudioBuffer>).then === "function") {
            (maybePromise as Promise<AudioBuffer>).then(resolve, reject);
          }
        } catch (err) {
          reject(err);
        }
      });
      const result: DecodedLipSyncBuffer = {
        data: new Float32Array(decoded.getChannelData(0)),
        sampleRate: decoded.sampleRate,
      };
      lipSyncBufferCache.set(resolvedUrl, result);
      return result;
    } catch {
      return null;
    } finally {
      lipSyncBufferLoading.delete(resolvedUrl);
    }
  })();
  lipSyncBufferLoading.set(resolvedUrl, promise);
  return promise;
};

const LIP_SYNC_WINDOW_SAMPLES = 1024;

const computeLipSyncMouthFromBuffer = (buf: DecodedLipSyncBuffer, offsetSec: number): number => {
  const sampleIdx = Math.max(0, Math.floor(offsetSec * buf.sampleRate));
  const halfWindow = LIP_SYNC_WINDOW_SAMPLES >> 1;
  const start = Math.max(0, sampleIdx - halfWindow);
  const end = Math.min(buf.data.length, start + LIP_SYNC_WINDOW_SAMPLES);
  let sum = 0;
  const len = end - start;
  if (len > 0) {
    for (let i = start; i < end; i += 1) {
      const v = buf.data[i];
      sum += v * v;
    }
  }
  const rms = len > 0 ? Math.sqrt(sum / len) : 0;
  return clamp(Math.min(Math.max(rms * 8, 0.1), 1), 0, 1);
};

const narrationAudioPreloadCache = new Map<string, Promise<void>>();
const narrationAudioPreloadLinks = new Set<string>();

const preloadNarrationAudioUrls = (urls: string[]): void => {
  if (typeof window === "undefined") return;
  for (const rawUrl of urls) {
    const url = rawUrl.trim();
    if (!url) continue;
    if (!narrationAudioPreloadLinks.has(url)) {
      try {
        const link = document.createElement("link");
        link.rel = "preload";
        link.as = "audio";
        link.href = url;
        link.crossOrigin = "anonymous";
        document.head.appendChild(link);
        narrationAudioPreloadLinks.add(url);
      } catch {
        // Preloading is opportunistic; playback still handles loading failures.
      }
    }
    if (!narrationAudioPreloadCache.has(url)) {
      const promise = fetch(url, { mode: "cors", credentials: "omit", cache: "force-cache" })
        .then(async (res) => {
          if (res.ok) await res.arrayBuffer();
        })
        .catch(() => {
          // Preloading is opportunistic; playback still handles loading failures.
        });
      narrationAudioPreloadCache.set(url, promise);
      void promise;
    }
    void loadLipSyncBuffer(url);
  }
};

const slideMediaPreloadLinkKeys = new Set<string>();

/** Opportunistically preload raster / video URLs that will appear soon on the slide timeline (preview only). */
function preloadUpcomingSlideMediaUrls(slide: SlideElement, currentTimeMs: number): void {
  if (typeof window === "undefined") return;
  const LAHEAD_MS = 25_000;
  const windowEnd = currentTimeMs + LAHEAD_MS;
  const touch = (as: "image" | "video", href: string): void => {
    const key = `${as}:${href}`;
    if (slideMediaPreloadLinkKeys.has(key)) return;
    slideMediaPreloadLinkKeys.add(key);
    try {
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = as;
      link.href = href;
      document.head.appendChild(link);
    } catch {
      /* best-effort */
    }
  };

  const bg = slide.background_image_url?.trim();
  if (bg) touch("image", bg);

  for (const el of slide.children_elements) {
    const t0 = el.timeline.start_at;
    if (t0 <= currentTimeMs || t0 > windowEnd) continue;
    if (el.element_type === "image") {
      const src = (el as ImageElement).source?.trim() ?? "";
      if (!src) continue;
      touch("image", src);
    } else if (el.element_type === "video") {
      const src = (el as VideoElement).source?.trim() ?? "";
      if (!src) continue;
      touch("video", src);
    }
  }
}

/** Slide background image: the timeline pauses during playback until it finishes decoding. */
function PreviewSlideBackgroundPlaybackGate({
  url,
  onLoadingChange,
}: {
  url: string;
  onLoadingChange: (loading: boolean) => void;
}): null {
  useEffect(() => {
    const href = url.trim();
    if (!href) {
      onLoadingChange(false);
      return;
    }
    const img = new Image();
    onLoadingChange(true);
    const done = (): void => onLoadingChange(false);
    img.addEventListener("load", done);
    img.addEventListener("error", done);
    img.src = href;
    if (img.complete && img.naturalWidth > 0) done();
    return () => {
      img.removeEventListener("load", done);
      img.removeEventListener("error", done);
      onLoadingChange(false);
    };
  }, [url, onLoadingChange]);
  return null;
}

/** The hidden track of the quiz "question narration": the same RMS lip sync as {@link NarrationRenderer}. */
function PreviewQuizContentNarrationLipSyncDriver({
  audioRef,
  target,
  onLipSyncValueChange,
}: {
  audioRef: RefObject<HTMLAudioElement | null>;
  target: { url: string; vtuberElementId: string } | null;
  onLipSyncValueChange: (vtuberElementId: string, value: number) => void;
}): null {
  const lipSyncFrameRef = useRef<number | null>(null);
  const lipSyncBufferRef = useRef<DecodedLipSyncBuffer | null>(null);
  const mouthCurrentRef = useRef(0);

  useEffect(() => {
    const vtuberElementId = target?.vtuberElementId?.trim() ?? "";
    const src = target?.url?.trim() ?? "";
    if (!target || !src || !vtuberElementId) {
      if (lipSyncFrameRef.current !== null) {
        cancelAnimationFrame(lipSyncFrameRef.current);
        lipSyncFrameRef.current = null;
      }
      mouthCurrentRef.current = 0;
      return;
    }

    const stopLipSync = (): void => {
      if (lipSyncFrameRef.current !== null) {
        cancelAnimationFrame(lipSyncFrameRef.current);
        lipSyncFrameRef.current = null;
      }
      mouthCurrentRef.current = 0;
      onLipSyncValueChange(vtuberElementId, 0);
    };

    lipSyncBufferRef.current = null;
    let cancelled = false;
    const resolveDecodeUrl = (): string => {
      const el = audioRef.current;
      return (el?.currentSrc || el?.src || src || "").trim() || src;
    };
    const kickDecode = (): void => {
      const u = resolveDecodeUrl();
      if (!u) return;
      void loadLipSyncBuffer(u).then((buf) => {
        if (cancelled) return;
        lipSyncBufferRef.current = buf;
      });
    };
    kickDecode();
    const elAttach = audioRef.current;
    const onAudioReady = (): void => {
      kickDecode();
    };
    elAttach?.addEventListener("loadedmetadata", onAudioReady);
    elAttach?.addEventListener("canplay", onAudioReady);

    const LERP_FACTOR = 0.8;
    const WINDOW_SAMPLES = 1024;
    const updateMouth = (): void => {
      const currentAudio = audioRef.current;
      const buf = lipSyncBufferRef.current;
      if (
        !currentAudio ||
        currentAudio.paused ||
        currentAudio.ended ||
        (Number.isFinite(currentAudio.duration) &&
          currentAudio.duration > 0 &&
          currentAudio.currentTime >= currentAudio.duration - 0.02)
      ) {
        onLipSyncValueChange(vtuberElementId, 0);
        mouthCurrentRef.current = 0;
        lipSyncFrameRef.current = requestAnimationFrame(updateMouth);
        return;
      }
      if (!buf) {
        lipSyncFrameRef.current = requestAnimationFrame(updateMouth);
        return;
      }
      const sampleIdx = Math.max(0, Math.floor(currentAudio.currentTime * buf.sampleRate));
      const halfWindow = WINDOW_SAMPLES >> 1;
      const start = Math.max(0, sampleIdx - halfWindow);
      const end = Math.min(buf.data.length, start + WINDOW_SAMPLES);
      let sum = 0;
      const len = end - start;
      if (len > 0) {
        for (let i = start; i < end; i += 1) {
          const v = buf.data[i];
          sum += v * v;
        }
      }
      const rms = len > 0 ? Math.sqrt(sum / len) : 0;
      const targetMouthSyncValue = Math.min(Math.max(rms * 8, 0.1), 1);
      mouthCurrentRef.current += (targetMouthSyncValue - mouthCurrentRef.current) * LERP_FACTOR;
      const naturalVariation = (Math.random() - 0.5) * 0.05;
      const finalValue = Math.max(0, Math.min(1, mouthCurrentRef.current + naturalVariation));
      onLipSyncValueChange(vtuberElementId, finalValue);
      lipSyncFrameRef.current = requestAnimationFrame(updateMouth);
    };
    lipSyncFrameRef.current = requestAnimationFrame(updateMouth);

    return () => {
      cancelled = true;
      elAttach?.removeEventListener("loadedmetadata", onAudioReady);
      elAttach?.removeEventListener("canplay", onAudioReady);
      stopLipSync();
    };
  }, [audioRef, target, onLipSyncValueChange]);

  return null;
}

const decodeBase64ToUtf8 = (value: string): string => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

const parseSceneFromBase64 = (base64Data: string): Scene => {
  const jsonText = decodeBase64ToUtf8(base64Data);
  const parsed = JSON.parse(jsonText) as Scene;
  return deserializeScene(parsed);
};

const parseSceneFromSerialized = (serialized: unknown): Scene => {
  return deserializeScene(serialized as Scene);
};

const shouldAutoPlayOnSceneLoad = (): boolean => {
  if (typeof window === "undefined") return false;
  return window.parent !== window;
};

/** Still cover frame: the time with the densest elements (stage rendering only, not driving the progress bar). */
const resolvePreviewIdleSlideLocalTime = (slide: SlideElement | undefined): number => {
  if (!slide) return 0;
  return clampSlideLocalSnapshotTime(slide);
};

const normalizeInitialSlideIndex = (value: unknown, slideCount: number): number => {
  const index =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : 0;
  if (!Number.isFinite(index) || slideCount <= 0) return 0;
  return clamp(Math.trunc(index), 0, slideCount - 1);
};

/** Embedded editor preview: honor `slideIndex` from iframe URL when postMessage omits it. */
const resolvePostLoadSlideIndex = (
  initialSlideIndex: number | undefined,
  slideCount: number,
): number => {
  if (typeof initialSlideIndex === "number") {
    return normalizeInitialSlideIndex(initialSlideIndex, slideCount);
  }
  if (typeof window !== "undefined" && window.parent !== window) {
    const fromUrl = new URLSearchParams(window.location.search).get("slideIndex");
    if (fromUrl !== null) {
      return normalizeInitialSlideIndex(fromUrl, slideCount);
    }
  }
  return 0;
};

interface PreviewStorageScene {
  scene: Scene;
  revision: string | null;
  htmlIframeLayoutScale?: number;
}

const readSceneFromPreviewStorage = async (
  id: string,
  t: CoursewareTranslateFn,
): Promise<PreviewStorageScene> => {
  const parsed = await readPreviewSceneBundle(makePreviewStorageKey(id));
  if (!parsed) throw new Error(t("coursewarePreview.errors.previewDataNotFound", { id }));
  if (!("scene" in parsed)) {
    throw new Error(t("coursewarePreview.errors.invalidPreviewData"));
  }
  return {
    scene: parseSceneFromSerialized(parsed.scene),
    revision: typeof parsed.revision === "string" ? parsed.revision : null,
    htmlIframeLayoutScale:
      typeof parsed.htmlIframeLayoutScale === "number" &&
      Number.isFinite(parsed.htmlIframeLayoutScale) &&
      parsed.htmlIframeLayoutScale > 0
        ? parsed.htmlIframeLayoutScale
        : undefined,
  };
};

const previewLoadsRemoteCoursewareOnly = (): boolean => {
  if (typeof window === "undefined") return false;
  const search = new URLSearchParams(window.location.search);
  return Boolean(search.get("courseware_id")?.trim()) && !search.get("id") && !search.get("data");
};

/** When the preview is opened standalone (only `courseware_id`), fetch the scene from the courseware service. */
const loadSceneFromRemoteCourseware = async (
  coursewareId: string,
  t: CoursewareTranslateFn,
): Promise<Scene> => {
  if (!isCoursewareApiConfigured()) {
    throw new Error(t("coursewarePreview.errors.serviceNotConfigured"));
  }
  // Carry the section context so enrolled non-members (public-course external
  // students) pass the courseware-service read gate (issue #825).
  const sectionContext = readCoursewarePreviewSectionContext();
  const remote = await coursewareAgentApi.getCourseware(coursewareId, undefined, {
    sectionId: sectionContext?.sectionId,
  });
  const access = evaluateCoursewareRemoteAccess(remote, { lockWhenNotPublic: false });
  if (access.kind === "locked") {
    await clearCoursewareEditorLocalDraft(coursewareId);
    throw new CoursewareAccessForbiddenError(access.error ?? "Forbidden");
  }
  if (access.kind !== "ok") {
    throw new Error(
      access.error ??
        t("coursewarePreview.errors.notFoundOnServer", { coursewareId }),
    );
  }
  return applyCoursewareApiTitleToScene(
    dedupeSceneElementIds(deserializeScene(access.courseware.content)),
    access.courseware.title,
  );
};

const formatTimeMs = (ms: number): string => {
  const clamped = Math.max(0, ms);
  const total = Math.floor(clamped / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

type PreviewActionHintState =
  | { kind: "seek"; timeMs: number; deltaMs: number }
  | { kind: "volume"; percent: number }
  | { kind: "quiz_required" };

type PreviewActionHintPhase = "visible" | "exiting";

const getSlidePlaybackDurationMs = (slide: SlideElement): number =>
  Math.max(1, slide.timeline.end_at - slide.timeline.start_at);

const getSlideDurationsMs = (slides: SlideElement[]): number[] =>
  slides.map((s) => getSlidePlaybackDurationMs(s));

const getSceneTotalDurationMs = (slides: SlideElement[]): number => {
  const durations = getSlideDurationsMs(slides);
  if (durations.length === 0) return 1;
  return Math.max(1, durations.reduce((acc, d) => acc + d, 0));
};

const getSceneSlideOffsetMs = (slides: SlideElement[], slideIndex: number): number => {
  let acc = 0;
  for (let i = 0; i < slideIndex; i += 1) {
    const s = slides[i];
    if (!s) continue;
    acc += getSlidePlaybackDurationMs(s);
  }
  return acc;
};

type SceneTimeLocation = { slideIndex: number; localTimeMs: number };

/** Map a whole-scene time (ms) to the slide number + slide-local time. */
const resolveSceneTimeMs = (slides: SlideElement[], sceneTimeMs: number): SceneTimeLocation => {
  const n = slides.length;
  if (n === 0) return { slideIndex: 0, localTimeMs: 0 };
  let remaining = Math.max(0, sceneTimeMs);
  for (let i = 0; i < n; i += 1) {
    const dur = getSlidePlaybackDurationMs(slides[i]!);
    if (remaining < dur || i === n - 1) {
      return { slideIndex: i, localTimeMs: clamp(remaining, 0, dur) };
    }
    remaining -= dur;
  }
  const last = n - 1;
  return {
    slideIndex: last,
    localTimeMs: getSlidePlaybackDurationMs(slides[last]!),
  };
};

const getScenePlayheadMs = (
  slides: SlideElement[],
  slideIndex: number,
  localTimeMs: number,
): number => getSceneSlideOffsetMs(slides, slideIndex) + localTimeMs;

type PreviewSlideBoundaryMarker = {
  /** Position ratio on the progress bar (0–1) */
  ratio: number;
  /** The slide number at this switch point (from 0) */
  slideIndex: number;
  /** The slide switch moment on the whole-scene timeline (ms) */
  sceneTimeMs: number;
};

/** Switch points of each slide (from slide 2; excluding 0 and 100%). */
const getSlideBoundaryMarkers = (slides: SlideElement[]): PreviewSlideBoundaryMarker[] => {
  const durations = getSlideDurationsMs(slides);
  const total = Math.max(1, durations.reduce((acc, d) => acc + d, 0));
  const markers: PreviewSlideBoundaryMarker[] = [];
  let acc = 0;
  for (let i = 1; i < durations.length; i += 1) {
    acc += durations[i - 1]!;
    markers.push({
      ratio: clamp(acc / total, 0, 1),
      slideIndex: i,
      sceneTimeMs: acc,
    });
  }
  return markers;
};

type PendingPreviewSlideSeek = {
  localTimeMs: number;
  resumePlayback: boolean;
};

// ---------- scene factory ----------

const emptyBase = {
  html: "",
  fps: 30,
  enter_effect: "none" as const,
  exit_effect: "none" as const,
  animations: [],
  event_bindings: [],
  action_mappings: {},
  event_scripts: {},
  preset_script: "",
};

/** Avoids crashing when `slide_elements` is empty or the index is temporarily out of range (e.g. corrupted JSON, an index during a race). */
const buildEmptyPreviewSlide = (t: CoursewareTranslateFn): SlideElement => ({
  element_type: "slide",
  element_id: "preview_fallback_slide",
  name: t("coursewarePreview.meta.fallbackSlideName"),
  ...emptyBase,
  position: { x: 0, y: 0 },
  size: { width: SLIDE_LOGICAL_WIDTH, height: SLIDE_LOGICAL_HEIGHT },
  timeline: { start_at: 0, end_at: DEFAULT_DURATION_MS },
  style: { opacity: 1, rotation_deg: 0, z_index: 0 },
  keyframes: [],
  metadata: {},
  background_color: "#f0f0ed",
  children_elements: [],
});

const buildShowcaseScene = (t: CoursewareTranslateFn): Scene => {
  return deserializeScene({
    scene_id: genId("sc"),
    name: t("coursewarePreview.meta.blankSceneName"),
    controller: {
      play: true,
      next: true,
      back: true,
      seekBar: true,
      time: true,
      slideNumber: true,
      volume: true,
      fullScreen: true,
      brand: true,
      playbackRate: true,
    },
    transitions: [],
    preset_script: "",
    metadata: { demo: true },
    slide_elements: [],
    vtuber_elements: [],
  });
};

// ---------- root component ----------

type AssistantTab = "curriculum" | "materials" | "history";

const ASSISTANT_TABS: AssistantTab[] = ["history", "curriculum", "materials"];

const ASSISTANT_PANEL_MIN_WIDTH_PX = 360;
const ASSISTANT_PANEL_MAX_WIDTH_RATIO = 0.7;

function getAssistantPanelWidthBounds(containerWidth: number): { min: number; max: number } {
  const max = Math.floor(containerWidth * ASSISTANT_PANEL_MAX_WIDTH_RATIO);
  const min = Math.min(ASSISTANT_PANEL_MIN_WIDTH_PX, containerWidth);
  return { min, max: Math.max(min, max) };
}

function clampAssistantPanelWidth(width: number, containerWidth: number): number {
  const { min, max } = getAssistantPanelWidthBounds(containerWidth);
  return clamp(width, min, max);
}

/** Same as player: with a course context, exit by the source page instead of relying only on browser history. */
const resolvePreviewExitHref = (
  sectionContext: CoursewarePreviewSectionContext | null,
): string | null => {
  if (!sectionContext) return null;
  if (sectionContext.fromTrial || sectionContext.fromPublic) {
    return `/public-course/${sectionContext.courseId}`;
  }
  return sectionContext.from === "personal" ? "/personal-dashboard" : "/my-courses";
};

type AssistantMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  blocks?: CoursewareAiAssistantBlock[];
  timestampMs: number;
  isStreaming?: boolean;
};

const ASSISTANT_CHAT_TIME_GAP_MS = 30 * 60 * 1000;

type AssistantChatRenderItem =
  | { kind: "time-divider"; id: string; label: string }
  | { kind: "message"; message: AssistantMessage };

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatAssistantChatTimeDivider(
  timestampMs: number,
  t: CoursewareTranslateFn,
): string {
  const date = new Date(timestampMs);
  const now = new Date();
  const timeStr = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  if (isSameCalendarDay(date, now)) {
    return `${t("coursewarePreview.assistant.today")} ${timeStr}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameCalendarDay(date, yesterday)) {
    return `${t("coursewarePreview.assistant.yesterday")} ${timeStr}`;
  }

  const dateStr = date.toLocaleDateString(undefined, {
    month: "numeric",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
  return `${dateStr} ${timeStr}`;
}

function buildAssistantChatRenderItems(
  messages: AssistantMessage[],
  t: CoursewareTranslateFn,
): AssistantChatRenderItem[] {
  const items: AssistantChatRenderItem[] = [];
  let prevTimestampMs: number | null = null;

  for (const message of messages) {
    const shouldShowDivider =
      prevTimestampMs === null ||
      message.timestampMs - prevTimestampMs >= ASSISTANT_CHAT_TIME_GAP_MS;

    if (shouldShowDivider) {
      items.push({
        kind: "time-divider",
        id: `divider-${message.id}`,
        label: formatAssistantChatTimeDivider(message.timestampMs, t),
      });
    }

    items.push({ kind: "message", message });
    prevTimestampMs = message.timestampMs;
  }

  return items;
}

function parseHistoryMessageTimestampMs(
  message: CoursewareAgentConversationHistoryMessage,
  fallbackMs: number,
): number {
  const raw = message.created_at;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 1e12 ? raw : raw * 1000;
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallbackMs;
}

function buildPreviewAssistantWelcomeMessage(
  t: CoursewareTranslateFn,
): AssistantMessage {
  return {
    id: "assistant-welcome",
    role: "assistant",
    text: t("coursewarePreview.assistant.welcome"),
    timestampMs: Date.now(),
  };
}

function mapInteractionHistoryToAssistantMessages(
  history: NonNullable<InteractionConversationHistoryResult["messages"]>,
): AssistantMessage[] {
  const seen = new Set<string>();
  const out: AssistantMessage[] = [];
  const now = Date.now();
  for (let index = 0; index < history.length; index += 1) {
    const message = history[index];
    const id =
      typeof message.id === "string" && message.id.trim() ? message.id.trim() : `hist_${out.length}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const fallbackMs = now - (history.length - 1 - index) * 60_000;
    out.push({
      id,
      role: message.role,
      text: typeof message.content === "string" ? message.content : "",
      ...(message.blocks && message.blocks.length > 0 ? { blocks: message.blocks } : {}),
      timestampMs: parseHistoryMessageTimestampMs(message, fallbackMs),
    });
  }
  return out;
}

function buildPreviewAssistantSlideContext(
  sceneName: string,
  slideIndex: number,
  slideCount: number,
  slideName: string,
): string {
  const idx = slideCount === 0 ? 0 : slideIndex + 1;
  const total = Math.max(slideCount, 1);
  const name = slideName.trim() || `Slide ${idx}`;
  const title = sceneName.trim();
  return [
    title ? `Courseware: ${title}` : undefined,
    `Current slide: ${idx}/${total} — ${name}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Runtime state of a single question. Under the new model:
 *   - `selectedOptionIds` holds `QuizChoiceOption.option_id` directly
 *   - `inputValues` is keyed by `blank_id` (fill_blank) or `"answer"` (essay/speech)
 *   - recordings now sync into `inputValues.recording_blob_url` / `recording_duration_sec` etc.
 *     so `<QuizShadowingControl>` can read them itself
 */
type QuizQuestionState = {
  selectedOptionIds: Set<string>;
  inputValues: Record<string, string>;
  /** Name of the input field being recorded (for shadowing/speech); null means not recording. */
  recordingFieldName: string | null;
  recordingElapsedSec: number;
  recordedBlobUrl: string | null;
  recordedDurationSec: number;
  submitted: boolean;
  /** Optional question: skipped without an answer (not stored) */
  skipped?: boolean;
  isSubmitting: boolean;
  score: number | null;
  feedback: string | null;
  feedback_detail?: Record<string, unknown> | null;
  canAdvance: boolean;
};

const createEmptyQuizQuestionState = (): QuizQuestionState => ({
  selectedOptionIds: new Set<string>(),
  inputValues: {},
  recordingFieldName: null,
  recordingElapsedSec: 0,
  recordedBlobUrl: null,
  recordedDurationSec: 0,
  submitted: false,
  isSubmitting: false,
  score: null,
  feedback: null,
  feedback_detail: null,
  canAdvance: false,
});

const getQuestionConfig = (
  quiz: QuizConfig | null | undefined,
  quizEl: QuizSlideElement,
): QuizQuestion | null => {
  if (!quiz?.enabled) return null;
  return getQuestionForLayoutPreview(quiz, quizEl);
};

/** Layout / WYSIWYG preview — does not require `quiz.enabled`. */
const getQuestionForLayoutPreview = (
  quiz: QuizConfig | null | undefined,
  quizEl: QuizSlideElement,
): QuizQuestion | null => {
  if (!quiz) return null;
  return quiz.questions.find((question) => question.question_id === quizEl.quiz_question_id) ?? null;
};

const buildLayoutPreviewQuizContext = (
  quizEl: QuizSlideElement,
  question: QuizQuestion,
): PreviewQuizContext => ({
  quizElementId: quizEl.element_id,
  question,
  state: createEmptyQuizQuestionState(),
  onToggleOption: () => {},
  onSubmit: () => {},
  onSetInput: () => {},
  onToggleRecord: () => {},
});

/** Pause only after intro opacity ramps finish so timeline keeps advancing during fade-in. */
const isQuestionBlockingPlaybackAtTime = (
  slide: SlideElement,
  quizEl: QuizSlideElement,
  currentTime: number,
): boolean => {
  if (!isElementVisibleAtTime(quizEl, currentTime)) return false;
  const pauseFrom = getQuizQuestionPlaybackPauseStartAt(slide, quizEl);
  return currentTime >= pauseFrom;
};

const getActiveQuizQuestion = (
  slide: SlideElement,
  quiz: QuizConfig | null | undefined,
  currentTime: number,
  quizState: Record<string, QuizQuestionState> = {},
): QuizSlideElement | null => {
  for (const element of slide.children_elements) {
    if (element.element_type !== "quiz") continue;
    const quizEl = element as QuizSlideElement;
    if (!getQuestionConfig(quiz, quizEl)) continue;
    if (quizState[quizEl.element_id]?.submitted) continue;
    if (isQuestionBlockingPlaybackAtTime(slide, quizEl, currentTime)) return quizEl;
  }
  return null;
};

/** The first quiz on this slide not yet submitted or skipped (regardless of whether the interaction point was reached). */
const firstUnfinishedQuizWrapperOnSlide = (
  slide: SlideElement,
  quiz: QuizConfig | null | undefined,
  quizState: Record<string, QuizQuestionState>,
): QuizSlideElement | null => {
  for (const element of slide.children_elements) {
    if (element.element_type !== "quiz") continue;
    const quizEl = element as QuizSlideElement;
    if (!getQuestionConfig(quiz, quizEl)) continue;
    const st = quizState[quizEl.element_id];
    if (st?.submitted || st?.skipped) continue;
    return quizEl;
  }
  return null;
};

const QUIZ_GAP_EPS_MS = 1;

type UnfinishedQuizSeekTarget = {
  slideIndex: number;
  quizEl: QuizSlideElement;
  localPauseAt: number;
  sceneMs: number;
};

/**
 * If the target whole-scene time passes an unfinished quiz interaction point, return the first quiz in the scene that should be answered.
 * Scans by slide order + element order, consistent with where the playback clock stops.
 */
const findFirstUnfinishedQuizBeforeSceneTime = (
  slides: SlideElement[],
  quiz: QuizConfig | null | undefined,
  quizState: Record<string, QuizQuestionState>,
  targetSceneMs: number,
): UnfinishedQuizSeekTarget | null => {
  if (!quiz?.enabled) return null;
  for (let slideIndex = 0; slideIndex < slides.length; slideIndex += 1) {
    const slideEl = slides[slideIndex]!;
    for (const element of slideEl.children_elements) {
      if (element.element_type !== "quiz") continue;
      const quizEl = element as QuizSlideElement;
      if (!getQuestionConfig(quiz, quizEl)) continue;
      const st = quizState[quizEl.element_id];
      if (st?.submitted || st?.skipped) continue;
      const localPauseAt = getQuizQuestionPlaybackPauseStartAt(slideEl, quizEl);
      const sceneMs = getScenePlayheadMs(slides, slideIndex, localPauseAt);
      if (targetSceneMs > sceneMs + QUIZ_GAP_EPS_MS) {
        return { slideIndex, quizEl, localPauseAt, sceneMs };
      }
    }
  }
  return null;
};

/** Uploaded recording metadata for shadowing/speech AI scoring. */
type QuizRecordingUpload = {
  recording_id?: string | null;
  file_path: string;
  file_url: string;
  duration_sec: number;
} | null;

/**
 * Pack the host-managed quiz state into the API submission payload.
 *
 * Preview passes host `selection` into {@link QuizRenderer}; values below come from
 * `quizState` (including attempt-session reload sync).
 */
const buildQuizAnswerContent = (
  state: QuizQuestionState,
  question: QuizQuestion | null,
  recordingUpload: QuizRecordingUpload = null,
  /** When the host renders via {@link QuizRenderer}, selection lives in QuizContainer until submit. */
  selectedOptionIdsOverride?: readonly string[],
): CoursewareQuizAnswerContent => {
  let selectedOptionIndices: number[] = [];
  let values: string[] = [];

  if (question?.type === "single_choice" || question?.type === "multiple_choice") {
    const selected = selectedOptionIdsOverride
      ? new Set(selectedOptionIdsOverride)
      : state.selectedOptionIds;
    selectedOptionIndices = question.options
      .map((opt, idx) => (selected.has(opt.option_id) ? idx : -1))
      .filter((idx) => idx >= 0);
  }

  if (question?.type === "fill_blank") {
    values = question.blanks.map((b) => state.inputValues[b.blank_id] ?? "");
  } else if (question?.type === "essay" || question?.type === "speech") {
    values = [state.inputValues.answer ?? ""];
  }

  const base: CoursewareQuizAnswerContent = {
    selected_option_indices: selectedOptionIndices,
    values,
    value_by_member_id: state.inputValues,
    recording_member_id: state.recordingFieldName,
  };
  return recordingUpload
    ? {
        ...base,
        recording_id: recordingUpload.recording_id,
        recording_file_path: recordingUpload.file_path,
        recording_file_url: recordingUpload.file_url,
        recording_duration_sec: recordingUpload.duration_sec,
      }
    : base;
};

interface SceneMessagePayload {
  type: "courseware-preview:load-scene";
  previewId: string;
  slideIndex?: number;
}

interface PreviewControlMessagePayload {
  type: "courseware-preview:toggle-playback";
}

const isSceneMessagePayload = (payload: unknown): payload is SceneMessagePayload => {
  if (!payload || typeof payload !== "object") return false;
  const data = payload as Record<string, unknown>;
  return (
    data.type === "courseware-preview:load-scene" &&
    typeof data.previewId === "string" &&
    (data.slideIndex === undefined || typeof data.slideIndex === "number")
  );
};

const isPreviewControlMessagePayload = (payload: unknown): payload is PreviewControlMessagePayload => {
  if (!payload || typeof payload !== "object") return false;
  const data = payload as Record<string, unknown>;
  return data.type === "courseware-preview:toggle-playback";
};

const PREVIEW_PATHNAME = "/courseware-preview";

function isPointerInFullscreenChromeEdge(clientY: number): boolean {
  if (typeof window === "undefined") return false;
  return (
    clientY < PREVIEW_FULLSCREEN_CHROME_EDGE_TOP_PX ||
    clientY > window.innerHeight - PREVIEW_FULLSCREEN_CHROME_EDGE_BOTTOM_PX
  );
}

function useFullscreenChromeAutoHide(isFullscreen: boolean): {
  chromeVisible: boolean;
  revealChrome: () => void;
  hideChrome: () => void;
  onChromeHoverStart: () => void;
  onChromeHoverEnd: () => void;
} {
  const [chromeVisible, setChromeVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chromeHoverDepthRef = useRef(0);
  /** Whether the pointer was already within the top/bottom edge in the previous frame; set true on entering fullscreen, so a mouse already on the bottom bar doesn't expand it by mistake */
  const pointerWasInEdgeRef = useRef(false);

  const clearHideTimer = useCallback((): void => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback((): void => {
    if (chromeHoverDepthRef.current > 0) return;
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      setChromeVisible(false);
      pointerWasInEdgeRef.current = true;
      hideTimerRef.current = null;
    }, PREVIEW_FULLSCREEN_CHROME_IDLE_MS);
  }, [clearHideTimer]);

  const revealChrome = useCallback((): void => {
    if (!isFullscreen) return;
    setChromeVisible(true);
    scheduleHide();
  }, [isFullscreen, scheduleHide]);

  const hideChrome = useCallback((): void => {
    if (!isFullscreen) return;
    clearHideTimer();
    chromeHoverDepthRef.current = 0;
    pointerWasInEdgeRef.current = true;
    setChromeVisible(false);
  }, [clearHideTimer, isFullscreen]);

  const onChromeHoverStart = useCallback((): void => {
    if (!isFullscreen) return;
    chromeHoverDepthRef.current += 1;
    clearHideTimer();
    setChromeVisible(true);
  }, [clearHideTimer, isFullscreen]);

  const onChromeHoverEnd = useCallback((): void => {
    if (!isFullscreen) return;
    chromeHoverDepthRef.current = Math.max(0, chromeHoverDepthRef.current - 1);
    if (chromeHoverDepthRef.current === 0) {
      scheduleHide();
    }
  }, [isFullscreen, scheduleHide]);

  useLayoutEffect(() => {
    if (!isFullscreen) {
      clearHideTimer();
      chromeHoverDepthRef.current = 0;
      pointerWasInEdgeRef.current = false;
      setChromeVisible(true);
      return;
    }
    clearHideTimer();
    chromeHoverDepthRef.current = 0;
    pointerWasInEdgeRef.current = true;
    setChromeVisible(false);
    return clearHideTimer;
  }, [clearHideTimer, isFullscreen]);

  useEffect(() => {
    if (!isFullscreen || chromeVisible) return;

    const onPointerMove = (e: PointerEvent): void => {
      const inEdge = isPointerInFullscreenChromeEdge(e.clientY);
      if (inEdge && !pointerWasInEdgeRef.current) {
        revealChrome();
      }
      pointerWasInEdgeRef.current = inEdge;
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, [chromeVisible, isFullscreen, revealChrome]);

  return { chromeVisible, revealChrome, hideChrome, onChromeHoverStart, onChromeHoverEnd };
}

function useLandscapeButtonAutoHide(active: boolean): {
  buttonVisible: boolean;
  revealButton: () => void;
} {
  const [buttonVisible, setButtonVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimer = useCallback((): void => {
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback((): void => {
    clearHideTimer();
    if (!active) return;
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      setButtonVisible(false);
    }, PREVIEW_LANDSCAPE_BUTTON_IDLE_MS);
  }, [active, clearHideTimer]);

  const revealButton = useCallback((): void => {
    if (!active) return;
    setButtonVisible(true);
    scheduleHide();
  }, [active, scheduleHide]);

  useEffect(() => {
    if (!active) {
      clearHideTimer();
      setButtonVisible(true);
      return;
    }
    setButtonVisible(true);
    scheduleHide();
    return clearHideTimer;
  }, [active, clearHideTimer, scheduleHide]);

  return { buttonVisible, revealButton };
}

function isPreviewGestureIgnoredTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      "button, a, input, textarea, select, video, label, [role='button'], [role='slider'], iframe, [data-preview-skip-fullscreen], [data-quiz-container], [data-quiz-input], [data-quiz-action], [data-quiz-slot]",
    ),
  );
}

/**
 * After preview-player-shell rotates 90° clockwise, pointer events are still in screen coordinates.
 * "Left/right" forward/back on the picture ↔ up/down on the screen; "up/down" volume on the picture ↔ left/right on the screen.
 */
function mapForceLandscapeGestureDeltas(
  screenDx: number,
  screenDy: number,
): {
  seekAxis: number;
  volumeAxis: number;
  seekDistance: number;
  volumeDistance: number;
} {
  return {
    seekAxis: screenDy,
    volumeAxis: screenDx,
    seekDistance: Math.abs(screenDy),
    volumeDistance: Math.abs(screenDx),
  };
}

function computeLandscapeGestureSeekMs(seekAxis: number, seekDistance: number): number {
  if (seekDistance < PREVIEW_LANDSCAPE_GESTURE_MIN_PX) return 0;
  const magnitude = Math.min(
    PREVIEW_LANDSCAPE_GESTURE_SEEK_MAX_MS,
    Math.round(seekDistance * PREVIEW_LANDSCAPE_GESTURE_SEEK_MS_PER_PX),
  );
  return Math.sign(seekAxis) * magnitude;
}

function usePreviewLandscapeGestures(options: {
  enabled: boolean;
  /** deltaMs: this increment; gestureTotalMs: the accumulated seek of this gesture (unclamped) */
  onSeek: (deltaMs: number, gestureTotalMs: number) => void;
  onVolumeDelta: (deltaPercent: number) => void;
  onSeekEnd?: () => void;
}): {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
} {
  const { enabled, onSeek, onVolumeDelta, onSeekEnd } = options;
  const gestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    appliedVolumeSteps: number;
    appliedSeekMs: number;
  } | null>(null);

  const resetGesture = useCallback((): void => {
    gestureRef.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>): void => {
      if (!enabled || e.button !== 0 || isPreviewGestureIgnoredTarget(e.target)) return;
      onSeekEnd?.();
      gestureRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        appliedVolumeSteps: 0,
        appliedSeekMs: 0,
      };
    },
    [enabled, onSeekEnd],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>): void => {
      const gesture = gestureRef.current;
      if (!enabled || !gesture || gesture.pointerId !== e.pointerId) return;

      const screenDx = e.clientX - gesture.startX;
      const screenDy = e.clientY - gesture.startY;
      const { seekAxis, volumeAxis, seekDistance, volumeDistance } = mapForceLandscapeGestureDeltas(
        screenDx,
        screenDy,
      );
      if (Math.max(seekDistance, volumeDistance) < PREVIEW_LANDSCAPE_GESTURE_MIN_PX) return;

      // A left/right swipe on the picture (up/down on the screen) seeks as it goes, with the amount growing with distance.
      if (seekDistance > volumeDistance * PREVIEW_LANDSCAPE_GESTURE_DOMINANCE_RATIO) {
        const totalSeekMs = computeLandscapeGestureSeekMs(seekAxis, seekDistance);
        const deltaMs = totalSeekMs - gesture.appliedSeekMs;
        if (deltaMs !== 0) {
          onSeek(deltaMs, totalSeekMs);
          gesture.appliedSeekMs = totalSeekMs;
        }
        return;
      }

      // An up/down swipe on the picture (left/right on the screen) adjusts the volume as it goes.
      if (volumeDistance > seekDistance * PREVIEW_LANDSCAPE_GESTURE_DOMINANCE_RATIO) {
        const totalSteps = Math.min(
          20,
          Math.max(1, Math.round(volumeDistance / PREVIEW_LANDSCAPE_GESTURE_VOLUME_PX_PER_STEP)),
        );
        const signedSteps = Math.sign(volumeAxis) * totalSteps;
        const deltaSteps = signedSteps - gesture.appliedVolumeSteps;
        if (deltaSteps !== 0) {
          onVolumeDelta(deltaSteps * PREVIEW_KEYBOARD_VOLUME_STEP);
          gesture.appliedVolumeSteps = signedSteps;
        }
      }
    },
    [enabled, onSeek, onVolumeDelta],
  );

  const finishGesture = useCallback(
    (e: React.PointerEvent<HTMLElement>): void => {
      const gesture = gestureRef.current;
      if (!enabled || !gesture || gesture.pointerId !== e.pointerId) return;

      const screenDx = e.clientX - gesture.startX;
      const screenDy = e.clientY - gesture.startY;
      const { seekAxis, volumeAxis, seekDistance, volumeDistance } =
        mapForceLandscapeGestureDeltas(screenDx, screenDy);
      const appliedVolumeSteps = gesture.appliedVolumeSteps;
      const appliedSeekMs = gesture.appliedSeekMs;
      resetGesture();
      onSeekEnd?.();

      if (Math.max(seekDistance, volumeDistance) < PREVIEW_LANDSCAPE_GESTURE_MIN_PX) return;

      if (seekDistance > volumeDistance * PREVIEW_LANDSCAPE_GESTURE_DOMINANCE_RATIO) {
        if (appliedSeekMs === 0) {
          const totalSeekMs = computeLandscapeGestureSeekMs(seekAxis, seekDistance);
          if (totalSeekMs !== 0) onSeek(totalSeekMs, totalSeekMs);
        }
        return;
      }

      if (volumeDistance > seekDistance * PREVIEW_LANDSCAPE_GESTURE_DOMINANCE_RATIO && appliedVolumeSteps === 0) {
        const steps = Math.min(
          20,
          Math.max(1, Math.round(volumeDistance / PREVIEW_LANDSCAPE_GESTURE_VOLUME_PX_PER_STEP)),
        );
        onVolumeDelta(Math.sign(volumeAxis) * steps * PREVIEW_KEYBOARD_VOLUME_STEP);
      }
    },
    [enabled, onSeek, onSeekEnd, onVolumeDelta, resetGesture],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>): void => {
      finishGesture(e);
    },
    [finishGesture],
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLElement>): void => {
      finishGesture(e);
    },
    [finishGesture],
  );

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel };
}

const buildPreviewLoginRedirectUrl = (): string => {
  const path =
    typeof window !== "undefined"
      ? `${PREVIEW_PATHNAME}${window.location.search}`
      : PREVIEW_PATHNAME;
  return `/login?callback=${encodeURIComponent(path)}`;
};

export default function CoursewarePreviewPage() {
  const loginRedirectUrl = useMemo(() => buildPreviewLoginRedirectUrl(), []);
  // ?embed=true — public embeddable mode (no auth, content from ?courseware_id=)
  const isEmbed =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("embed") === "true";
  if (isEmbed) {
    return <CoursewarePreviewContent />;
  }
  return (
    <ProtectedRoute redirectTo={loginRedirectUrl}>
      <CoursewarePreviewContent />
    </ProtectedRoute>
  );
}

function CoursewarePreviewContent() {
  const { t, language } = useI18nNew();
  const { userInfo } = useAuth();
  const quizAttemptLearnerId = userInfo?.user_id?.trim() || null;
  const previewCoursewareId = useMemo((): string | null => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("courseware_id")?.trim() || null;
  }, []);
  /** Identity of a local draft preview (URL `id`); the resume key prefers the remote courseware_id. */
  const previewLocalDraftId = useMemo((): string | null => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("id")?.trim() || null;
  }, []);
  const sectionContext = useMemo(() => readCoursewarePreviewSectionContext(), []);
  /**
   * Resume key: content identity + authenticated learner + section dimension. One courseware can be bound to several lessons
   * (see courseware-section-binding), and without the section the resume position would leak between lessons;
   * a standalone open (no section context) goes into the standalone segment. Without content or learner nothing is persisted.
   */
  const playbackResumeKey = useMemo((): string | null => {
    const contentId = previewCoursewareId ?? previewLocalDraftId;
    if (!contentId?.trim() || !quizAttemptLearnerId?.trim()) return null;
    const sectionScope = sectionContext?.sectionId?.trim() || "standalone";
    return buildCoursewarePlaybackResumeKey(
      `${contentId}@${quizAttemptLearnerId}@${sectionScope}`,
    );
  }, [previewCoursewareId, previewLocalDraftId, quizAttemptLearnerId, sectionContext]);
  /**
   * Old standalone preview resume key (`content@learner`, without the section segment): after the key gains the standalone segment it is used only for
   * a one-off migration. Old records with a section context may come from any lesson (exactly the mix-up this upgrade fixes)
   * and aren't migrated; standalone opens are unambiguous and can be moved safely.
   */
  const legacyStandalonePlaybackResumeKey = useMemo((): string | null => {
    const contentId = previewCoursewareId ?? previewLocalDraftId;
    if (!contentId?.trim() || !quizAttemptLearnerId?.trim()) return null;
    if (sectionContext?.sectionId?.trim()) return null;
    return buildCoursewarePlaybackResumeKey(`${contentId}@${quizAttemptLearnerId}`);
  }, [previewCoursewareId, previewLocalDraftId, quizAttemptLearnerId, sectionContext]);
  /** Real scene load epoch; 0 = the initial showcase scene (no resume/persistence). */
  const [sceneLoadEpoch, setSceneLoadEpoch] = useState(0);
  /**
   * Whether the quiz answer sync has "settled" (no wait needed, or the merge finished). Initially false:
   * both resume and persistence must wait for true, otherwise an empty quizState would treat answered quizzes as unanswered,
   * and persistence would overwrite the unapplied resume position with the starting playhead.
   */
  const [quizRestoreSettled, setQuizRestoreSettled] = useState(false);
  /** Embedded in the editor iframe (the initial localStorage load arrives before the postMessage handshake): no resume/persistence. */
  const isEmbeddedIframe = useMemo(
    () => typeof window !== "undefined" && window.self !== window.top,
    [],
  );
  /** Organization of the course section (URL `org_id`); quiz scoring/billing must use this value, never falling back to `current_org_id`. */
  const sectionOrgId = useMemo((): string | null => sectionContext?.orgId?.trim() || null, [
    sectionContext?.orgId,
  ]);
  /** Without a section context (editor iframe preview etc.), the courseware's org can still be read from the URL (only for the recording upload org check). */
  const previewOrgIdFromQuery = useMemo((): string | null => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("org_id")?.trim() || null;
  }, []);
  const quizSubmitOrgId = sectionOrgId ?? previewOrgIdFromQuery;
  const [knowledgeFiles, setKnowledgeFiles] = useState<CourseKnowledgeFileInfo[]>([]);
  const [knowledgeFilesLoading, setKnowledgeFilesLoading] = useState(false);
  const [courseTree, setCourseTree] = useState<CourseTreeResponse | null>(null);
  const [courseTreeLoading, setCourseTreeLoading] = useState(false);
  const [scene, setScene] = useState<Scene>(() => buildShowcaseScene(t));
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  /** Stage cover frame (slide-local time) while still with the playhead at 0; the progress bar still shows 0. */
  const [idleCoverLocalTimeMs, setIdleCoverLocalTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(() => shouldAutoPlayOnSceneLoad());
  const [isPlaybackLoading, setIsPlaybackLoading] = useState(false);
  const [isScrubbingProgress, setIsScrubbingProgress] = useState(false);
  const playbackLoadingTokensRef = useRef(new Set<string>());
  const playbackLoadingTraceSeqRef = useRef(0);
  const isPlaybackLoadingRef = useRef(false);
  const [rate, setRate] = useState(1);
  const [, setScore] = useState<{ correct: number; wrong: number }>({ correct: 0, wrong: 0 });
  const [quizState, setQuizState] = useState<Record<string, QuizQuestionState>>({});
  const [slideTransition, setSlideTransition] = useState<SlideTransitionState | null>(null);
  const [inochiUrl] = useState<string>("");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSceneBootstrapping, setIsSceneBootstrapping] = useState(previewLoadsRemoteCoursewareOnly);
  /** Editor / localStorage preview: submitting a quiz carries the local question snapshot, so it isn't scored against the server's old draft. */
  const [attachQuestionSnapshotToQuizSubmit, setAttachQuestionSnapshotToQuizSubmit] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantTab, setAssistantTab] = useState<AssistantTab>("history");
  const [isVoiceInputOpen, setIsVoiceInputOpen] = useState(false);
  const [assistantChatDraft, setAssistantChatDraft] = useState("");
  const [chatInputFocusSeq, setChatInputFocusSeq] = useState(0);
  const voiceDictation = useWhisperVoiceDictation({
    getBaseText: () => assistantChatDraft,
    onTranscriptChange: setAssistantChatDraft,
    onInsufficientCredits: () => setIsVoiceInputOpen(false),
    language,
  });
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>(() => [
    buildPreviewAssistantWelcomeMessage(t),
  ]);
  const [assistantHistoryLoading, setAssistantHistoryLoading] = useState(false);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const interactionConversationIdRef = useRef<string | null>(null);
  const interactionSessionIdRef = useRef<string | null>(null);
  const interactionChatScopeKeyRef = useRef<string>("");
  const interactionStreamRunIdRef = useRef(0);
  const interactionAbortRef = useRef<AbortController | null>(null);

  const interactionChatScopeKey = sectionContext
    ? `section:${sectionContext.courseId}:${sectionContext.sectionId}`
    : `preview:${previewCoursewareId ?? "standalone"}`;

  const assistantHistoryLoadEpochRef = useRef(0);

  useEffect(() => {
    const scopeChanged = interactionChatScopeKeyRef.current !== interactionChatScopeKey;
    if (scopeChanged) {
      interactionChatScopeKeyRef.current = interactionChatScopeKey;
      interactionConversationIdRef.current = null;
      interactionSessionIdRef.current = null;
    }

    const epoch = (assistantHistoryLoadEpochRef.current += 1);
    const welcome = buildPreviewAssistantWelcomeMessage(t);

    if (!isInteractionApiConfigured() || (!sectionContext && !previewCoursewareId)) {
      setAssistantHistoryLoading(false);
      setAssistantMessages([welcome]);
      return;
    }

    setAssistantHistoryLoading(true);
    let cancelled = false;

    void (async () => {
      try {
        const remote = await fetchInteractionConversationHistory({
          courseId: sectionContext?.courseId,
          sectionId: sectionContext?.sectionId,
          coursewareId: previewCoursewareId,
        });
        if (cancelled || assistantHistoryLoadEpochRef.current !== epoch) return;

        if (remote.ok) {
          if (remote.conversationId) {
            interactionConversationIdRef.current = remote.conversationId;
          }
          if (remote.claudeSessionId) {
            interactionSessionIdRef.current = remote.claudeSessionId;
          }
          const historyMessages = remote.messages?.length
            ? mapInteractionHistoryToAssistantMessages(remote.messages)
            : [];
          setAssistantMessages(historyMessages.length > 0 ? historyMessages : [welcome]);
          return;
        }
        setAssistantMessages([welcome]);
      } catch {
        if (cancelled || assistantHistoryLoadEpochRef.current !== epoch) return;
        setAssistantMessages([welcome]);
      } finally {
        if (!cancelled && assistantHistoryLoadEpochRef.current === epoch) {
          setAssistantHistoryLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [interactionChatScopeKey, previewCoursewareId, sectionContext, t]);
  /** The main canvas scale when the editor exported the preview, so the HTML iframe layout matches the editor. */
  const [htmlIframeLayoutScale, setHtmlIframeLayoutScale] = useState<number | undefined>(
    undefined,
  );
  const [isCoursewareAccessLocked, setIsCoursewareAccessLocked] = useState(false);
  /** The previewer's master volume 0–100, applied to global tracks / narration / video / quiz narration. */
  const [masterVolumePercent, setMasterVolumePercent] = useState(80);
  const masterVolume = masterVolumePercent / 100;
  const [actionHint, setActionHint] = useState<PreviewActionHintState | null>(null);
  const [actionHintPhase, setActionHintPhase] = useState<PreviewActionHintPhase>("visible");
  const actionHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionHintExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    chromeVisible: fullscreenChromeVisible,
    revealChrome: revealFullscreenChrome,
    hideChrome: hideFullscreenChrome,
    onChromeHoverStart,
    onChromeHoverEnd,
  } = useFullscreenChromeAutoHide(isFullscreen);
  const chromeRevealed = !isFullscreen || fullscreenChromeVisible;

  const playerRootRef = useRef<HTMLDivElement | null>(null);
  /** Seek start of a landscape gesture (whole-scene time ms), used by the hint to show the accumulated offset within the reachable range */
  const landscapeGestureOriginSceneMsRef = useRef<number | null>(null);
  const [isNarrowViewport, setIsNarrowViewport] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(PREVIEW_NARROW_VIEWPORT_MEDIA).matches;
  });
  const [isForceLandscapeEligible, setIsForceLandscapeEligible] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(PREVIEW_FORCE_LANDSCAPE_VIEWPORT_MEDIA).matches;
  });
  const [isForceLandscapeFullscreen, setIsForceLandscapeFullscreen] = useState(false);
  const [forceLandscapeViewport, setForceLandscapeViewport] = useState(() => ({
    width: 0,
    height: 0,
  }));
  const loadedPreviewStorageKeyRef = useRef<string | null>(null);
  /** Cross-slide seek: the time within the target slide + whether to resume playing after the switch (not when dragging while paused) */
  const pendingPreviewSeekRef = useRef<PendingPreviewSlideSeek | null>(null);
  const currentTimeRef = useRef(0);
  const idleCoverLocalTimeRef = useRef(0);
  /** Avoids queueMicrotask(nextSlide) repeating every RAF frame and racing with the `return 0` batch, which caused "still on slide 0 but time reset → quiz logic broken → endless loop" */
  const previewSlideAdvanceScheduledRef = useRef(false);
  const narrationSlideAdvanceBlockersRef = useRef(new Set<string>());
  /** Inside a narration segment `<audio>` drives the playhead, so the wall clock doesn't run ahead of the audio on weak networks. */
  const narrationPlayheadDriveRef = useRef<number | null>(null);
  const flowPauseAcknowledgedRef = useRef<Set<number>>(new Set());

  const syncSlideCoverLocalTime = useCallback((targetSlide: SlideElement | undefined): void => {
    const cover = resolvePreviewIdleSlideLocalTime(targetSlide);
    idleCoverLocalTimeRef.current = cover;
    setIdleCoverLocalTimeMs(cover);
  }, []);

  const setNarrationSlideAdvanceGate = useCallback((elementId: string, blocking: boolean): void => {
    const blockers = narrationSlideAdvanceBlockersRef.current;
    if (blocking) blockers.add(elementId);
    else blockers.delete(elementId);
  }, []);

  const setNarrationPlayheadDrive = useCallback((localMs: number | null): void => {
    narrationPlayheadDriveRef.current = localMs;
    if (localMs !== null) {
      currentTimeRef.current = localMs;
    }
  }, []);

  const slideList = scene.slide_elements;
  const slideCount = slideList.length;
  const effectiveSlideIndex = slideCount === 0 ? 0 : clamp(currentSlideIndex, 0, slideCount - 1);
  const slide: SlideElement =
    slideCount === 0 ? buildEmptyPreviewSlide(t) : (slideList[effectiveSlideIndex] ?? buildEmptyPreviewSlide(t));
  const previewAiTeacherId = useMemo(
    () =>
      resolveSceneAiTeacherId({
        currentSlide: slideCount === 0 ? null : slide,
        sceneVtubers: scene.vtuber_elements,
        allSlides: slideList,
      }),
    [scene.vtuber_elements, slide, slideCount, slideList],
  );
  const duration = Math.max(1, slide.timeline.end_at - slide.timeline.start_at);
  const slideDurationRef = useRef(duration);
  slideDurationRef.current = duration;

  const playheadFromRef = isPlaying;
  /** rAF still runs while loading: narration audio driving the playhead must keep advancing, so the whole segment doesn't stop while a token isn't cleared. */
  const playheadClockRunning = playheadFromRef && !isScrubbingProgress;
  const playheadFromRefForUi = playheadFromRef && !isScrubbingProgress;

  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const applyPlaybackLoadingToken = useCallback((token: string, loading: boolean) => {
    const beforeActive = new Set(playbackLoadingTokensRef.current);
    const beforeGateLoading = beforeActive.size > 0;
    if (loading) playbackLoadingTokensRef.current.add(token);
    else playbackLoadingTokensRef.current.delete(token);
    const activeTokens = [...playbackLoadingTokensRef.current].sort();
    const nextLoading = activeTokens.length > 0;
    const tokenChanged = beforeActive.has(token) !== playbackLoadingTokensRef.current.has(token);
    if (tokenChanged || beforeGateLoading !== nextLoading) {
      logger.debug("[Courseware Preview] playback loading token:", {
        seq: ++playbackLoadingTraceSeqRef.current,
        token,
        loading,
        tokenChanged,
        beforeGateLoading,
        nextGateLoading: nextLoading,
        activeTokens,
        playheadMs: currentTimeRef.current,
        isPlaying: isPlayingRef.current,
        playheadClockRunning: isPlayingRef.current && !nextLoading,
      });
    }
    const prevLoading = isPlaybackLoadingRef.current;
    if (prevLoading !== nextLoading) {
      isPlaybackLoadingRef.current = nextLoading;
      logger.debug("[Courseware Preview] playback loading state:", {
        seq: ++playbackLoadingTraceSeqRef.current,
        from: prevLoading,
        to: nextLoading,
        causeToken: token,
        causeLoading: loading,
        activeTokens,
        playheadMs: currentTimeRef.current,
        isPlaying: isPlayingRef.current,
      });
    }
    setIsPlaybackLoading((prev) => (prev === nextLoading ? prev : nextLoading));
  }, []);
  const clearPlaybackLoadingTokens = useCallback((reason: string) => {
    if (playbackLoadingTokensRef.current.size === 0 && !isPlaybackLoadingRef.current) return;
    const clearedTokens = [...playbackLoadingTokensRef.current].sort();
    playbackLoadingTokensRef.current.clear();
    isPlaybackLoadingRef.current = false;
    setIsPlaybackLoading(false);
    logger.debug("[Courseware Preview] playback loading cleared:", {
      seq: ++playbackLoadingTraceSeqRef.current,
      reason,
      clearedTokens,
      playheadMs: currentTimeRef.current,
      isPlaying: isPlayingRef.current,
    });
  }, []);
  const handleCanvasAudioTrackBuffering = useCallback(
    (elementId: string, buffering: boolean) => {
      applyPlaybackLoadingToken(`canvas-audio:${elementId}`, buffering);
    },
    [applyPlaybackLoadingToken],
  );
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const quizStateRef = useRef(quizState);
  quizStateRef.current = quizState;
  const slideRef = useRef(slide);
  slideRef.current = slide;
  const sceneQuizRef = useRef(scene.quiz);
  sceneQuizRef.current = scene.quiz;
  const effectiveSlideIndexRef = useRef(effectiveSlideIndex);
  effectiveSlideIndexRef.current = effectiveSlideIndex;
  const slideCountRef = useRef(slideCount);
  slideCountRef.current = slideCount;
  const appendLogRef = useRef<(message: string) => void>(() => {});

  const playbackLoadingPrevRef = useRef(false);
  useEffect(() => {
    const wasLoading = playbackLoadingPrevRef.current;
    playbackLoadingPrevRef.current = isPlaybackLoading;
    if (playheadFromRef && isPlaybackLoading && !wasLoading) {
      startTransition(() => setCurrentTime(currentTimeRef.current));
    }
  }, [playheadFromRef, isPlaybackLoading]);

  /** On pause/seek state → ref; during playback the ref is owned by the rAF clock, so the 80ms UI throttle doesn't write an old value back into the ref. */
  useEffect(() => {
    if (isPlayingRef.current) return;
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    const n = scene.slide_elements.length;
    if (n === 0) {
      if (currentSlideIndex !== 0) setCurrentSlideIndex(0);
      return;
    }
    if (currentSlideIndex < 0 || currentSlideIndex > n - 1) {
      setCurrentSlideIndex(clamp(currentSlideIndex, 0, n - 1));
    }
  }, [scene.slide_elements.length, currentSlideIndex]);

  const sceneTotalDurationMs = useMemo(
    () => getSceneTotalDurationMs(scene.slide_elements),
    [scene.slide_elements],
  );
  const slideBoundaryMarkers = useMemo(() => {
    return getSlideBoundaryMarkers(scene.slide_elements).map((marker) => {
      return {
        ...marker,
        label: t("coursewarePreview.controls.slideBoundaryTooltip", {
          index: marker.slideIndex + 1,
          name: resolveSlideDisplayName(
            scene.slide_elements[marker.slideIndex]?.name,
            marker.slideIndex,
            t,
          ),
        }),
      };
    });
  }, [scene.slide_elements, t]);
  const flowPauseMarkers = useMemo(() => {
    return getSceneFlowPauseMarkers(scene.slide_elements).map((marker) => ({
      ...marker,
      label: t("coursewarePreview.controls.flowPauseTooltip", {
        time: formatTimeMs(marker.at_ms),
      }),
    }));
  }, [scene.slide_elements, t]);
  const sceneSlideOffsetMs = useMemo(
    () => getSceneSlideOffsetMs(scene.slide_elements, effectiveSlideIndex),
    [scene.slide_elements, effectiveSlideIndex],
  );

  const sceneCurrentTime = sceneSlideOffsetMs + currentTime;
  const sceneCurrentTimeRef = useRef(sceneCurrentTime);
  sceneCurrentTimeRef.current = sceneCurrentTime;
  const sceneTotalDurationMsRef = useRef(sceneTotalDurationMs);
  sceneTotalDurationMsRef.current = sceneTotalDurationMs;
  const lastPushedLearningProgressRef = useRef(-1);
  const quizSessionCompletedRef = useRef(false);
  const quizAttemptSessionIdRef = useRef<string | null>(null);
  const quizAttemptSyncEpochRef = useRef(0);
  const quizAttemptSessionStorageKey = useMemo((): string | null => {
    if (!sectionContext || !previewCoursewareId || !quizAttemptLearnerId) return null;
    // org may be omitted: the courseware-agent path still restores attempt_session from courseware/section
    return buildQuizAttemptSessionStorageKey({
      learnerId: quizAttemptLearnerId,
      orgId: quizSubmitOrgId,
      courseId: sectionContext.courseId,
      sectionId: sectionContext.sectionId,
      coursewareId: previewCoursewareId,
    });
  }, [previewCoursewareId, quizAttemptLearnerId, quizSubmitOrgId, sectionContext]);

  const requiredQuizWrapperIds = useMemo((): string[] => {
    if (!scene.quiz) return [];
    return collectRequiredQuizWrapperIds(scene.quiz, scene.slide_elements);
  }, [scene.quiz, scene.slide_elements]);

  const quizQuestionsExpectedCount = useMemo((): number => {
    if (!scene.quiz) return 0;
    return countQuizQuestionsExpectedForCompletion(scene.quiz, scene.slide_elements);
  }, [scene.quiz, scene.slide_elements]);

  const topLevelQuizWrapperIndex = useMemo(
    () => buildTopLevelQuizWrapperIndex(scene.slide_elements),
    [scene.slide_elements],
  );

  const pushLearningProgressNow = useCallback(
    async (progressPercent: number, options?: { force?: boolean }): Promise<void> => {
      if (!sectionContext) return;
      const { courseId, chapterId, sectionId, orgId, fromPublic, fromTrial } = sectionContext;
      const clamped = Math.max(0, Math.min(100, progressPercent));
      if (!options?.force && clamped === lastPushedLearningProgressRef.current) return;
      const payload = { learning_progress: clamped };
      try {
        if (fromTrial || fromPublic) {
          await publicCourseApi.pushLearningProgress(courseId, chapterId, sectionId, payload);
        } else if (orgId?.trim()) {
          await courseSectionApi.pushLearningProgress(
            orgId,
            courseId,
            chapterId,
            sectionId,
            payload,
          );
        } else {
          return;
        }
        lastPushedLearningProgressRef.current = clamped;
      } catch (error) {
        logger.error("courseware preview pushLearningProgress failed", error);
      }
    },
    [sectionContext],
  );

  const readLearningProgressPercent = useCallback((): number => {
    return computeCoursewareLearningProgressPercent(
      sceneCurrentTimeRef.current,
      sceneTotalDurationMsRef.current,
    );
  }, []);

  useEffect(() => {
    if (!sectionContext) return;
    const intervalId = window.setInterval(() => {
      void pushLearningProgressNow(readLearningProgressPercent());
    }, 8000);
    return () => window.clearInterval(intervalId);
  }, [sectionContext, pushLearningProgressNow, readLearningProgressPercent]);

  useEffect(() => {
    if (!sectionContext) return;
    const flush = (): void => {
      void pushLearningProgressNow(readLearningProgressPercent(), { force: true });
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [sectionContext, pushLearningProgressNow, readLearningProgressPercent]);

  useEffect(() => {
    quizSessionCompletedRef.current = false;
    quizAttemptSessionIdRef.current = readQuizAttemptSessionId(quizAttemptSessionStorageKey);
    lastPushedLearningProgressRef.current = -1;
  }, [
    quizAttemptSessionStorageKey,
    sectionContext?.courseId,
    sectionContext?.chapterId,
    sectionContext?.sectionId,
  ]);

  /**
   * Mark the homework submitted: called actively when the last question submits successfully, and again (idempotently) on entering the score summary page.
   * With required_question_wrapper_ids the backend checks only DB records, independent of the local quizState (it still succeeds after a refresh).
   */
  const tryCompleteQuizSession = useCallback(
    async (options?: {
      quizStateOverride?: Record<string, QuizQuestionState>;
    }): Promise<void> => {
      const usesCoursewareServiceComplete = Boolean(
        previewCoursewareId?.trim() && isCoursewareApiConfigured(),
      );
      const orgId = quizSubmitOrgId?.trim() || null;
      if (!sectionContext?.courseId || !sectionContext?.sectionId || !scene.quiz) {
        return;
      }
      // The courseware-agent complete session may not depend on org; the old main API path still needs orgId.
      if (!usesCoursewareServiceComplete && !orgId) {
        return;
      }
      if (quizSessionCompletedRef.current) return;
      const attemptSessionId = quizAttemptSessionIdRef.current;
      if (!attemptSessionId) return;

      const stateForSnapshot = options?.quizStateOverride ?? quizState;
      if (
        !canCompleteQuizHomework(scene.quiz, scene.slide_elements, stateForSnapshot)
      ) {
        return;
      }

      const snapshot = computeQuizAggregateScore(
        scene.quiz,
        scene.slide_elements,
        stateForSnapshot,
      );
      const requiredIds = requiredQuizWrapperIds;
      const totalExpected = countQuizQuestionsExpectedForCompletion(
        scene.quiz,
        scene.slide_elements,
      );

      quizSessionCompletedRef.current = true;
      const payload = {
        courseware_id: previewCoursewareId ?? undefined,
        attempt_session_id: attemptSessionId,
        course_id: sectionContext.courseId,
        section_id: sectionContext.sectionId,
        scene_id: scene.scene_id,
        total_score: snapshot.earnedScore,
        max_score: snapshot.totalScore,
        answered_count: snapshot.answeredCount,
        total_count: totalExpected,
        required_question_wrapper_ids: requiredIds.length > 0 ? requiredIds : undefined,
      };

      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          await coursewareApi.completeQuizSession(orgId, payload);
          clearQuizAttemptSessionId(quizAttemptSessionStorageKey, quizAttemptSessionIdRef);
          return;
        } catch (error) {
          if (attempt >= maxAttempts) {
            quizSessionCompletedRef.current = false;
            logger.error("courseware preview completeQuizSession failed", error);
          } else {
            await new Promise((resolve) => window.setTimeout(resolve, 800 * attempt));
          }
        }
      }
    },
    [
      previewCoursewareId,
      quizAttemptSessionStorageKey,
      quizState,
      quizSubmitOrgId,
      requiredQuizWrapperIds,
      scene.quiz,
      scene.scene_id,
      scene.slide_elements,
      sectionContext,
    ],
  );

  const handleQuizSubmitSucceeded = useCallback(
    (quizElementId: string, nextQuestionState: QuizQuestionState) => {
      const mergedState: Record<string, QuizQuestionState> = {
        ...quizState,
        [quizElementId]: nextQuestionState,
      };
      if (!canCompleteQuizHomework(scene.quiz!, scene.slide_elements, mergedState)) {
        return;
      }
      void tryCompleteQuizSession({ quizStateOverride: mergedState });
    },
    [quizState, scene.quiz, scene.slide_elements, tryCompleteQuizSession],
  );

  useEffect(() => {
    if (!shouldSyncQuizAnswersOnPreviewLoad()) {
      setQuizRestoreSettled(true);
      return;
    }
    if (isSceneBootstrapping) return;
    // The agent answer list doesn't depend on org_id; the main API persisted homework fallback still needs org
    if (!previewCoursewareId || !scene.quiz?.enabled || !isCoursewareApiConfigured()) {
      setQuizRestoreSettled(true);
      return;
    }
    const attemptSessionId = readQuizAttemptSessionId(quizAttemptSessionStorageKey);
    if (attemptSessionId) {
      quizAttemptSessionIdRef.current = attemptSessionId;
    }

    const epoch = (quizAttemptSyncEpochRef.current += 1);
    void (async () => {
      try {
        const answers = await fetchQuizAnswersForPreviewRestore({
          orgId: quizSubmitOrgId ?? "",
          coursewareId: previewCoursewareId,
          sectionId: sectionContext?.sectionId,
          studentId: quizAttemptLearnerId,
          attemptSessionId,
          listAttemptAnswers: (params) =>
            coursewareApi.listQuizAnswersForAttempt(quizSubmitOrgId, params),
          listPersistedAnswers:
            quizSubmitOrgId && sectionContext?.sectionId && quizAttemptLearnerId
              ? (params) => coursewareApi.listQuizAnswers(quizSubmitOrgId, params)
              : undefined,
        });
        if (quizAttemptSyncEpochRef.current !== epoch) return;
        setQuizRestoreSettled(true);
        if (answers.length === 0) return;

        setQuizState((prev) =>
          mergeQuizStateFromAttemptAnswers(
            prev,
            answers,
            scene.quiz!,
            scene.slide_elements,
          ),
        );
      } catch (error) {
        if (quizAttemptSyncEpochRef.current !== epoch) return;
        setQuizRestoreSettled(true);
        logger.error("courseware preview sync quiz attempt answers failed", error);
      }
    })();
  }, [
    isSceneBootstrapping,
    previewCoursewareId,
    quizAttemptLearnerId,
    quizAttemptSessionStorageKey,
    quizSubmitOrgId,
    scene.quiz,
    scene.slide_elements,
    sectionContext?.sectionId,
  ]);

  useEffect(() => {
    if (!slideHasQuizScoreSummary(slide)) return;
    const attempt = (): void => {
      if (!scene.quiz?.enabled) return;
      if (!canCompleteQuizHomework(scene.quiz, scene.slide_elements, quizState)) return;
      void tryCompleteQuizSession({ quizStateOverride: quizState });
    };
    attempt();
    const intervalId = window.setInterval(() => {
      if (!quizSessionCompletedRef.current) attempt();
    }, 12_000);
    return () => window.clearInterval(intervalId);
  }, [slide.element_id, slide, scene.quiz, scene.slide_elements, quizState, tryCompleteQuizSession]);

  const slideCanvasAudioTracks = useMemo(
    () => collectSlideCanvasAudioElementsForMixer(slide),
    [slide],
  );

  const appendLog = useCallback((_message: string): void => {}, []);
  appendLogRef.current = appendLog;

  const activeQuizQuestion = useMemo(
    () => getActiveQuizQuestion(slide, scene.quiz, currentTime, quizState),
    [slide, scene.quiz, currentTime, quizState],
  );
  const activeQuizQuestionState = activeQuizQuestion ? quizState[activeQuizQuestion.element_id] : undefined;

  /** Paused on the current quiz question waiting for an answer (dragging back is allowed, skipping past this question forward isn't). */
  const quizAwaitingInteraction = Boolean(
    activeQuizQuestion &&
      !quizState[activeQuizQuestion.element_id]?.submitted &&
      !quizState[activeQuizQuestion.element_id]?.skipped,
  );

  const quizSeekMaxMs = useMemo(() => {
    if (!quizAwaitingInteraction || !activeQuizQuestion) return null;
    return activeQuizQuestion.timeline.end_at;
  }, [quizAwaitingInteraction, activeQuizQuestion]);

  const quizContentNarrationAudioRef = useRef<HTMLAudioElement | null>(null);
  /** The question wrappers whose narration audio already played within the current pause session (avoids replaying the same question; cleared on leaving the pause). */
  const quizNarrationStartedWrapperIdRef = useRef<string | null>(null);
  const previewQuizStemAutoplayNonceRef = useRef(0);
  const [previewQuizStemAutoplay, setPreviewQuizStemAutoplay] = useState<{
    wrapperId: string;
    playUrl: string;
    nonce: number;
  } | null>(null);

  const previewActiveQuizPauseWrapperId = useMemo((): string | null => {
    if (!quizAwaitingInteraction || !activeQuizQuestion) return null;
    return activeQuizQuestion.element_id;
  }, [quizAwaitingInteraction, activeQuizQuestion]);

  const pauseQuizPlaybackForRecording = useCallback(() => {
    quizContentNarrationAudioRef.current?.pause();
  }, []);

  useEffect(() => {
    const a = quizContentNarrationAudioRef.current;
    if (!a) return;
    applyHtmlMediaPlaybackRate(a, rate);
    a.volume = clamp(masterVolume, 0, 1);
  }, [rate, masterVolume]);

  useEffect(() => {
    if (!quizAwaitingInteraction || !activeQuizQuestion || !scene.quiz?.enabled) {
      quizContentNarrationAudioRef.current?.pause();
      quizNarrationStartedWrapperIdRef.current = null;
      setPreviewQuizStemAutoplay(null);
      return;
    }
    const wId = activeQuizQuestion.element_id;
    if (quizNarrationStartedWrapperIdRef.current === wId) return;

    const q = getQuestionConfig(scene.quiz, activeQuizQuestion);
    if (!q) {
      quizNarrationStartedWrapperIdRef.current = wId;
      return;
    }

    const narrationUrl = q.content_narration_audio_url?.trim() ?? "";
    if (!narrationUrl) {
      quizNarrationStartedWrapperIdRef.current = wId;
      return;
    }

    quizNarrationStartedWrapperIdRef.current = wId;

    const a = quizContentNarrationAudioRef.current;
    if (!a) return;

    const token = `quiz-narration:${wId}`;
    applyPlaybackLoadingToken(token, true);
    a.crossOrigin = "anonymous";
    applyHtmlMediaPlaybackRate(a, rate);
    a.volume = clamp(masterVolume, 0, 1);
    a.src = narrationUrl;

    const clearLoading = (): void => {
      applyPlaybackLoadingToken(token, false);
    };

    const startPlayback = (): void => {
      void a.play().catch(() => {}).finally(clearLoading);
    };

    if (a.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      startPlayback();
    } else {
      const onCanPlay = (): void => {
        a.removeEventListener("canplay", onCanPlay);
        a.removeEventListener("error", onError);
        startPlayback();
      };
      const onError = (): void => {
        a.removeEventListener("canplay", onCanPlay);
        a.removeEventListener("error", onError);
        clearLoading();
      };
      a.addEventListener("canplay", onCanPlay);
      a.addEventListener("error", onError);
    }
  }, [applyPlaybackLoadingToken, quizAwaitingInteraction, activeQuizQuestion, rate, masterVolume, scene.quiz]);

  const showActionHint = useCallback((hint: PreviewActionHintState) => {
    if (actionHintTimerRef.current) {
      clearTimeout(actionHintTimerRef.current);
      actionHintTimerRef.current = null;
    }
    if (actionHintExitTimerRef.current) {
      clearTimeout(actionHintExitTimerRef.current);
      actionHintExitTimerRef.current = null;
    }
    setActionHint(hint);
    setActionHintPhase("visible");
    actionHintTimerRef.current = setTimeout(() => {
      actionHintTimerRef.current = null;
      setActionHintPhase("exiting");
      actionHintExitTimerRef.current = setTimeout(() => {
        actionHintExitTimerRef.current = null;
        setActionHint(null);
        setActionHintPhase("visible");
      }, PREVIEW_ACTION_HINT_EXIT_MS);
    }, PREVIEW_ACTION_HINT_VISIBLE_MS);
  }, []);

  useEffect(
    () => () => {
      if (actionHintTimerRef.current) {
        clearTimeout(actionHintTimerRef.current);
      }
      if (actionHintExitTimerRef.current) {
        clearTimeout(actionHintExitTimerRef.current);
      }
    },
    [],
  );

  const replaceScene = useCallback(
    (
      load: () => Scene | PreviewStorageScene | Promise<Scene | PreviewStorageScene>,
      source: "URL" | "localStorage" | "postMessage" | "remote",
      storageId?: string,
      initialSlideIndex?: number,
    ): void => {
      void (async () => {
        const skipBootstrapOverlay =
          source === "postMessage" &&
          Boolean(storageId && loadedPreviewStorageKeyRef.current);
        if (!skipBootstrapOverlay) {
          setIsSceneBootstrapping(true);
          setIsCoursewareAccessLocked(false);
        }
        try {
          const loaded = await Promise.resolve(load());
          const isStorageScene =
            loaded &&
            typeof loaded === "object" &&
            "scene" in loaded &&
            "revision" in loaded;
          let nextScene = isStorageScene ? loaded.scene : loaded;
          const nextHtmlLayoutScale = isStorageScene
            ? loaded.htmlIframeLayoutScale
            : undefined;
          const nextStorageKey =
            storageId && isStorageScene && loaded.revision
              ? `${storageId}:${loaded.revision}`
              : null;
          const nextSlideIndex = resolvePostLoadSlideIndex(
            initialSlideIndex,
            nextScene.slide_elements.length,
          );
          const previousStorageKey = loadedPreviewStorageKeyRef.current;
          if (nextStorageKey && previousStorageKey === nextStorageKey) {
            /**
             * Embedded preview: the editor postMessages the same revision every time `scene` changes.
             * Calling `setCurrentTime(0)` here again would reset playback/quiz progress over and over (a tab opened separately doesn't receive these pushes).
             * The slide updates only when the slide index changes; time resets are left to the `currentSlideIndex` effect.
             */
            if (typeof initialSlideIndex === "number") {
              setCurrentSlideIndex((prev) => (prev !== nextSlideIndex ? nextSlideIndex : prev));
            }
            return;
          }
          nextScene = await tryPresignSceneAssetUrls(nextScene, previewCoursewareId);
          const isEmbeddedHotSync =
            source === "postMessage" &&
            storageId &&
            nextStorageKey &&
            previousStorageKey?.startsWith(`${storageId}:`);
          if (isEmbeddedHotSync) {
            /**
             * Agent livePreview / editor scene sync: hot-update the scene when the revision changes under the same previewId,
             * keeping the current slide, playhead and quiz progress, so every patch doesn't play from the start.
             */
            loadedPreviewStorageKeyRef.current = nextStorageKey;
            const slideCount = nextScene.slide_elements.length;
            const keepSlideIndex =
              typeof initialSlideIndex === "number"
                ? nextSlideIndex
                : clamp(effectiveSlideIndexRef.current, 0, Math.max(0, slideCount - 1));
            const keepSlide = nextScene.slide_elements[keepSlideIndex];
            const maxTime = keepSlide
              ? Math.max(1, keepSlide.timeline.end_at - keepSlide.timeline.start_at)
              : 1;
            const keepTime = clamp(currentTimeRef.current, 0, maxTime);
            setScene(nextScene);
            setHtmlIframeLayoutScale(nextHtmlLayoutScale);
            setCurrentSlideIndex(keepSlideIndex);
            if (keepTime !== currentTimeRef.current) {
              currentTimeRef.current = keepTime;
              setCurrentTime(keepTime);
            }
            return;
          }
          loadedPreviewStorageKeyRef.current = nextStorageKey;
          setAttachQuestionSnapshotToQuizSubmit(
            source === "localStorage" || source === "postMessage" || source === "URL",
          );
          setScene(nextScene);
          setSceneLoadEpoch((epoch) => epoch + 1);
          setQuizRestoreSettled(false);
          setHtmlIframeLayoutScale(nextHtmlLayoutScale);
          setSlideTransition(null);
          const autoPlayOnLoad = shouldAutoPlayOnSceneLoad();
          setCurrentSlideIndex(nextSlideIndex);
          currentTimeRef.current = 0;
          setCurrentTime(0);
          syncSlideCoverLocalTime(nextScene.slide_elements[nextSlideIndex]);
          setIsPlaying(autoPlayOnLoad);
          clearPlaybackLoadingTokens("scene-loaded");
          setScore({ correct: 0, wrong: 0 });
          setQuizState({});
          const sourceLabel =
            source === "remote"
              ? t("coursewarePreview.playback.sourceServer")
              : source === "localStorage"
                ? t("coursewarePreview.playback.sourceLocalPreview")
                : source === "postMessage"
                  ? t("coursewarePreview.playback.sourceEditor")
                  : "URL";
          appendLog(
            t("coursewarePreview.playback.logSceneLoaded", {
              source: sourceLabel,
              name: nextScene.name,
            }),
          );
        } catch (error) {
          if (isCoursewareAccessForbiddenError(error)) {
            setIsCoursewareAccessLocked(true);
            setIsPlaying(false);
            appendLog(t("coursewarePreview.playback.logAccessDenied"));
          } else {
            appendLog(
              t("coursewarePreview.playback.logLoadFailed", {
                source,
                message: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        } finally {
          if (!skipBootstrapOverlay) {
            setIsSceneBootstrapping(false);
          }
        }
      })();
    },
    [appendLog, previewCoursewareId, syncSlideCoverLocalTime, t],
  );

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const previewId = search.get("id");
    const initialSlideIndex = search.get("slideIndex");
    // OCI private bucket: scenes persist unsigned URLs (native/CDN form), so before preview rendering they must
    // be presigned again in bulk with courseware_id (the same as the renderer's presignLoadedScene).
    const coursewareIdFromUrl = search.get("courseware_id")?.trim() || null;
    if (previewId) {
      replaceScene(
        async () => {
          const loaded = await readSceneFromPreviewStorage(previewId, t);
          if (!coursewareIdFromUrl) return loaded;
          const presigned = await presignLoadedScene(loaded.scene, coursewareIdFromUrl);
          return { ...loaded, scene: presigned };
        },
        "localStorage",
        previewId,
        normalizeInitialSlideIndex(initialSlideIndex, Number.MAX_SAFE_INTEGER),
      );
      // When the scene in the stored bundle is empty (e.g. a broken save from an old version) and no slide shows up after 8 seconds,
      // fall back to loading remotely if there is a courseware_id.
      if (coursewareIdFromUrl) {
        window.setTimeout(() => {
          if (!document.body.innerText.includes("No slides")) return;
          replaceScene(
            async () => {
              const scene = await loadSceneFromRemoteCourseware(coursewareIdFromUrl, t);
              return presignLoadedScene(scene, coursewareIdFromUrl);
            },
            "remote",
            undefined,
            normalizeInitialSlideIndex(initialSlideIndex, Number.MAX_SAFE_INTEGER),
          );
        }, 8000);
      }
      return;
    }
    const rawData = search.get("data");
    if (rawData) {
      try {
        const normalized = decodeURIComponent(rawData);
        replaceScene(() => parseSceneFromBase64(normalized), "URL");
      } catch {
        replaceScene(() => parseSceneFromBase64(rawData), "URL");
      }
      return;
    }
    if (coursewareIdFromUrl) {
      replaceScene(
        async () => {
          const scene = await loadSceneFromRemoteCourseware(coursewareIdFromUrl, t);
          return presignLoadedScene(scene, coursewareIdFromUrl);
        },
        "remote",
        undefined,
        normalizeInitialSlideIndex(initialSlideIndex, Number.MAX_SAFE_INTEGER),
      );
    }
  }, [replaceScene]);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      if (isSceneMessagePayload(event.data)) {
        // Same presign requirement as the URL-param preview path above: the
        // postMessage-driven preview also loads from OCI private storage.
        const coursewareIdFromUrl =
          new URLSearchParams(window.location.search).get("courseware_id")?.trim() || null;
        replaceScene(
          async () => {
            const loaded = await readSceneFromPreviewStorage(event.data.previewId, t);
            if (!coursewareIdFromUrl) return loaded;
            const presigned = await presignLoadedScene(loaded.scene, coursewareIdFromUrl);
            return { ...loaded, scene: presigned };
          },
          "postMessage",
          event.data.previewId,
          event.data.slideIndex,
        );
        return;
      }
      if (isPreviewControlMessagePayload(event.data)) {
        if (quizAwaitingInteraction) return;
        setIsPlaying((v) => !v);
      }
    };
    window.addEventListener("message", onMessage);
    if (window.parent !== window) {
      window.parent.postMessage({ type: "courseware-preview:ready" }, "*");
    }
    return () => window.removeEventListener("message", onMessage);
  }, [replaceScene, quizAwaitingInteraction]);

  useEffect(() => {
    if (!sectionContext) {
      setKnowledgeFiles([]);
      setKnowledgeFilesLoading(false);
      return;
    }

    let cancelled = false;
    setKnowledgeFilesLoading(true);

    void (async () => {
      try {
        const { courseId, chapterId, sectionId, orgId, fromPublic, fromTrial } = sectionContext;
        if (!fromTrial && !fromPublic && !orgId) {
          if (!cancelled) {
            setKnowledgeFiles([]);
          }
          return;
        }
        const response =
          fromTrial || fromPublic
            ? await publicCourseApi.getSectionKnowledgeFiles(courseId, chapterId, sectionId)
            : await courseSectionApi.getSectionKnowledgeFiles(
                courseId,
                chapterId,
                sectionId,
                orgId as string,
              );
        if (!cancelled) {
          setKnowledgeFiles(response.data || []);
        }
      } catch (error) {
        logger.error("Failed to load knowledge files:", error);
        if (!cancelled) {
          setKnowledgeFiles([]);
        }
      } finally {
        if (!cancelled) {
          setKnowledgeFilesLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sectionContext]);

  const fetchCourseTree = useCallback(async () => {
    const courseId = sectionContext?.courseId;
    if (courseTree || !courseId) return;

    setCourseTreeLoading(true);
    try {
      const treeData = await courseApi.getCourseTreeNoOrg(courseId, "public");
      setCourseTree(treeData);
    } catch (error) {
      logger.error("Failed to load course tree:", error);
    } finally {
      setCourseTreeLoading(false);
    }
  }, [courseTree, sectionContext?.courseId]);

  useEffect(() => {
    if (assistantOpen && assistantTab === "curriculum" && !courseTree && sectionContext?.courseId) {
      void fetchCourseTree();
    }
  }, [assistantOpen, assistantTab, courseTree, sectionContext?.courseId, fetchCourseTree]);

  // Scene runtime
  const sceneRuntime: SceneScriptRuntime = useMemo(
    () =>
      createSceneScriptRuntime({
        getCurrentSlideIndex: () =>
          scene.slide_elements.length === 0
            ? 0
            : clamp(currentSlideIndex, 0, scene.slide_elements.length - 1),
        slideCount: scene.slide_elements.length,
        goToSlide: (index) => {
          const slideCount = scene.slide_elements.length;
          if (slideCount === 0) return;
          const fromIndex = clamp(currentSlideIndex, 0, slideCount - 1);
          const toIndex = clamp(index, 0, slideCount - 1);
          if (fromIndex === toIndex) return;
          const nextSlide = scene.slide_elements[toIndex];
          const fromSlide = scene.slide_elements[fromIndex];
          if (!nextSlide || !fromSlide) return;

          const transition = transitionBetweenSlides(scene, fromIndex, toIndex);
          const fromTime = currentTimeRef.current;
          if (transition === "none") {
            setSlideTransition(null);
          } else {
            const key = Date.now();
            setSlideTransition({
              key,
              fromSlide,
              fromTime,
              toSlideId: nextSlide.element_id,
              transition,
              direction: toIndex > fromIndex ? 1 : -1,
            });
            window.setTimeout(() => {
              setSlideTransition((current) => (current?.key === key ? null : current));
            }, TRANSITION_MS);
          }

          const pending = pendingPreviewSeekRef.current;
          pendingPreviewSeekRef.current = null;
          const targetLocalMs = pending?.localTimeMs ?? 0;
          currentTimeRef.current = targetLocalMs;
          setCurrentTime(targetLocalMs);
          setCurrentSlideIndex(toIndex);
          if (pending?.resumePlayback) {
            isPlayingRef.current = true;
            setIsPlaying(true);
          }
          appendLog(
            t("coursewarePreview.playback.logSlideChanged", {
              index: toIndex + 1,
              name: resolveSlideDisplayName(nextSlide.name, toIndex, t),
            }),
          );
        },
        openExternalUrl: (url, target) => {
          window.open(url, target);
          appendLog(t("coursewarePreview.playback.logOpenLink", { url, target }));
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appendLog, currentSlideIndex, scene],
  );

  const elementRuntime: ElementScriptRuntime = useMemo(
    () => ({
      scene: sceneRuntime as unknown as Record<string, unknown>,
      browser: {
        openUrl: (url: string, target: "_blank" | "_self" = "_blank") => {
          window.open(url, target);
          appendLog(`browser.openUrl ${url}`);
        },
      },
      external: {
        nextSlide: () => sceneRuntime.nextSlide(),
        previousSlide: () => sceneRuntime.previousSlide(),
        firstSlide: () => sceneRuntime.firstSlide(),
        lastSlide: () => sceneRuntime.lastSlide(),
        jumpToPage: (...args: unknown[]) => sceneRuntime.jumpToPage(Number(args[0] ?? 1)),
        markCorrect: () => {
          setScore((s) => ({ ...s, correct: s.correct + 1 }));
          appendLog(t("coursewarePreview.playback.logAnswerCorrect"));
        },
        markWrong: () => {
          setScore((s) => ({ ...s, wrong: s.wrong + 1 }));
          appendLog(t("coursewarePreview.playback.logAnswerWrong"));
        },
      },
    }),
    [sceneRuntime, appendLog],
  );

  const sceneRuntimeRef = useRef(sceneRuntime);
  sceneRuntimeRef.current = sceneRuntime;

  const isScenePlaybackAtEnd = useCallback((): boolean => {
    const slides = scene.slide_elements;
    if (slides.length === 0) return false;
    const sceneNow = getScenePlayheadMs(
      slides,
      effectiveSlideIndexRef.current,
      currentTimeRef.current,
    );
    return sceneNow >= getSceneTotalDurationMs(slides) - 1;
  }, [scene.slide_elements]);

  const restartScenePlayback = useCallback((): void => {
    flowPauseAcknowledgedRef.current.clear();
    narrationPlayheadDriveRef.current = null;
    if (effectiveSlideIndexRef.current !== 0) {
      pendingPreviewSeekRef.current = { localTimeMs: 0, resumePlayback: true };
      sceneRuntime.jumpToSlide(0);
    } else {
      currentTimeRef.current = 0;
      setCurrentTime(0);
    }
    setIsPlaying(true);
  }, [sceneRuntime]);

  /** When playback has ended, play/space replays from the start; otherwise toggles pause. */
  const togglePlayPause = useCallback((): void => {
    if (!isPlayingRef.current && isScenePlaybackAtEnd()) {
      restartScenePlayback();
      return;
    }
    if (!isPlayingRef.current) {
      const flowPauses = getSlideFlowPausePoints(slideRef.current);
      const resumeAt = resolveFlowPauseResumePlayheadMs(
        flowPauses,
        currentTimeRef.current,
        slideDurationRef.current,
        flowPauseAcknowledgedRef.current,
      );
      narrationPlayheadDriveRef.current = null;
      currentTimeRef.current = resumeAt;
      setCurrentTime(resumeAt);
    }
    setIsPlaying((v) => !v);
  }, [isScenePlaybackAtEnd, restartScenePlayback]);

  const handleSceneSeek = useCallback(
    (sceneMs: number): { appliedSceneMs: number; redirectedToQuiz: boolean } => {
      const slides = scene.slide_elements;
      const slideIndexNow = effectiveSlideIndexRef.current;
      const maxScene =
        quizAwaitingInteraction && quizSeekMaxMs != null
          ? getScenePlayheadMs(slides, slideIndexNow, quizSeekMaxMs)
          : sceneTotalDurationMs;
      let clampedScene = clamp(sceneMs, 0, maxScene);

      const blocked = findFirstUnfinishedQuizBeforeSceneTime(
        slides,
        scene.quiz,
        quizStateRef.current,
        clampedScene,
      );
      let redirectedToQuiz = false;
      if (blocked) {
        const scrubbingCurrentQuiz =
          quizAwaitingInteraction &&
          activeQuizQuestion &&
          blocked.quizEl.element_id === activeQuizQuestion.element_id &&
          quizSeekMaxMs != null &&
          clampedScene <= getScenePlayheadMs(slides, slideIndexNow, quizSeekMaxMs);
        if (!scrubbingCurrentQuiz) {
          clampedScene = blocked.sceneMs;
          redirectedToQuiz = true;
          isPlayingRef.current = false;
          setIsPlaying(false);
          showActionHint({ kind: "quiz_required" });
        }
      }

      const { slideIndex, localTimeMs } = resolveSceneTimeMs(slides, clampedScene);
      const targetLocalTimeMs = redirectedToQuiz ? blocked!.localPauseAt : localTimeMs;
      if (slideIndex !== slideIndexNow) {
        pendingPreviewSeekRef.current = {
          localTimeMs: targetLocalTimeMs,
          resumePlayback: isPlayingRef.current,
        };
        sceneRuntimeRef.current.jumpToSlide(slideIndex);
        return { appliedSceneMs: clampedScene, redirectedToQuiz };
      }
      currentTimeRef.current = targetLocalTimeMs;
      syncFlowPauseAcknowledgementsOnSeek(
        getSlideFlowPausePoints(slides[slideIndex] ?? slideRef.current),
        targetLocalTimeMs,
        flowPauseAcknowledgedRef.current,
      );
      setCurrentTime(targetLocalTimeMs);
      return { appliedSceneMs: clampedScene, redirectedToQuiz };
    },
    [
      activeQuizQuestion,
      quizAwaitingInteraction,
      quizSeekMaxMs,
      scene.quiz,
      scene.slide_elements,
      sceneTotalDurationMs,
      showActionHint,
    ],
  );

  /** Recording playhead persistence: enabled once the quiz answer sync settles, saved every 3s (only when it changed >500ms), forced before hide/unmount. */
  const lastSavedResumeSceneMsRef = useRef(0);
  useEffect(() => {
    if (isEmbeddedIframe) return;
    if (sceneLoadEpoch === 0 || !quizRestoreSettled) return;
    if (!playbackResumeKey || !sceneTotalDurationMs) return;
    const protectKeys = previewLocalDraftId
      ? [makePreviewStorageKey(previewLocalDraftId)]
      : [];
    const persist = (): void => {
      const sceneNow = getScenePlayheadMs(
        scene.slide_elements,
        effectiveSlideIndexRef.current,
        currentTimeRef.current,
      );
      if (Math.abs(sceneNow - lastSavedResumeSceneMsRef.current) < 500) return;
      lastSavedResumeSceneMsRef.current = sceneNow;
      saveCoursewarePlaybackResume(playbackResumeKey, sceneNow, sceneTotalDurationMs, {
        protectKeys,
      });
    };
    const intervalId = window.setInterval(persist, 3000);
    const flush = (): void => {
      if (document.visibilityState === "hidden") persist();
    };
    window.addEventListener("beforeunload", persist);
    document.addEventListener("visibilitychange", flush);
    return () => {
      // Route navigation away (e.g. the header's navigate(-1)) doesn't fire beforeunload/visibilitychange, so save once more before unmount
      persist();
      window.clearInterval(intervalId);
      window.removeEventListener("beforeunload", persist);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [
    isEmbeddedIframe,
    sceneLoadEpoch,
    quizRestoreSettled,
    playbackResumeKey,
    sceneTotalDurationMs,
    scene.slide_elements,
    previewLocalDraftId,
  ]);

  /** Recording resume: apply the last playhead once the quiz answer sync settles (at most once per load; skipped when embedded / without a key). */
  const restoredPlaybackResumeEpochRef = useRef(-1);
  useEffect(() => {
    if (sceneLoadEpoch === 0 || !quizRestoreSettled) return;
    if (!playbackResumeKey || !sceneTotalDurationMs) return;
    if (restoredPlaybackResumeEpochRef.current === sceneLoadEpoch) return;
    restoredPlaybackResumeEpochRef.current = sceneLoadEpoch;
    if (isEmbeddedIframe) return;
    const protectKeys = previewLocalDraftId
      ? [makePreviewStorageKey(previewLocalDraftId)]
      : [];
    // One-off migration of the key upgrade (adding the standalone segment): old standalone records have no cross-section
    // ambiguity, so they move over when the new key has no record, avoiding a replay from 0 on the first visit after the upgrade
    migrateStandaloneCoursewarePlaybackResume(
      playbackResumeKey,
      legacyStandalonePlaybackResumeKey,
      sceneTotalDurationMs,
      { protectKeys },
    );
    const saved = readCoursewarePlaybackResume(playbackResumeKey);
    if (!saved || saved.sceneTimeMs >= sceneTotalDurationMs) return;
    const { appliedSceneMs } = handleSceneSeek(saved.sceneTimeMs);
    if (appliedSceneMs !== saved.sceneTimeMs) {
      // The landing point was clamped/redirected by an unfinished quiz barrier: write back the actual landing point, so every refresh doesn't jump again
      saveCoursewarePlaybackResume(playbackResumeKey, appliedSceneMs, sceneTotalDurationMs, {
        protectKeys,
      });
    }
  }, [
    sceneLoadEpoch,
    quizRestoreSettled,
    playbackResumeKey,
    legacyStandalonePlaybackResumeKey,
    sceneTotalDurationMs,
    isEmbeddedIframe,
    handleSceneSeek,
    previewLocalDraftId,
  ]);

  const handleKeyboardSeek = useCallback(
    (deltaMs: number) => {
      const slides = scene.slide_elements;
      const slideIndex = effectiveSlideIndexRef.current;
      const maxScene =
        quizAwaitingInteraction && quizSeekMaxMs != null
          ? getScenePlayheadMs(slides, slideIndex, quizSeekMaxMs)
          : getSceneTotalDurationMs(slides);
      const sceneNow = getScenePlayheadMs(slides, slideIndex, currentTimeRef.current);
      const targetScene = clamp(sceneNow + deltaMs, 0, maxScene);
      const seekResult = handleSceneSeek(targetScene);
      if (!seekResult.redirectedToQuiz) {
        showActionHint({
          kind: "seek",
          timeMs: seekResult.appliedSceneMs,
          deltaMs: seekResult.appliedSceneMs - sceneNow,
        });
      }
    },
    [handleSceneSeek, quizAwaitingInteraction, quizSeekMaxMs, scene.slide_elements, showActionHint],
  );

  const handleLandscapeVolumeDelta = useCallback(
    (deltaPercent: number) => {
      if (deltaPercent === 0) return;
      setMasterVolumePercent((prev) => {
        const next = clamp(prev + deltaPercent, 0, 100);
        showActionHint({ kind: "volume", percent: next });
        return next;
      });
    },
    [showActionHint],
  );

  const handleLandscapeSeekEnd = useCallback((): void => {
    landscapeGestureOriginSceneMsRef.current = null;
  }, []);

  const handleLandscapeSeekDelta = useCallback(
    (deltaMs: number, _gestureTotalMs: number) => {
      if (deltaMs === 0) return;
      const slides = scene.slide_elements;
      const slideIndex = effectiveSlideIndexRef.current;
      const maxScene =
        quizAwaitingInteraction && quizSeekMaxMs != null
          ? getScenePlayheadMs(slides, slideIndex, quizSeekMaxMs)
          : getSceneTotalDurationMs(slides);
      const sceneNow = getScenePlayheadMs(slides, slideIndex, currentTimeRef.current);
      if (landscapeGestureOriginSceneMsRef.current === null) {
        landscapeGestureOriginSceneMsRef.current = sceneNow;
      }
      const targetScene = clamp(sceneNow + deltaMs, 0, maxScene);
      const seekResult = handleSceneSeek(targetScene);
      if (!seekResult.redirectedToQuiz) {
        const displayDeltaMs = seekResult.appliedSceneMs - landscapeGestureOriginSceneMsRef.current;
        showActionHint({
          kind: "seek",
          timeMs: seekResult.appliedSceneMs,
          deltaMs: displayDeltaMs,
        });
      }
    },
    [handleSceneSeek, quizAwaitingInteraction, quizSeekMaxMs, scene.slide_elements, showActionHint],
  );

  const landscapeGestureHandlers = usePreviewLandscapeGestures({
    enabled: isForceLandscapeFullscreen && !isCoursewareAccessLocked && !isSceneBootstrapping,
    onSeek: handleLandscapeSeekDelta,
    onVolumeDelta: handleLandscapeVolumeDelta,
    onSeekEnd: handleLandscapeSeekEnd,
  });

  /** With an unanswered quiz, the clock can't be started from the "play" entry (consistent with the old logic) */
  useEffect(() => {
    if (!isPlaying || isPlaybackLoading) return;
    if (
      activeQuizQuestion &&
      !activeQuizQuestionState?.submitted &&
      !activeQuizQuestionState?.skipped
    ) {
      setIsPlaying(false);
    }
  }, [
    activeQuizQuestion,
    activeQuizQuestionState?.skipped,
    activeQuizQuestionState?.submitted,
    isPlaybackLoading,
    isPlaying,
  ]);

  /**
   * Playback clock: rAF writes only playheadRef; the root component writes currentTime at about 12Hz for the control bar/quiz logic.
   */
  useEffect(() => {
    if (!playheadClockRunning) return;

    let raf = 0;
    let last = performance.now();
    let lastUiPublishAt = performance.now();

    const quizUnfinished = (quizEl: QuizSlideElement): boolean => {
      const st = quizStateRef.current[quizEl.element_id];
      return !st?.submitted && !st?.skipped;
    };

    /** Quiz stop: the ref is in place but React's currentTime is still throttled by ~80ms, so state must sync immediately and stop playback. */
    const syncQuizWallPause = (
      wall: number,
      quizEl: QuizSlideElement | null,
      crossedWall: boolean,
      now: number,
    ): void => {
      queueMicrotask(() => {
        if (isPlayingRef.current) {
          isPlayingRef.current = false;
          setIsPlaying(false);
        }
        startTransition(() => setCurrentTime(wall));
        if (crossedWall && quizEl) {
          appendLogRef.current(
            t("coursewarePreview.playback.logQuizEncountered", {
              name: quizEl.name || quizEl.quiz_question_id,
            }),
          );
        }
      });
      lastUiPublishAt = now;
    };

    const tick = (now: number): void => {
      if (!isPlayingRef.current) return;

      const prev = currentTimeRef.current;
      const drivenMs = narrationPlayheadDriveRef.current;

      const blockWallClockForLoading = [...playbackLoadingTokensRef.current].some(
        (token) => !token.startsWith("narration:"),
      );
      if (drivenMs === null && blockWallClockForLoading) {
        last = now;
        raf = requestAnimationFrame(tick);
        return;
      }
      const pendingElapsed = narrationPendingStartElapsedMs(now);
      if (drivenMs === null && pendingElapsed !== null) {
        // Cold start wait: the narration audio isn't ready, so the scene clock freezes at the segment start (once ready it plays fully from 0,
        // no more seeking to catch up and swallowing the beginning); elapsed increases monotonically, and after the timeout it naturally returns to the wall clock without rearming.
        if (pendingElapsed >= NARRATION_COLD_START_HOLD_MS) {
          // 15s escape: pause everything (video/BGM/narration stop together, so media doesn't drift during the freeze),
          // and pressing play again retries that segment from the start.
          queueMicrotask(() => {
            isPlayingRef.current = false;
            setIsPlaying(false);
          });
        }
        last = now;
        raf = requestAnimationFrame(tick);
        return;
      }
      let rawNext: number;
      if (drivenMs !== null) {
        rawNext = drivenMs;
        last = now;
      } else {
        const dt = (now - last) * rateRef.current;
        last = now;
        rawNext = prev + dt;
      }
      let next = rawNext;
      const slideLocal = slideRef.current;
      const sceneQuiz = sceneQuizRef.current;
      const durationLocal = slideDurationRef.current;

      const blockAtRaw = getActiveQuizQuestion(slideLocal, sceneQuiz, rawNext, quizStateRef.current);
      if (blockAtRaw && quizUnfinished(blockAtRaw)) {
        const wall = getQuizQuestionPlaybackPauseStartAt(slideLocal, blockAtRaw);
        if (rawNext > wall) {
          next = wall;
          const crossedWall = prev < wall;
          if (isPlayingRef.current || crossedWall) {
            syncQuizWallPause(wall, blockAtRaw, crossedWall, now);
          }
        }
      }

      const blockAtNext = getActiveQuizQuestion(slideLocal, sceneQuiz, next, quizStateRef.current);
      if (blockAtNext && quizUnfinished(blockAtNext)) {
        const wall = getQuizQuestionPlaybackPauseStartAt(slideLocal, blockAtNext);
        next = Math.min(next, wall);
      }

      const flowCrossing = findFlowPauseCrossing(
        getSlideFlowPausePoints(slideLocal),
        prev,
        next,
        flowPauseAcknowledgedRef.current,
      );
      let hitFlowPause = false;
      if (flowCrossing) {
        next = flowCrossing.at_ms;
        hitFlowPause = true;
        narrationPlayheadDriveRef.current = null;
        if (isPlayingRef.current) {
          queueMicrotask(() => {
            isPlayingRef.current = false;
            setIsPlaying(false);
          });
        }
      }

      if (next >= durationLocal) {
        if (hitFlowPause) {
          currentTimeRef.current = next;
          if (now - lastUiPublishAt >= PLAYBACK_UI_PUBLISH_MS) {
            lastUiPublishAt = now;
            startTransition(() => setCurrentTime(next));
          }
          raf = requestAnimationFrame(tick);
          return;
        }
        const narrationBlockingAdvance = narrationSlideAdvanceBlockersRef.current.size > 0;
        const unf = firstUnfinishedQuizWrapperOnSlide(slideLocal, sceneQuiz, quizStateRef.current);
        if (unf) {
          const wall = getQuizQuestionPlaybackPauseStartAt(slideLocal, unf);
          next = Math.min(next, wall, durationLocal);
          if (isPlayingRef.current || prev < next) {
            syncQuizWallPause(next, null, false, now);
          }
        } else if (narrationBlockingAdvance) {
          next = durationLocal;
        } else if (
          slideCountRef.current > 0 &&
          effectiveSlideIndexRef.current < slideCountRef.current - 1
        ) {
          if (!previewSlideAdvanceScheduledRef.current) {
            previewSlideAdvanceScheduledRef.current = true;
            const overflow = Math.max(0, next - durationLocal);
            const nextSlide = scene.slide_elements[effectiveSlideIndexRef.current + 1];
            pendingPreviewSeekRef.current = {
              localTimeMs: nextSlide
                ? clamp(overflow, 0, getSlidePlaybackDurationMs(nextSlide))
                : 0,
              resumePlayback: true,
            };
            queueMicrotask(() => {
              sceneRuntimeRef.current.nextSlide();
            });
          }
          next = durationLocal;
        } else if (!narrationBlockingAdvance) {
          queueMicrotask(() => {
            isPlayingRef.current = false;
            setIsPlaying(false);
          });
          next = durationLocal;
        } else {
          next = durationLocal;
        }
      }

      currentTimeRef.current = next;

      const publishUi =
        now - lastUiPublishAt >= PLAYBACK_UI_PUBLISH_MS || next >= durationLocal;
      if (publishUi) {
        lastUiPublishAt = now;
        startTransition(() => setCurrentTime(next));
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playheadClockRunning]);

  useEffect(() => {
    if (isPlaying) return;
    narrationPlayheadDriveRef.current = null;
    clearPlaybackLoadingTokens("pause");
    // After pausing, the progress bar reads state rather than the ref, so the rAF landing point must sync over (otherwise a 5s slide often sticks at ~4.9s → 00:04).
    const synced = currentTimeRef.current;
    startTransition(() => {
      setCurrentTime((prev) => (prev === synced ? prev : synced));
    });
  }, [clearPlaybackLoadingTokens, isPlaying]);

  // Clean up the loading token after switching slides; the idle cover refreshes only at 0s within the slide.
  useEffect(() => {
    previewSlideAdvanceScheduledRef.current = false;
    narrationSlideAdvanceBlockersRef.current.clear();
    flowPauseAcknowledgedRef.current.clear();
    narrationPlayheadDriveRef.current = null;
    clearPlaybackLoadingTokens("slide-change");
    if (currentTimeRef.current <= 0) {
      syncSlideCoverLocalTime(scene.slide_elements[currentSlideIndex]);
    }
  }, [clearPlaybackLoadingTokens, currentSlideIndex, scene.slide_elements, syncSlideCoverLocalTime]);

  const getQuizPostSubmitMode = useCallback(
    (questionWrapperId: string): "continue" | "seek_next" => {
      const quizCfg = scene.quiz;
      const ordered = scene.slide_elements.flatMap((candidateSlide, slideIndex) =>
        candidateSlide.children_elements
          .filter((element): element is QuizSlideElement => element.element_type === "quiz")
          .filter((quizEl) => getQuestionConfig(quizCfg, quizEl))
          .map((quizEl) => ({
            question: quizEl,
            slideIndex,
          })),
      );
      const idx = ordered.findIndex((item) => item.question.element_id === questionWrapperId);
      if (idx < 0) return "continue";
      const cur = ordered[idx]!;
      /** The last question in the quiz settings: the main button can only be "continue" (keep playing this slide / the submit logic), never "next question". */
      const lastQuizQuestionId =
        quizCfg?.enabled && quizCfg.questions.length > 0
          ? quizCfg.questions[quizCfg.questions.length - 1]!.question_id
          : null;
      if (
        lastQuizQuestionId &&
        cur.question.quiz_question_id === lastQuizQuestionId
      ) {
        return "continue";
      }
      const hasGapContent = hasPlayableContentAfterQuizWrapper(
        quizCfg,
        scene.slide_elements,
        questionWrapperId,
      );
      if (hasGapContent) return "continue";
      return isNextBoundQuizOnSameSlide(quizCfg, scene.slide_elements, questionWrapperId)
        ? "seek_next"
        : "continue";
    },
    [scene],
  );

  const seekToNextQuizOnSameSlide = useCallback(
    (questionWrapperId: string): void => {
      const ordered = scene.slide_elements.flatMap((candidateSlide, slideIndex) =>
        candidateSlide.children_elements
          .filter((element): element is QuizSlideElement => element.element_type === "quiz")
          .filter((quizEl) => getQuestionConfig(scene.quiz, quizEl))
          .map((quizEl) => ({
            question: quizEl,
            slideIndex,
            startAt: quizEl.timeline.start_at,
          })),
      );
      const currentIndex = ordered.findIndex((item) => item.question.element_id === questionWrapperId);
      const next = currentIndex >= 0 ? ordered[currentIndex + 1] : undefined;
      if (!next || next.slideIndex !== currentSlideIndex) return;
      currentTimeRef.current = next.startAt;
      setCurrentTime(next.startAt);
      setIsPlaying(true);
    },
    [currentSlideIndex, scene.quiz, scene.slide_elements],
  );

  const advancePlaybackAfterQuizAction = useCallback(
    (questionWrapperId: string): void => {
      if (getQuizPostSubmitMode(questionWrapperId) === "seek_next") {
        seekToNextQuizOnSameSlide(questionWrapperId);
        return;
      }
      if (!hasPlayableContentAfterQuizWrapper(scene.quiz, scene.slide_elements, questionWrapperId)) {
        pendingPreviewSeekRef.current = { localTimeMs: 0, resumePlayback: true };
        sceneRuntime.nextSlide();
        setIsPlaying(true);
        return;
      }
      setIsPlaying(true);
    },
    [
      getQuizPostSubmitMode,
      scene.quiz,
      scene.slide_elements,
      sceneRuntime,
      seekToNextQuizOnSameSlide,
    ],
  );

  const onQuizPostSubmitPrimary = useCallback(
    (questionWrapperId: string): void => {
      advancePlaybackAfterQuizAction(questionWrapperId);
    },
    [advancePlaybackAfterQuizAction],
  );

  const getQuizPostSubmitPrimaryLabel = useCallback(
    (questionWrapperId: string): string =>
      buildQuizPostSubmitPrimaryLabel(t, getQuizPostSubmitMode(questionWrapperId)),
    [getQuizPostSubmitMode, t],
  );

  /** Skip an optional question: mark it handled and seek or keep playing by the gap strategy */
  const skipQuizQuestion = useCallback(
    (questionWrapperId: string): void => {
      const previousState = quizState[questionWrapperId] ?? createEmptyQuizQuestionState();
      if (previousState.isSubmitting || previousState.submitted || previousState.skipped) {
        return;
      }
      const advanceAfterSkip = (): void => {
        advancePlaybackAfterQuizAction(questionWrapperId);
      };
      const orgId = sectionContext?.orgId?.trim();
      const sectionCourseId = sectionContext?.courseId;
      const sectionIdForSubmit = sectionContext?.sectionId;
      const needsBackendSkip = Boolean(
        orgId && sectionCourseId && sectionIdForSubmit && previewCoursewareId && scene.quiz?.enabled,
      );

      if (!needsBackendSkip) {
        setQuizState((prev) => ({
          ...prev,
          [questionWrapperId]: {
            ...previousState,
            submitted: true,
            skipped: true,
            canAdvance: true,
            isSubmitting: false,
            feedback: null,
            score: null,
          },
        }));
        advanceAfterSkip();
        return;
      }

      const located = findTopLevelQuizWrapper(
        scene.slide_elements,
        questionWrapperId,
        topLevelQuizWrapperIndex,
      );
      if (!located) return;
      const question = getQuestionConfig(scene.quiz, located.quizEl);
      if (!question || question.required !== false) return;

      const orgIdForSkip = orgId as string;
      const coursewareIdForSkip = previewCoursewareId as string;
      const sectionCourseIdForSkip = sectionCourseId as string;
      const sectionIdForSkip = sectionIdForSubmit as string;

      setQuizState((prev) => ({
        ...prev,
        [questionWrapperId]: {
          ...previousState,
          isSubmitting: true,
          feedback: null,
          feedback_detail: null,
        },
      }));

      void (async () => {
        try {
          const result: SubmitCoursewareQuizAnswerResponse = await coursewareApi.submitQuizAnswer(
            orgIdForSkip,
            {
              courseware_id: coursewareIdForSkip,
              course_id: sectionCourseIdForSkip,
              section_id: sectionIdForSkip,
              scene_id: scene.scene_id,
              slide_element_id: located.slide.element_id,
              language,
              question_id: question.question_id,
              question_wrapper_id: questionWrapperId,
              ...(quizAttemptSessionIdRef.current
                ? { attempt_session_id: quizAttemptSessionIdRef.current }
                : {}),
              submission_id: genUuid(),
              answer: buildCoursewareQuizSkippedAnswer(),
              ...(quizQuestionsExpectedCount > 0
                ? { quiz_total_required: quizQuestionsExpectedCount }
                : {}),
              ...(requiredQuizWrapperIds.length > 0
                ? { required_question_wrapper_ids: requiredQuizWrapperIds }
                : {}),
            },
          );
          if (result.attempt_session_id) {
            persistQuizAttemptSessionId(
              quizAttemptSessionStorageKey,
              quizAttemptSessionIdRef,
              result.attempt_session_id,
            );
          }
          const displayFeedback = resolveQuizSubmitDisplayFeedback(
            result,
            {
              insufficientCreditsMessage: t("coursewarePreview.quiz.insufficientCreditsContactAdmin"),
              missingRecordingMessage: t("coursewarePreview.quiz.missingRecording"),
              unsupportedQuestionTypeMessage: t("coursewarePreview.quiz.unsupportedQuestionType"),
            },
          );
          if (!result.can_advance) {
            setQuizState((prev) => ({
              ...prev,
              [questionWrapperId]: {
                ...previousState,
                isSubmitting: false,
                submitted: false,
                skipped: false,
                canAdvance: false,
                score: result.score,
                feedback: displayFeedback,
                feedback_detail: result.feedback_detail ?? null,
              },
            }));
            toast.error(
              displayFeedback || t("coursewarePreview.quiz.scoreNotMet"),
            );
            return;
          }
          const nextQuestionState: QuizQuestionState = {
            ...previousState,
            submitted: true,
            skipped: true,
            canAdvance: true,
            isSubmitting: false,
            feedback: displayFeedback,
            feedback_detail: result.feedback_detail ?? null,
            score: result.score,
          };
          setQuizState((prev) => ({
            ...prev,
            [questionWrapperId]: nextQuestionState,
          }));
          advanceAfterSkip();
          handleQuizSubmitSucceeded(questionWrapperId, nextQuestionState);
        } catch (error) {
          const message =
            error instanceof Error
              ? resolveQuizSubmitErrorMessage(
                error,
                error.message,
                t("coursewarePreview.quiz.aiScoringRetry"),
              )
              : t("coursewarePreview.errors.submitFailed");
          setQuizState((prev) => ({
            ...prev,
            [questionWrapperId]: {
              ...previousState,
              isSubmitting: false,
              submitted: false,
              skipped: false,
              canAdvance: false,
              feedback: message,
              feedback_detail: null,
            },
          }));
          toast.error(message);
          logger.error("courseware preview optional quiz skip submit failed", error);
        }
      })();
    },
    [
      advancePlaybackAfterQuizAction,
      handleQuizSubmitSucceeded,
      language,
      previewCoursewareId,
      quizAttemptSessionStorageKey,
      quizQuestionsExpectedCount,
      quizState,
      requiredQuizWrapperIds,
      scene.quiz,
      scene.scene_id,
      scene.slide_elements,
      sectionContext,
      t,
      topLevelQuizWrapperIndex,
    ],
  );

  const syncForceLandscapeViewport = useCallback(() => {
    if (typeof window === "undefined") return;

    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;

    setForceLandscapeViewport((prev) => {
      if (prev.width === viewportWidth && prev.height === viewportHeight) {
        return prev;
      }
      return {
        width: viewportWidth,
        height: viewportHeight,
      };
    });
  }, []);

  const enterBrowserFullscreen = useCallback(async (el: HTMLElement) => {
    const anyEl = el as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    try {
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if (anyEl.webkitRequestFullscreen) {
        await anyEl.webkitRequestFullscreen();
      }
    } catch (err) {
      logger.warn("[Courseware Preview] requestFullscreen failed, falling back to CSS-only", err);
    }
  }, []);

  const exitBrowserFullscreen = useCallback(async () => {
    const anyDoc = document as Document & {
      webkitExitFullscreen?: () => Promise<void>;
      webkitFullscreenElement?: Element | null;
    };
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (anyDoc.webkitFullscreenElement && anyDoc.webkitExitFullscreen) {
        await anyDoc.webkitExitFullscreen();
      }
    } catch (err) {
      logger.warn("[Courseware Preview] exitFullscreen failed", err);
    }
  }, []);

  const getFullscreenElement = useCallback(() => {
    const anyDoc = document as Document & { webkitFullscreenElement?: Element | null };
    return document.fullscreenElement || anyDoc.webkitFullscreenElement || null;
  }, []);

  const toggleForceLandscapeFullscreen = useCallback(async () => {
    if (!isForceLandscapeEligible || !playerRootRef.current) return;
    if (isForceLandscapeFullscreen) {
      await exitBrowserFullscreen();
      setIsForceLandscapeFullscreen(false);
    } else {
      await enterBrowserFullscreen(playerRootRef.current);
      setIsForceLandscapeFullscreen(true);
    }
  }, [
    enterBrowserFullscreen,
    exitBrowserFullscreen,
    isForceLandscapeEligible,
    isForceLandscapeFullscreen,
  ]);

  const showLandscapeButton =
    isForceLandscapeEligible && !isCoursewareAccessLocked && !isSceneBootstrapping;
  const { buttonVisible: landscapeButtonVisible, revealButton: revealLandscapeButton } =
    useLandscapeButtonAutoHide(showLandscapeButton);

  useEffect(() => {
    const mq = window.matchMedia(PREVIEW_NARROW_VIEWPORT_MEDIA);
    const apply = (): void => setIsNarrowViewport(mq.matches);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(PREVIEW_FORCE_LANDSCAPE_VIEWPORT_MEDIA);
    const apply = (): void => setIsForceLandscapeEligible(mq.matches);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!isForceLandscapeEligible && isForceLandscapeFullscreen) {
      void exitBrowserFullscreen();
      setIsForceLandscapeFullscreen(false);
    }
  }, [exitBrowserFullscreen, isForceLandscapeEligible, isForceLandscapeFullscreen]);

  useEffect(() => {
    syncForceLandscapeViewport();

    const visualViewport = window.visualViewport;
    const handleViewportChange = (): void => syncForceLandscapeViewport();

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("orientationchange", handleViewportChange);
    visualViewport?.addEventListener("resize", handleViewportChange);
    visualViewport?.addEventListener("scroll", handleViewportChange);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("orientationchange", handleViewportChange);
      visualViewport?.removeEventListener("resize", handleViewportChange);
      visualViewport?.removeEventListener("scroll", handleViewportChange);
    };
  }, [syncForceLandscapeViewport]);

  useEffect(() => {
    if (!isForceLandscapeFullscreen) return;

    syncForceLandscapeViewport();

    const raf1 = window.requestAnimationFrame(() => {
      syncForceLandscapeViewport();
    });
    const raf2 = window.requestAnimationFrame(() => {
      syncForceLandscapeViewport();
    });
    const timeoutId = window.setTimeout(() => {
      syncForceLandscapeViewport();
    }, 250);

    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      window.clearTimeout(timeoutId);
    };
  }, [isForceLandscapeFullscreen, syncForceLandscapeViewport]);

  // Fullscreen listeners
  useEffect(() => {
    const onChange = (): void => {
      syncForceLandscapeViewport();
      const fsEl = getFullscreenElement();
      setIsFullscreen(Boolean(fsEl));
      if (!fsEl) {
        setIsForceLandscapeFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, [getFullscreenElement, syncForceLandscapeViewport]);

  useEffect(() => {
    return () => {
      if (getFullscreenElement()) {
        void exitBrowserFullscreen();
      }
    };
  }, [exitBrowserFullscreen, getFullscreenElement]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.code === "Space") {
        if (quizAwaitingInteraction) return;
        e.preventDefault();
        togglePlayPause();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        handleKeyboardSeek(PREVIEW_KEYBOARD_SEEK_MS);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        handleKeyboardSeek(-PREVIEW_KEYBOARD_SEEK_MS);
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        setMasterVolumePercent((prev) => {
          const next = clamp(prev + PREVIEW_KEYBOARD_VOLUME_STEP, 0, 100);
          showActionHint({ kind: "volume", percent: next });
          return next;
        });
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        setMasterVolumePercent((prev) => {
          const next = clamp(prev - PREVIEW_KEYBOARD_VOLUME_STEP, 0, 100);
          showActionHint({ kind: "volume", percent: next });
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleKeyboardSeek, quizAwaitingInteraction, showActionHint, togglePlayPause]);

  const runBinding = useCallback(
    (element: CourseElement): void => {
      const binding = element.event_bindings.find((b) => b.event === "click" && b.enabled);
      if (!binding) return;
      appendLog(
      t("coursewarePreview.playback.logElementClick", {
        name: element.name,
        actionId: binding.action_id,
      }),
    );
      try {
        executeElementBinding(element, binding, elementRuntime, {});
      } catch (err) {
        appendLog(
        t("coursewarePreview.playback.logBindingFailed", {
          message: (err as Error).message,
        }),
      );
      }
    },
    [elementRuntime, appendLog],
  );

  const handleFullscreenToggle = useCallback((): void => {
    if (!playerRootRef.current) return;
    if (!getFullscreenElement()) {
      void enterBrowserFullscreen(playerRootRef.current);
    } else {
      void exitBrowserFullscreen();
    }
  }, [enterBrowserFullscreen, exitBrowserFullscreen, getFullscreenElement]);

  const isPreviewCanvasBackgroundTarget = useCallback((target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    return !isPreviewGestureIgnoredTarget(target);
  }, []);

  /** A single click on the canvas: toggles the top/bottom bars in fullscreen (touch devices have no hover); in landscape mode it also shows the floating landscape buttons. */
  const handlePreviewCanvasClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (!isPreviewCanvasBackgroundTarget(e.target)) return;
      if (isFullscreen) {
        if (fullscreenChromeVisible) {
          hideFullscreenChrome();
        } else {
          revealFullscreenChrome();
        }
      }
      if (showLandscapeButton) {
        revealLandscapeButton();
      }
    },
    [
      fullscreenChromeVisible,
      hideFullscreenChrome,
      isFullscreen,
      isPreviewCanvasBackgroundTarget,
      revealFullscreenChrome,
      revealLandscapeButton,
      showLandscapeButton,
    ],
  );

  /** Double-clicking the preview picture area enters/leaves fullscreen (double-clicking interactive controls doesn't). */
  const handlePreviewCanvasDoubleClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      if (isCoursewareAccessLocked || isSceneBootstrapping) return;
      if (!isPreviewCanvasBackgroundTarget(e.target)) return;
      handleFullscreenToggle();
    },
    [handleFullscreenToggle, isCoursewareAccessLocked, isPreviewCanvasBackgroundTarget, isSceneBootstrapping],
  );

  const openAssistantTab = useCallback((tab: AssistantTab): void => {
    setAssistantTab(tab);
    setAssistantOpen(true);
  }, []);

  const handleToggleAssistantHistory = useCallback((): void => {
    if (assistantOpen && assistantTab === "history") {
      setAssistantOpen(false);
      return;
    }
    openAssistantTab("history");
  }, [assistantOpen, assistantTab, openAssistantTab]);

  const stopVoiceInput = useCallback((): void => {
    setIsVoiceInputOpen(false);
    void voiceDictation.stop();
  }, [voiceDictation]);

  const handleVoiceInputToggle = useCallback((): void => {
    if (isVoiceInputOpen) {
      stopVoiceInput();
      return;
    }
    if (assistantBusy) return;
    setIsVoiceInputOpen(true);
    openAssistantTab("history");
    void voiceDictation.start();
  }, [assistantBusy, isVoiceInputOpen, openAssistantTab, stopVoiceInput, voiceDictation]);

  const handleOpenTextInput = useCallback((): void => {
    stopVoiceInput();
    openAssistantTab("history");
    setChatInputFocusSeq((seq) => seq + 1);
  }, [openAssistantTab, stopVoiceInput]);

  const patchAssistantMessage = useCallback(
    (
      messageId: string,
      patch: Partial<Pick<AssistantMessage, "text" | "blocks" | "isStreaming">>,
    ): void => {
      setAssistantMessages((prev) =>
        prev.map((message) => (message.id === messageId ? { ...message, ...patch } : message)),
      );
    },
    [],
  );

  const handleSubmitAgentUserQuestion = useCallback(
    async (args: { requestId: string; answers: Record<string, string> }) => {
      const requestId = args.requestId.trim();
      if (!requestId) return;

      let toolUseId = "";
      setAssistantMessages((prev) => {
        for (const message of prev) {
          for (const block of message.blocks ?? []) {
            if (block.type === "user_question" && block.requestId === requestId) {
              toolUseId = block.toolUseId;
              break;
            }
          }
          if (toolUseId) break;
        }
        return prev;
      });

      await postInteractionPermissionAnswer({
        requestId,
        toolUseId: toolUseId || requestId,
        answers: args.answers,
      });

      setAssistantMessages((prev) =>
        prev.map((message) => {
          if (!message.blocks?.length) return message;
          const nextBlocks = applyCoursewareAgentChatUiEvents(message.blocks, [
            { kind: "user_question_answered", requestId },
          ]);
          return {
            ...message,
            blocks: nextBlocks,
            text: coursewareAiAssistantBlocksToPlainText(nextBlocks),
          };
        }),
      );
    },
    [],
  );

  const handleAssistantMessageSubmit = useCallback(
    (text: string): void => {
      const value = text.trim();
      if (!value || assistantBusy) return;

      if (!isInteractionApiConfigured()) {
        const errorId = `assistant-error-${Date.now()}`;
        setAssistantMessages((prev) => [
          ...prev,
          {
            id: errorId,
            role: "assistant",
            text: t("coursewarePreview.assistant.errorNotConfigured"),
            timestampMs: Date.now(),
          },
        ]);
        openAssistantTab("history");
        return;
      }

      const userMessageId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const assistantMessageId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const nowMs = Date.now();

      setAssistantMessages((prev) => [
        ...prev,
        {
          id: userMessageId,
          role: "user",
          text: value,
          timestampMs: nowMs,
        },
        {
          id: assistantMessageId,
          role: "assistant",
          text: "",
          blocks: [],
          timestampMs: nowMs,
          isStreaming: true,
        },
      ]);
      stopVoiceInput();
      setAssistantChatDraft("");
      openAssistantTab("history");
      setAssistantBusy(true);

      interactionAbortRef.current?.abort();
      const abort = new AbortController();
      interactionAbortRef.current = abort;
      const runId = (interactionStreamRunIdRef.current += 1);
      const chatStreamSessionId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `preview_cs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

      abort.signal.addEventListener(
        "abort",
        () => {
          interactionStreamRunIdRef.current += 1;
          void postInteractionChatStreamAbort(chatStreamSessionId).catch((error: unknown) => {
            console.warn("interaction agent chat stream abort", error);
          });
        },
        { once: true },
      );

      const streamState = createAgentChatStreamState();
      const seenChatStreamEntryIds = new Set<string>();
      let blocks: CoursewareAiAssistantBlock[] = [];
      let sawUiEvents = false;

      const flushAssistantBlocks = (): void => {
        if (runId !== interactionStreamRunIdRef.current) return;
        const rendered = coursewareAiAssistantBlocksToPlainText(blocks).trim();
        patchAssistantMessage(assistantMessageId, {
          text: rendered,
          blocks: [...blocks],
          isStreaming: true,
        });
      };

      const appendAssistantUiEvents = (events: CoursewareAgentChatUiEvent[]): void => {
        if (!events.length || runId !== interactionStreamRunIdRef.current) return;
        for (const event of events) {
          if (event.kind === "prose") {
            const key = event.text.trim();
            if (key) streamState.seenTextBlocks.add(key);
          }
        }
        blocks = applyCoursewareAgentChatUiEvents(blocks, events);
        flushAssistantBlocks();
      };

      void (async () => {
        const chatBody = buildInteractionAgentChatStreamBody({
          prompt: value,
          orgId: sectionContext?.orgId ?? quizSubmitOrgId,
          courseId: sectionContext?.courseId,
          sectionId: sectionContext?.sectionId,
          chapterId: sectionContext?.chapterId,
          coursewareId: previewCoursewareId,
          aiTeacherId: previewAiTeacherId,
          sessionId: interactionSessionIdRef.current,
          conversationId: interactionConversationIdRef.current,
          beforeContext: buildPreviewAssistantSlideContext(
            scene.name,
            effectiveSlideIndex,
            slideCount,
            slide.name,
          ),
          chatStreamSessionId,
          clientSurface: "course_assistant",
          preferredUiLanguage: language,
        });

        try {
          await postInteractionChatStream(chatBody, {
            signal: abort.signal,
            onEvent: (eventName: string, payload: any) => {
              if (runId !== interactionStreamRunIdRef.current) return;
              const streamEntryId = readRedisStreamCursorFromSseEvent(eventName, payload);
              if (streamEntryId) {
                if (seenChatStreamEntryIds.has(streamEntryId)) return;
                seenChatStreamEntryIds.add(streamEntryId);
              }
              const record = payload as Record<string, unknown>;
              const { sessionId: nextSessionId, conversationId: nextConversationId } =
                readInteractionAgentSseSessionFields(payload);
              if (nextSessionId) interactionSessionIdRef.current = nextSessionId;
              if (nextConversationId) interactionConversationIdRef.current = nextConversationId;

              if (eventName === "ui") {
                sawUiEvents = true;
                appendAssistantUiEvents(parseCoursewareAgentChatUiSsePayload(payload));
              } else if (eventName === "message" && record.message && !sawUiEvents) {
                appendAssistantUiEvents(mapSdkMessageToChatUiEvents(streamState, record.message));
              } else if (eventName === "done") {
                const result = typeof record.result === "string" ? record.result.trim() : "";
                if (result && !streamState.seenTextBlocks.has(result)) {
                  streamState.seenTextBlocks.add(result);
                  appendAssistantUiEvents([{ kind: "prose", text: result }]);
                }
              } else if (eventName === "error") {
                appendAssistantUiEvents(coursewareAgentChatStreamErrorUiEvents(payload, t));
              }
            },
          });
        } catch (error) {
          if (runId !== interactionStreamRunIdRef.current) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          appendAssistantUiEvents(
            coursewareAgentChatStreamErrorUiEvents(error, t),
          );
        } finally {
          if (runId !== interactionStreamRunIdRef.current) return;
          const finalText = coursewareAiAssistantBlocksToPlainText(blocks).trim();
          patchAssistantMessage(assistantMessageId, {
            text: finalText || t("coursewarePreview.assistant.errorGeneric"),
            blocks: [...blocks],
            isStreaming: false,
          });
          setAssistantBusy(false);
          if (interactionAbortRef.current === abort) {
            interactionAbortRef.current = null;
          }
        }
      })();
    },
    [
      assistantBusy,
      effectiveSlideIndex,
      openAssistantTab,
      patchAssistantMessage,
      previewAiTeacherId,
      stopVoiceInput,
      previewCoursewareId,
      quizSubmitOrgId,
      scene.name,
      sectionContext,
      slide.name,
      slideCount,
      t,
    ],
  );

  useEffect(() => {
    return () => {
      interactionStreamRunIdRef.current += 1;
      interactionAbortRef.current?.abort();
      interactionAbortRef.current = null;
    };
  }, []);

  const previewExitHref = useMemo(
    () => resolvePreviewExitHref(sectionContext),
    [sectionContext],
  );

  const previewTopBarProps = {
    sceneName: scene.name,
    currentIndex: currentSlideIndex,
    total: scene.slide_elements.length,
    slideName: resolveSlideDisplayName(slide.name, currentSlideIndex, t),
    assistantOpen,
    onToggleAssistant: () => setAssistantOpen((open) => !open),
    exitHref: previewExitHref,
    overlayMode: isFullscreen,
    chromeVisible: chromeRevealed,
    onChromeHoverStart: isFullscreen ? onChromeHoverStart : undefined,
    onChromeHoverEnd: isFullscreen ? onChromeHoverEnd : undefined,
  } satisfies PreviewTopBarProps;

  const previewControlBarProps = {
    sceneCurrentTimeMs: sceneCurrentTime,
    sceneSlideOffsetMs,
    playheadRef: currentTimeRef,
    playheadFromRef: playheadFromRefForUi,
    playheadClockRunning,
    sceneTotalDurationMs,
    slideBoundaryMarkers,
    flowPauseMarkers,
    isPlaying,
    isPlayLoading: isPlaying && isPlaybackLoading,
    quizAwaitingInteraction,
    rate,
    currentSlideIndex,
    slideCount: scene.slide_elements.length,
    onPlayPause: togglePlayPause,
    onSeek: handleSceneSeek,
    onScrubbingChange: setIsScrubbingProgress,
    onRateChange: setRate,
    onPrevSlide: () => sceneRuntime.previousSlide(),
    onNextSlide: () => {
      const slides = scene.slide_elements;
      const nextIndex = effectiveSlideIndexRef.current + 1;
      if (nextIndex >= slides.length) return;
      handleSceneSeek(getSceneSlideOffsetMs(slides, nextIndex));
    },
    onRestart: restartScenePlayback,
    isFullscreen,
    onFullscreen: handleFullscreenToggle,
    assistantOpen,
    isVoiceInputOpen,
    onOpenHistory: handleToggleAssistantHistory,
    onToggleVoiceInput: handleVoiceInputToggle,
    onOpenTextInput: handleOpenTextInput,
    volumePercent: masterVolumePercent,
    onVolumeChange: setMasterVolumePercent,
    overlayMode: isFullscreen,
    chromeVisible: chromeRevealed,
    onChromeHoverStart: isFullscreen ? onChromeHoverStart : undefined,
    onChromeHoverEnd: isFullscreen ? onChromeHoverEnd : undefined,
    hideFullscreenControl: isForceLandscapeEligible,
    hideAssistantInputControls: isNarrowViewport,
    getVoiceAnalyser: voiceDictation.getAnalyser,
  } satisfies ControlBarProps;

  const fallbackViewportWidth = typeof window !== "undefined" ? window.innerWidth : 0;
  const fallbackViewportHeight = typeof window !== "undefined" ? window.innerHeight : 0;
  const previewRootStyle = {
    "--force-landscape-viewport-width": `${forceLandscapeViewport.width || fallbackViewportWidth}px`,
    "--force-landscape-viewport-height": `${forceLandscapeViewport.height || fallbackViewportHeight}px`,
  } as CSSProperties;

  return (
    <div
      ref={playerRootRef}
      className={`preview-player-root relative min-h-0 w-full min-w-0 max-w-full${
        isForceLandscapeFullscreen ? " force-landscape-root" : " h-dvh"
      }`}
      style={previewRootStyle}
    >
      <div
        className={`preview-player-shell relative flex h-full min-h-0 w-full min-w-0 max-w-full flex-col overflow-hidden bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100${
          isFullscreen && !fullscreenChromeVisible ? " preview-player-cursor-hidden" : ""
        }`}
      >
      {isSceneBootstrapping && !isCoursewareAccessLocked ? (
        <div
          className="absolute inset-0 z-120 flex flex-col items-center justify-center gap-3 bg-slate-950/80 backdrop-blur-sm"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <Loader2 className="h-10 w-10 animate-spin text-blue-400" aria-hidden />
          <p className="text-sm font-medium text-slate-200">{t("coursewarePreview.access.loading")}</p>
        </div>
      ) : null}
      {isCoursewareAccessLocked ? (
        <div
          className="absolute inset-0 z-130 flex items-center justify-center bg-slate-950/90 px-6 backdrop-blur-md"
          role="alert"
        >
          <div className="flex max-w-md flex-col items-center gap-4 rounded-2xl border border-slate-700/80 bg-slate-900/95 px-8 py-10 text-center shadow-2xl">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10 ring-1 ring-amber-500/30">
              <Lock className="h-8 w-8 text-amber-400" strokeWidth={1.75} aria-hidden />
            </div>
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-slate-100">{t("coursewarePreview.access.notPublicTitle")}</h2>
              <p className="text-sm leading-relaxed text-slate-400">
                {t("coursewarePreview.access.notPublicBody")}
              </p>
            </div>
          </div>
        </div>
      ) : null}
      <GlobalAudioTracks
        tracks={scene.audio_elements}
        coursewareId={previewCoursewareId ?? undefined}
        sceneCurrentTime={sceneCurrentTime}
        sceneTimeOffsetMs={sceneSlideOffsetMs}
        playheadRef={currentTimeRef}
        playheadFromRef={playheadFromRefForUi}
        playheadClockRunning={playheadClockRunning}
        pausedSceneTimeMs={currentTime}
        isPlaying={isPlaying}
        playIntent={isPlaying}
        onTrackBufferingChange={handleCanvasAudioTrackBuffering}
        rate={rate}
        volumeMultiplier={masterVolume}
      />
      <GlobalAudioTracks
        tracks={slideCanvasAudioTracks}
        sceneCurrentTime={currentTime}
        sceneTimeOffsetMs={0}
        playheadRef={currentTimeRef}
        playheadFromRef={playheadFromRefForUi}
        playheadClockRunning={playheadClockRunning}
        pausedSceneTimeMs={currentTime}
        isPlaying={isPlaying}
        playIntent={isPlaying}
        onTrackBufferingChange={handleCanvasAudioTrackBuffering}
        rate={rate}
        volumeMultiplier={masterVolume}
      />
      <audio
        ref={quizContentNarrationAudioRef}
        crossOrigin="anonymous"
        preload="metadata"
        className="hidden"
        aria-hidden
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {!isFullscreen ? <PreviewTopBar {...previewTopBarProps} /> : null}

          <PreviewActionHintOverlay hint={actionHint} phase={actionHintPhase} />

          <main
            className={
              isFullscreen
                ? "absolute inset-0 z-0 flex overflow-hidden bg-black"
                : "relative flex min-h-0 flex-1 overflow-hidden bg-black"
            }
            style={isForceLandscapeFullscreen ? { touchAction: "none" } : undefined}
            onClick={handlePreviewCanvasClick}
            onDoubleClick={handlePreviewCanvasDoubleClick}
            onPointerDown={landscapeGestureHandlers.onPointerDown}
            onPointerMove={landscapeGestureHandlers.onPointerMove}
            onPointerUp={landscapeGestureHandlers.onPointerUp}
            onPointerCancel={landscapeGestureHandlers.onPointerCancel}
          >
            <div className="relative z-10 flex h-full min-h-0 min-w-0 flex-1 bg-black">
              <Stage
                previewCoursewareId={previewCoursewareId}
                language={language}
                sectionOrgId={quizSubmitOrgId}
                sectionCourseId={sectionContext?.courseId ?? null}
                sectionId={sectionContext?.sectionId ?? null}
                requiredQuizWrapperIds={requiredQuizWrapperIds}
                htmlIframeLayoutScale={htmlIframeLayoutScale}
                slide={slide}
                allSlides={scene.slide_elements}
                quiz={scene.quiz ?? null}
                sceneId={scene.scene_id}
                quizState={quizState}
                onQuizStateChange={setQuizState}
                currentTime={currentTime}
                idleCoverLocalTimeMs={idleCoverLocalTimeMs}
                playheadRef={currentTimeRef}
                playheadFromRef={playheadFromRefForUi}
                playheadClockRunning={playheadClockRunning}
                isPlaying={isPlaying}
                onPlaybackLoadingTokenChange={applyPlaybackLoadingToken}
                onNarrationSlideAdvanceGate={setNarrationSlideAdvanceGate}
                onNarrationPlayheadDriveChange={setNarrationPlayheadDrive}
                slideTransition={slideTransition}
                inochiUrl={inochiUrl}
                onRunBinding={runBinding}
                getQuizPostSubmitPrimaryLabel={getQuizPostSubmitPrimaryLabel}
                onQuizPostSubmitPrimary={onQuizPostSubmitPrimary}
                onSkipQuestion={skipQuizQuestion}
                onQuizSubmitSucceeded={handleQuizSubmitSucceeded}
                onScoreResult={(passed) =>
                  setScore((current) =>
                    passed
                      ? { ...current, correct: current.correct + 1 }
                      : { ...current, wrong: current.wrong + 1 },
                  )
                }
                onLog={appendLog}
                quizStemAutoplay={previewQuizStemAutoplay}
                activeQuizPauseWrapperId={previewActiveQuizPauseWrapperId}
                onQuizRecordingStarted={pauseQuizPlaybackForRecording}
                quizAttemptSessionIdRef={quizAttemptSessionIdRef}
                quizAttemptSessionStorageKey={quizAttemptSessionStorageKey}
                attachQuestionSnapshotToQuizSubmit={attachQuestionSnapshotToQuizSubmit}
                quizContentNarrationAudioRef={quizContentNarrationAudioRef}
                playbackRate={rate}
                masterVolume={masterVolume}
                forceLandscapeLayoutEpoch={isForceLandscapeFullscreen}
              />
            </div>
          </main>

          {isFullscreen ? <PreviewTopBar {...previewTopBarProps} /> : null}
          <ControlBar {...previewControlBarProps} />
        </div>

        <AssistantPanel
          open={assistantOpen}
          activeTab={assistantTab}
          messages={assistantMessages}
          assistantBusy={assistantBusy}
          assistantHistoryLoading={assistantHistoryLoading}
          knowledgeFiles={knowledgeFiles}
          knowledgeFilesLoading={knowledgeFilesLoading}
          courseTree={courseTree}
          courseTreeLoading={courseTreeLoading}
          sectionContext={sectionContext}
          isVoiceInputOpen={isVoiceInputOpen}
          chatInputFocusSeq={chatInputFocusSeq}
          chatDraft={assistantChatDraft}
          onChatDraftChange={setAssistantChatDraft}
          voiceDictationState={voiceDictation.state}
          voiceDictationError={voiceDictation.error}
          getVoiceAnalyser={voiceDictation.getAnalyser}
          onToggleVoiceInput={handleVoiceInputToggle}
          onSubmitMessage={handleAssistantMessageSubmit}
          onSubmitAgentUserQuestion={handleSubmitAgentUserQuestion}
          onClose={() => setAssistantOpen(false)}
          onTabChange={setAssistantTab}
        />
      </div>

      {showLandscapeButton ? (
        <button
          type="button"
          onClick={() => {
            revealLandscapeButton();
            void toggleForceLandscapeFullscreen();
          }}
          className={`absolute z-60 flex h-10 w-10 items-center justify-center rounded-full bg-slate-900/80 text-white shadow-lg backdrop-blur-md transition-opacity duration-300 hover:bg-slate-900 ${
            landscapeButtonVisible
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0"
          }`}
          style={{
            bottom: "calc(5.5rem + env(safe-area-inset-bottom))",
            right: "calc(0.75rem + env(safe-area-inset-right, 0px))",
          }}
          aria-label={
            isForceLandscapeFullscreen
              ? t("coursewarePreview.controls.exitLandscapeView")
              : t("coursewarePreview.controls.enterLandscapeView")
          }
          aria-hidden={!landscapeButtonVisible}
          tabIndex={landscapeButtonVisible ? 0 : -1}
        >
          {isForceLandscapeFullscreen ? (
            <Minimize2 className="h-5 w-5" aria-hidden />
          ) : (
            <Maximize2 className="h-5 w-5" aria-hidden />
          )}
        </button>
      ) : null}
      </div>
      <PreviewStudentViewStyles />
    </div>
  );
}

// ---------- action hint overlay ----------

function PreviewActionHintOverlay({
  hint,
  phase,
}: {
  hint: PreviewActionHintState | null;
  phase: PreviewActionHintPhase;
}) {
  const { t } = useI18nNew();
  if (!hint) return null;

  const primary =
    hint.kind === "seek"
      ? (() => {
          const seekSeconds = Math.round(Math.abs(hint.deltaMs) / 1000);
          return hint.deltaMs > 0
            ? t("coursewarePreview.hint.seekForward", { seconds: seekSeconds })
            : t("coursewarePreview.hint.seekBack", { seconds: seekSeconds });
        })()
      : hint.kind === "quiz_required"
        ? t("coursewarePreview.hint.quizRequired")
        : t("coursewarePreview.hint.volume", { percent: hint.percent });

  return (
    <div
      className="pointer-events-none absolute inset-0 z-110 flex items-center justify-center"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className={`preview-action-hint flex flex-col items-center gap-2 rounded-2xl bg-black/55 px-10 py-6 text-center text-white shadow-2xl backdrop-blur-md ${
          phase === "exiting" ? "preview-action-hint-exiting" : "preview-action-hint-visible"
        }`}
      >
        {hint.kind === "volume" ? (
          <Volume2 className="h-10 w-10 text-white/90" strokeWidth={1.5} aria-hidden />
        ) : hint.kind === "quiz_required" ? (
          <MessageCircleQuestionMark className="h-10 w-10 text-white/90" strokeWidth={1.5} aria-hidden />
        ) : hint.deltaMs > 0 ? (
          <SkipForward className="h-10 w-10 text-white/90" strokeWidth={1.5} aria-hidden />
        ) : (
          <SkipBack className="h-10 w-10 text-white/90" strokeWidth={1.5} aria-hidden />
        )}
        <span className="text-2xl font-semibold tracking-wide tabular-nums">{primary}</span>
        {hint.kind === "seek" ? (
          <span className="font-mono text-sm text-white/75 tabular-nums">{formatTimeMs(hint.timeMs)}</span>
        ) : null}
      </div>
    </div>
  );
}

// ---------- top bar ----------

/** Not shown in the editor iframe embedded preview; "終了" shows only in a standalone tab with history to go back to. */
function usePreviewCanGoBack(): boolean {
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.parent !== window) {
      setCanGoBack(false);
      return;
    }

    const historyIdx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof historyIdx === "number") {
      setCanGoBack(historyIdx > 0);
      return;
    }

    if (!document.referrer) {
      setCanGoBack(false);
      return;
    }

    try {
      setCanGoBack(new URL(document.referrer).origin === window.location.origin);
    } catch {
      setCanGoBack(false);
    }
  }, []);

  return canGoBack;
}

interface PreviewTopBarProps {
  sceneName: string;
  currentIndex: number;
  total: number;
  slideName: string;
  assistantOpen: boolean;
  onToggleAssistant: () => void;
  exitHref?: string | null;
  overlayMode?: boolean;
  chromeVisible?: boolean;
  onChromeHoverStart?: () => void;
  onChromeHoverEnd?: () => void;
}

function PreviewTopBar({
  sceneName,
  currentIndex,
  total,
  slideName,
  assistantOpen,
  onToggleAssistant,
  exitHref = null,
  overlayMode = false,
  chromeVisible = true,
  onChromeHoverStart,
  onChromeHoverEnd,
}: PreviewTopBarProps) {
  const { t } = useI18nNew();
  const navigate = useNavigate();
  const canGoBack = usePreviewCanGoBack();
  const showExit = Boolean(exitHref) || canGoBack;
  const revealed = !overlayMode || chromeVisible;
  const exitControlClassName =
    "flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-slate-800 opacity-70 transition-all hover:bg-black/5 hover:opacity-100 sm:px-2.5 dark:text-slate-200 dark:hover:bg-white/10";

  return (
    <header
      onPointerEnter={onChromeHoverStart}
      onPointerLeave={onChromeHoverEnd}
      className={`z-50 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-black/5 bg-white px-3 sm:h-16 sm:px-6 dark:border-white/5 dark:bg-slate-900 ${
        overlayMode
          ? `preview-chrome-overlay-top ${revealed ? "preview-chrome-overlay-visible" : "preview-chrome-overlay-hidden"}`
          : "relative"
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
        {showExit ? (
          exitHref ? (
            <a
              href={exitHref}
              aria-label={t("player.header.exit")}
              className={`${exitControlClassName} no-underline`}
            >
              <ArrowLeft className="h-[18px] w-[18px]" aria-hidden />
              <span className="hidden sm:inline">{t("player.header.exit")}</span>
            </a>
          ) : (
            <button
              type="button"
              onClick={() => navigate(-1)}
              aria-label={t("player.header.exit")}
              className={exitControlClassName}
            >
              <ArrowLeft className="h-[18px] w-[18px]" aria-hidden />
              <span className="hidden sm:inline">{t("player.header.exit")}</span>
            </button>
          )
        ) : null}
        <div
          className={`min-w-0 flex-1 ${showExit ? "sm:ml-2 md:ml-5" : ""}`}
        >
          <div className="truncate text-[13px] font-bold tracking-wide text-slate-800 sm:text-[15px] dark:text-slate-100">
            {sceneName || t("player.header.loading")}
          </div>
          <div className="truncate text-[10px] text-slate-500 sm:text-[11px] dark:text-slate-400">
            {t("coursewarePreview.controls.slideIndicator", {
              current: currentIndex + 1,
              total,
              slideName,
            })}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onToggleAssistant}
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-semibold text-white transition-all sm:gap-2 sm:px-4 sm:py-2 sm:text-[13px] ${
            assistantOpen
              ? "bg-[#254A5E] dark:bg-sky-600"
              : "bg-[#2F5C75] hover:bg-[#254A5E] dark:bg-sky-500 dark:hover:bg-sky-600"
          }`}
          aria-pressed={assistantOpen}
        >
          <Menu className="h-4 w-4" aria-hidden />
          <span className="hidden min-[380px]:inline sm:inline">{t("player.courseAssistant")}</span>
        </button>
      </div>
    </header>
  );
}

// ---------- stage ----------

const STAGE_HIGHLIGHT_OVERLAY_Z_INDEX = 9999;
const STAGE_VTUBER_Z_INDEX_BASE = STAGE_HIGHLIGHT_OVERLAY_Z_INDEX + 1;
const STAGE_NARRATION_Z_INDEX_BASE = STAGE_HIGHLIGHT_OVERLAY_Z_INDEX + 1000;

function HighlightOverlay({ regions }: { regions: HighlightRegion[] }) {
  if (regions.length === 0) return null;
  const primary = regions.slice().sort((a, b) => b.zIndex - a.zIndex)[0];
  const overlayOpacity = Math.max(
    ...regions.map((region) => region.highlight.overlay_opacity * region.opacityMultiplier),
  );
  const maskPath = [
    `M0 0H${SLIDE_LOGICAL_WIDTH}V${SLIDE_LOGICAL_HEIGHT}H0Z`,
    ...regions.map((region) =>
      roundedRectPath(
        region.x,
        region.y,
        region.width,
        region.height,
        region.highlight.border_radius_px,
      ),
    ),
  ].join(" ");
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      viewBox={`0 0 ${SLIDE_LOGICAL_WIDTH} ${SLIDE_LOGICAL_HEIGHT}`}
      preserveAspectRatio="none"
      style={{ zIndex: STAGE_HIGHLIGHT_OVERLAY_Z_INDEX }}
    >
      <path
        d={maskPath}
        fill={primary.highlight.overlay_color}
        fillOpacity={overlayOpacity}
        fillRule="evenodd"
      />
    </svg>
  );
}

type PreviewVtuberPlacement = {
  sourceKey: string;
  element: VtuberElement;
  slide: SlideElement;
  currentTime: number;
  elementId: string;
  /** Headless rendering: only the current slide's vtuber takes part in compositing; the others stay mounted and warm. */
  stageActive?: boolean;
};

/** Headless rendering: pre-mount the whole courseware deduplicated by sourceKey (active slide first), curing cold-start flashes on page switches at the root. */
function buildHeadlessVtuberPlacements(
  allSlides: SlideElement[],
  activeSlide: SlideElement,
  renderTime: number,
): PreviewVtuberPlacement[] {
  const activeSlideId = activeSlide.element_id;
  const bySourceKey = new Map<string, PreviewVtuberPlacement>();

  for (const sceneSlide of allSlides) {
    const isActive = sceneSlide.element_id === activeSlideId;
    const localTime = isActive ? renderTime : 0;

    for (const element of listVtubersOnSlide(sceneSlide)) {
      const sourceKey = getVtuberSourceKey(element);
      const existing = bySourceKey.get(sourceKey);

      if (isActive) {
        bySourceKey.set(sourceKey, {
          sourceKey,
          element,
          slide: sceneSlide,
          currentTime: localTime,
          elementId: element.element_id,
          stageActive: true,
        });
      } else if (!existing) {
        bySourceKey.set(sourceKey, {
          sourceKey,
          element,
          slide: sceneSlide,
          currentTime: localTime,
          elementId: element.element_id,
          stageActive: false,
        });
      }
    }
  }

  return [...bySourceKey.values()];
}

interface StageProps {
  previewCoursewareId: string | null;
  language: string;
  /** The org for the scoring API (the section's `org_id` or the URL `org_id`); without an org the scoring endpoint can't be called. */
  sectionOrgId: string | null;
  /** For AI scoring, the backend verifies membership of `sectionOrgId` in this context. */
  sectionCourseId: string | null;
  sectionId: string | null;
  requiredQuizWrapperIds: string[];
  htmlIframeLayoutScale?: number;
  slide: SlideElement;
  allSlides: SlideElement[];
  quiz: QuizConfig | null;
  sceneId: string;
  quizState: Record<string, QuizQuestionState>;
  onQuizStateChange: Dispatch<SetStateAction<Record<string, QuizQuestionState>>>;
  currentTime: number;
  idleCoverLocalTimeMs: number;
  playheadRef: RefObject<number>;
  playheadFromRef: boolean;
  playheadClockRunning: boolean;
  isPlaying: boolean;
  onPlaybackLoadingTokenChange: (token: string, isLoading: boolean) => void;
  onNarrationSlideAdvanceGate: (elementId: string, blocking: boolean) => void;
  onNarrationPlayheadDriveChange: (localMs: number | null) => void;
  slideTransition: SlideTransitionState | null;
  inochiUrl: string;
  onRunBinding: (element: CourseElement) => void;
  getQuizPostSubmitPrimaryLabel: (questionWrapperId: string) => string;
  onQuizPostSubmitPrimary: (questionWrapperId: string) => void;
  onSkipQuestion: (questionWrapperId: string) => void;
  /** Callback after a single question submits successfully (for the automatic complete_session on the last question) */
  onQuizSubmitSucceeded?: (quizElementId: string, nextQuestionState: QuizQuestionState) => void;
  onScoreResult: (passed: boolean) => void;
  onLog: (message: string) => void;
  quizStemAutoplay: { wrapperId: string; playUrl: string; nonce: number } | null;
  activeQuizPauseWrapperId: string | null;
  /** Pause the hidden narration track before microphone recording starts */
  onQuizRecordingStarted: () => void;
  /** Courseware quiz attempt session id shared with complete_session. */
  quizAttemptSessionIdRef: RefObject<string | null>;
  quizAttemptSessionStorageKey: string | null;
  /** Editor / localStorage preview: carries the local question snapshot into scoring */
  attachQuestionSnapshotToQuizSubmit: boolean;
  /** The hidden question narration track (shared with the root-level `<audio ref={…} />`). */
  quizContentNarrationAudioRef: RefObject<HTMLAudioElement | null>;
  playbackRate: number;
  masterVolume: number;
  /** After the CSS landscape rotation the stage size must be measured again */
  forceLandscapeLayoutEpoch: boolean;
  /** Headless video rendering: quiz interaction disabled, the playback pipeline kept (narration / VTuber / media gate). */
  rendererMode?: boolean;
  /** Headless rendering warmup: media gate on without starting narration playback. */
  rendererWarmup?: boolean;
  /** Hyperframes per-frame seek: disables the RAF clock and Live2D serial mounting, avoiding screenshot flicker. */
  headlessSeekDrive?: boolean;
  /** Headless rendering: the narration duration table shared with the Hyperframes audio declaration. */
  narrationMeasuredDurationByUrl?: Readonly<Record<string, number>>;
}

function previewSubtreePropsEqual<T extends { currentTime: number; playheadFromRef: boolean; headlessSeekDrive?: boolean }>(
  prev: T,
  next: T,
): boolean {
  const keys = Object.keys(prev) as (keyof T)[];
  for (const key of keys) {
    if (key === "currentTime" && prev.playheadFromRef && next.playheadFromRef && !prev.headlessSeekDrive) {
      continue;
    }
    if (prev[key] !== next[key]) return false;
  }
  return true;
}

const Stage = memo(function Stage({
  previewCoursewareId,
  language,
  sectionOrgId,
  sectionCourseId,
  sectionId,
  requiredQuizWrapperIds,
  htmlIframeLayoutScale,
  slide,
  allSlides,
  quiz,
  sceneId,
  quizState,
  onQuizStateChange,
  currentTime,
  idleCoverLocalTimeMs,
  playheadRef,
  playheadFromRef,
  playheadClockRunning,
  isPlaying,
  onPlaybackLoadingTokenChange,
  onNarrationSlideAdvanceGate,
  onNarrationPlayheadDriveChange,
  slideTransition,
  inochiUrl,
  onRunBinding,
  getQuizPostSubmitPrimaryLabel,
  onQuizPostSubmitPrimary,
  onSkipQuestion,
  onQuizSubmitSucceeded,
  onScoreResult,
  onLog,
  quizStemAutoplay,
  activeQuizPauseWrapperId,
  onQuizRecordingStarted,
  quizAttemptSessionIdRef,
  quizAttemptSessionStorageKey,
  attachQuestionSnapshotToQuizSubmit,
  quizContentNarrationAudioRef,
  playbackRate,
  masterVolume,
  forceLandscapeLayoutEpoch,
  rendererMode = false,
  rendererWarmup = false,
  headlessSeekDrive = false,
  narrationMeasuredDurationByUrl = {},
}: StageProps) {
  const { t, language: uiLanguage } = useI18nNew();
  const playheadMs = usePlaybackPlayheadMs(
    playheadFromRef,
    playheadClockRunning,
    currentTime,
    playheadRef,
  );
  const renderTime = headlessSeekDrive
    ? currentTime
    : playheadFromRef
      ? playheadMs
      : currentTime === 0
        ? idleCoverLocalTimeMs
        : currentTime;
  /** Narration/audio sync uses the real timeline, not the idle cover frame time. */
  const timelineTime = playheadFromRef ? playheadMs : currentTime;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [vtuberLipSyncByElementId, setVtuberLipSyncByElementId] = useState<Record<string, number>>({});
  const [quizImageLightbox, setQuizImageLightbox] = useState<{ src: string; alt: string } | null>(null);

  type RecordingSession = {
    quizElementId: string;
    fieldName: string;
    stream: MediaStream;
    recorder: MediaRecorder;
    chunks: Blob[];
    startedAt: number;
    tickTimer: number | null;
    lastElapsedSec: number;
  };
  const recordingSessionRef = useRef<RecordingSession | null>(null);

  /** Abort an unfinished recording on slide switch (no preview blob written) */
  useEffect(() => {
    return () => {
      const sess = recordingSessionRef.current;
      if (!sess) return;
      if (sess.tickTimer != null) {
        clearInterval(sess.tickTimer);
        sess.tickTimer = null;
      }
      try {
        sess.recorder.onstop = null;
        sess.stream.getTracks().forEach((t) => t.stop());
        if (sess.recorder.state !== "inactive") {
          sess.recorder.stop();
        }
      } catch {
        /* noop */
      }
      recordingSessionRef.current = null;
      onQuizStateChange((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [k, st] of Object.entries(next)) {
          if (st.recordingFieldName != null || st.recordingElapsedSec > 0) {
            next[k] = { ...st, recordingFieldName: null, recordingElapsedSec: 0 };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };
  }, [slide.element_id, onQuizStateChange]);

  const toggleOption = useCallback(
    (quizElementId: string, optionId: string) => {
      onQuizStateChange((prev) => {
        const current = prev[quizElementId] ?? createEmptyQuizQuestionState();
        const quizEl = slide.children_elements.find(
          (e): e is QuizSlideElement =>
            e.element_id === quizElementId && e.element_type === "quiz",
        );
        const q = quizEl ? getQuestionConfig(quiz, quizEl) : null;
        if (current.isSubmitting || (current.submitted && !q?.allow_resubmit)) return prev;
        const next = new Set(current.selectedOptionIds);
        const isSingle = q?.type === "single_choice";
        if (isSingle) {
          next.clear();
          next.add(optionId);
        } else if (next.has(optionId)) {
          next.delete(optionId);
        } else {
          next.add(optionId);
        }
        return { ...prev, [quizElementId]: { ...current, selectedOptionIds: next } };
      });
    },
    [onQuizStateChange, quiz, slide.children_elements],
  );

  const setInputValue = useCallback(
    (quizElementId: string, fieldName: string, value: string) => {
      onQuizStateChange((prev) => {
        const current = prev[quizElementId] ?? createEmptyQuizQuestionState();
        const quizEl = slide.children_elements.find(
          (e): e is QuizSlideElement =>
            e.element_id === quizElementId && e.element_type === "quiz",
        );
        const q = quizEl ? getQuestionConfig(quiz, quizEl) : null;
        if (current.isSubmitting || (current.submitted && !q?.allow_resubmit)) return prev;
        return {
          ...prev,
          [quizElementId]: {
            ...current,
            inputValues: { ...current.inputValues, [fieldName]: value },
          },
        };
      });
    },
    [onQuizStateChange, quiz, slide.children_elements],
  );

  const retryQuestion = useCallback(
    (quizElementId: string) => {
      onQuizStateChange((prev) => {
        const cur = prev[quizElementId];
        if (cur?.recordedBlobUrl) {
          try {
            URL.revokeObjectURL(cur.recordedBlobUrl);
          } catch {
            /* noop */
          }
        }
        return {
          ...prev,
          [quizElementId]: createEmptyQuizQuestionState(),
        };
      });
    },
    [onQuizStateChange],
  );

  const toggleRecord = useCallback(
    async (quizElementId: string, fieldName: string) => {
      const current = quizState[quizElementId] ?? createEmptyQuizQuestionState();
      const quizEl = slide.children_elements.find(
        (e): e is QuizSlideElement =>
          e.element_id === quizElementId && e.element_type === "quiz",
      );
      const q = quizEl ? getQuestionConfig(quiz, quizEl) : null;
      if (current.isSubmitting || (current.submitted && !q?.allow_resubmit)) return;

      if (current.recordingFieldName === fieldName) {
        const sess = recordingSessionRef.current;
        if (sess && sess.quizElementId === quizElementId && sess.recorder.state !== "inactive") {
          if (sess.recorder.state === "recording") {
            sess.recorder.requestData();
          }
          sess.recorder.stop();
        }
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        onQuizRecordingStarted();
        const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
        const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e: BlobEvent) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        const sess: RecordingSession = {
          quizElementId,
          fieldName,
          stream,
          recorder,
          chunks,
          startedAt: 0,
          tickTimer: null,
          lastElapsedSec: 0,
        };
        recordingSessionRef.current = sess;

        recorder.onstop = async () => {
          try {
            if (sess.tickTimer != null) {
              clearInterval(sess.tickTimer);
              sess.tickTimer = null;
            }
            const wallSec =
              sess.startedAt > 0 ? (performance.now() - sess.startedAt) / 1000 : sess.lastElapsedSec;
            const clockSec = Math.max(wallSec, sess.lastElapsedSec);
            const rawBlob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
            try {
              stream.getTracks().forEach((t) => t.stop());
            } catch {
              /* noop */
            }
            const decodedSec = await measureBlobAudioDurationSec(rawBlob);
            const elapsedSec = Math.max(
              clockSec,
              decodedSec ?? 0,
              rawBlob.size > 0 ? 0.01 : 0,
            );
            const blob = await fixRecordedWebmBlob(rawBlob, elapsedSec);
            const url = URL.createObjectURL(blob);
            onQuizStateChange((prev) => {
              const qst = prev[quizElementId] ?? createEmptyQuizQuestionState();
              if (qst.recordedBlobUrl) URL.revokeObjectURL(qst.recordedBlobUrl);
              return {
                ...prev,
                [quizElementId]: {
                  ...qst,
                  recordingFieldName: null,
                  recordingElapsedSec: 0,
                  recordedBlobUrl: url,
                  recordedDurationSec: elapsedSec,
                },
              };
            });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : t("coursewarePreview.errors.submitFailed");
            toast.error(message);
            onLog(message);
            onQuizStateChange((prev) => {
              const qst = prev[quizElementId] ?? createEmptyQuizQuestionState();
              return {
                ...prev,
                [quizElementId]: {
                  ...qst,
                  recordingFieldName: null,
                  recordingElapsedSec: 0,
                },
              };
            });
          } finally {
            if (recordingSessionRef.current === sess) {
              recordingSessionRef.current = null;
            }
          }
        };

        sess.startedAt = performance.now();
        sess.tickTimer = window.setInterval(() => {
          const elapsed = (performance.now() - sess.startedAt) / 1000;
          sess.lastElapsedSec = elapsed;
          onQuizStateChange((prev) => {
            const qst = prev[quizElementId];
            if (!qst || qst.recordingFieldName !== fieldName) return prev;
            return {
              ...prev,
              [quizElementId]: { ...qst, recordingElapsedSec: elapsed },
            };
          });
        }, 100);
        recorder.start(250);

        onQuizStateChange((prev) => {
          const qst = prev[quizElementId] ?? createEmptyQuizQuestionState();
          if (qst.recordedBlobUrl) URL.revokeObjectURL(qst.recordedBlobUrl);
          return {
            ...prev,
            [quizElementId]: {
              ...qst,
              recordingFieldName: fieldName,
              recordingElapsedSec: 0,
              recordedBlobUrl: null,
              recordedDurationSec: 0,
            },
          };
        });
      } catch (error) {
        onLog(
        t("coursewarePreview.playback.logRecordStartFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      }
    },
    [onLog, onQuizRecordingStarted, onQuizStateChange, quiz, quizState, slide.children_elements, t],
  );

  const quizTotalRequired = (() => {
    if (!quiz?.enabled) return undefined;
    const count = countQuizQuestionsExpectedForCompletion(quiz, allSlides);
    return count > 0 ? count : undefined;
  })();

  const submitQuestion = useCallback(
    async (quizElementId: string, submission?: QuizSubmissionPayload) => {
      const quizEl = slide.children_elements.find(
        (element): element is QuizSlideElement =>
          element.element_type === "quiz" && element.element_id === quizElementId,
      );
      if (!quizEl) return;
      const question = getQuestionConfig(quiz, quizEl);
      if (!question) {
        onLog(t("coursewarePreview.playback.logQuizNotBound"));
        return;
      }
      const currentState = quizState[quizElementId] ?? createEmptyQuizQuestionState();
      if (currentState.isSubmitting || (currentState.submitted && !question.allow_resubmit)) return;

      /** QuizRenderer keeps inputs in QuizContainer; merge payload into host state for API packing. */
      const stateForSubmit: QuizQuestionState = submission
        ? {
            ...currentState,
            inputValues: {
              ...currentState.inputValues,
              ...submission.input_values,
            },
            selectedOptionIds:
              submission.selected_option_ids.length > 0
                ? new Set(submission.selected_option_ids)
                : currentState.selectedOptionIds,
          }
        : currentState;

      onQuizStateChange((prev) => ({
        ...prev,
        [quizElementId]: {
          ...(prev[quizElementId] ?? currentState),
          isSubmitting: true,
          feedback: null,
          feedback_detail: null,
          skipped: false,
        },
      }));

      try {
        const hasSectionContext = Boolean(sectionCourseId?.trim() && sectionId?.trim());
        const usesCoursewareServiceQuizSubmit = Boolean(
          previewCoursewareId?.trim() && isCoursewareApiConfigured(),
        );
        const orgIdForSubmit = sectionOrgId?.trim() || null;
        if (!usesCoursewareServiceQuizSubmit && !orgIdForSubmit) {
          throw new Error(t("coursewarePreview.errors.missingSectionOrgId"));
        }

        let recording: QuizRecordingUpload = null;
        if (question.type === "shadowing" || question.type === "speech") {
          if (usesCoursewareServiceQuizSubmit && !currentState.recordedBlobUrl) {
            throw new Error(t("coursewarePreview.errors.recordingRequired"));
          }
          if (
            currentState.recordedBlobUrl &&
            previewCoursewareId &&
            isCoursewareApiConfigured()
          ) {
            const blob = await fetch(currentState.recordedBlobUrl).then((r) => r.blob());
            const ext = blob.type.includes("webm")
              ? "webm"
              : blob.type.includes("mp4")
                ? "m4a"
                : "webm";
            const file = new File([blob], `quiz-answer.${ext}`, {
              type: blob.type || "audio/webm",
            });
            const { recordingId, file_path, file_url } = await coursewareQuizAnswerRecordingsApi.uploadQuizAnswerRecording({
              coursewareId: previewCoursewareId,
              file,
              sectionId: sectionId ?? undefined,
              sceneId,
              questionWrapperId: quizElementId,
              durationSec: currentState.recordedDurationSec,
              language: uiLanguage,
            });
            recording = {
              recording_id: recordingId,
              file_path,
              file_url,
              duration_sec: currentState.recordedDurationSec,
            };
          }
        }

        const result: SubmitCoursewareQuizAnswerResponse = await coursewareApi.submitQuizAnswer(
          orgIdForSubmit,
          {
            ...(previewCoursewareId ? { courseware_id: previewCoursewareId } : {}),
            ...(hasSectionContext
              ? { course_id: sectionCourseId!, section_id: sectionId! }
              : {}),
            scene_id: sceneId,
            slide_element_id: slide.element_id,
            language,
            ...(previewCoursewareId
              ? { question_id: question.question_id }
              : {}),
            question_wrapper_id: quizElementId,
            ...(previewCoursewareId
              ? attachQuestionSnapshotToQuizSubmit
                ? { question }
                : {}
              : { question }),
            ...(usesCoursewareServiceQuizSubmit && quizAttemptSessionIdRef.current
              ? { attempt_session_id: quizAttemptSessionIdRef.current }
              : {}),
            ...(usesCoursewareServiceQuizSubmit ? { submission_id: genUuid() } : {}),
            answer: buildQuizAnswerContent(
              stateForSubmit,
              question,
              recording,
              submission?.selected_option_ids,
            ),
            ...(hasSectionContext && quizTotalRequired != null
              ? { quiz_total_required: quizTotalRequired }
              : {}),
            ...(hasSectionContext && requiredQuizWrapperIds.length > 0
              ? { required_question_wrapper_ids: requiredQuizWrapperIds }
              : {}),
          },
        );
        if (result.attempt_session_id) {
          persistQuizAttemptSessionId(
            quizAttemptSessionStorageKey,
            quizAttemptSessionIdRef,
            result.attempt_session_id,
          );
        }
        const gatePassed = !question.required || result.can_advance;
        const displayFeedback = resolveQuizSubmitDisplayFeedback(
          result,
          {
            insufficientCreditsMessage: t("coursewarePreview.quiz.insufficientCreditsContactAdmin"),
            missingRecordingMessage: t("coursewarePreview.quiz.missingRecording"),
            unsupportedQuestionTypeMessage: t("coursewarePreview.quiz.unsupportedQuestionType"),
          },
        );
        const nextQuestionState: QuizQuestionState = {
          ...stateForSubmit,
          isSubmitting: false,
          // Always lock the attempt UI after a successful grade so options/score show feedback.
          submitted: true,
          skipped: false,
          score: result.score,
          feedback: displayFeedback,
          feedback_detail: result.feedback_detail ?? null,
          canAdvance: gatePassed,
        };
        onQuizStateChange((prev) => ({
          ...prev,
          [quizElementId]: nextQuestionState,
        }));
        if (hasSectionContext) {
          onQuizSubmitSucceeded?.(quizElementId, nextQuestionState);
        }
        onScoreResult(result.passed);
        const showScore = question.show_feedback_score !== false;
        onLog(
          displayFeedback !== result.feedback
            ? displayFeedback
            : gatePassed
              ? showScore
                ? t("coursewarePreview.quiz.submittedWithScore", {
                  score: result.score,
                  max: result.max_score,
                })
                : t("coursewarePreview.quiz.questionCompleted")
              : t("coursewarePreview.quiz.scoreNotMet"),
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? resolveQuizSubmitErrorMessage(
              error,
              error.message,
              t("coursewarePreview.quiz.aiScoringRetry"),
            )
            : t("coursewarePreview.errors.submitFailed");
        onQuizStateChange((prev) => ({
          ...prev,
          [quizElementId]: {
            ...(prev[quizElementId] ?? currentState),
            isSubmitting: false,
            submitted: false,
            feedback: message,
            feedback_detail: null,
            canAdvance: false,
          },
        }));
        onLog(message);
        toast.error(message);
      }
    },
    [
      onLog,
      onQuizStateChange,
      onQuizSubmitSucceeded,
      onScoreResult,
      language,
      previewCoursewareId,
      quiz,
      quizState,
      sceneId,
      sectionCourseId,
      sectionId,
      requiredQuizWrapperIds,
      sectionOrgId,
      quizAttemptSessionIdRef,
      quizAttemptSessionStorageKey,
      attachQuestionSnapshotToQuizSubmit,
      quizTotalRequired,
      slide,
      t,
    ],
  );

  const updateStageSize = useCallback((): void => {
    const el = containerRef.current;
    if (!el) return;
    // When rotated to landscape, getBoundingClientRect swaps axes, so the layout box size is used instead.
    setSize({ w: el.clientWidth, h: el.clientHeight });
  }, []);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    updateStageSize();
    const observer = new ResizeObserver(updateStageSize);
    observer.observe(containerRef.current);
    window.addEventListener("resize", updateStageSize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateStageSize);
    };
  }, [updateStageSize]);

  useLayoutEffect(() => {
    const raf = window.requestAnimationFrame(() => updateStageSize());
    return () => window.cancelAnimationFrame(raf);
  }, [forceLandscapeLayoutEpoch, updateStageSize]);

  /**
   * Student preview shell: fill the available width first; only when the height computed from the width exceeds the viewport does it fall back to fitting by height.
   * The area outside the canvas is black, making the courseware boundary easy to see.
   */
  const innerW = Math.max(1, size.w);
  const innerH = Math.max(1, size.h);
  const scaleW = innerW / SLIDE_LOGICAL_WIDTH;
  const scaleH = innerH / SLIDE_LOGICAL_HEIGHT;
  let scale = scaleW;
  if (SLIDE_LOGICAL_HEIGHT * scale > innerH) {
    scale = scaleH;
  }
  scale = Math.max(0.05, scale);
  const stageW = SLIDE_LOGICAL_WIDTH * scale;
  const stageH = SLIDE_LOGICAL_HEIGHT * scale;
  const activeHighlights = getActiveHighlightRegions(slide, renderTime);
  const handleNarrationLipSyncValueChange = useCallback((vtuberElementId: string, value: number) => {
    const clampedValue = clamp(value, 0, 1);
    setVtuberLipSyncByElementId((prev) => {
      const prevValue = prev[vtuberElementId] ?? 0;
      if (Math.abs(prevValue - clampedValue) < 0.02) return prev;
      if (clampedValue <= 0.001 && !(vtuberElementId in prev)) return prev;
      return { ...prev, [vtuberElementId]: clampedValue };
    });
  }, []);
  const quizContentNarrationLipSyncTarget = useMemo((): {
    url: string;
    vtuberElementId: string;
  } | null => {
    if (!activeQuizPauseWrapperId || !quiz?.enabled) return null;
    const wrap = slide.children_elements.find(
      (e): e is QuizSlideElement =>
        e.element_id === activeQuizPauseWrapperId && e.element_type === "quiz",
    );
    if (!wrap) return null;
    const q = getQuestionConfig(quiz, wrap);
    if (!q) return null;
    const url = q.content_narration_audio_url?.trim() ?? "";
    if (!url) return null;
    const fromQuestion = q.content_narration_vtuber_element_id?.trim() ?? "";
    const firstOnSlide = slide.children_elements.find(
      (e): e is VtuberElement => e.element_type === "vtuber",
    )?.element_id;
    const vtuberElementId = fromQuestion || firstOnSlide || "";
    if (!vtuberElementId) return null;
    return { url, vtuberElementId };
  }, [activeQuizPauseWrapperId, quiz, slide]);
  const handleNarrationAudioLoadingChange = useCallback(
    (elementId: string, isLoading: boolean) => {
      onPlaybackLoadingTokenChange(`narration:${elementId}`, isLoading);
    },
    [onPlaybackLoadingTokenChange],
  );

  useEffect(() => {
    if (!quizImageLightbox) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setQuizImageLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [quizImageLightbox]);

  const mediaPreloadBucket = Math.floor(currentTime / MEDIA_PRELOAD_BUCKET_MS);
  useEffect(() => {
    preloadUpcomingSlideMediaUrls(slide, playheadFromRef ? playheadRef.current : currentTime);
  }, [slide, mediaPreloadBucket, playheadFromRef, playheadRef, currentTime]);

  const noopLipSyncChange = useCallback((): void => {}, []);
  const noopLoadingChange = useCallback((): void => {}, []);
  const noopSlideAdvanceGate = useCallback((_elementId: string, _blocking: boolean): void => {}, []);
  const noopPlayheadDrive = useCallback((_localMs: number | null): void => {}, []);
  const noopClick = useCallback((): void => {}, []);

  const vtuberPlacements = useMemo((): PreviewVtuberPlacement[] => {
    if (!headlessSeekDrive) {
      return listVtubersOnSlide(slide).map((element) => ({
        sourceKey: getVtuberSourceKey(element),
        element,
        slide,
        currentTime: renderTime,
        elementId: element.element_id,
        stageActive: true,
      }));
    }
    return buildHeadlessVtuberPlacements(allSlides, slide, renderTime);
  }, [allSlides, headlessSeekDrive, renderTime, slide]);
  const narrationBoundVtuberIds = useMemo((): Set<string> => {
    const ids = new Set<string>();
    for (const element of slide.children_elements) {
      if (element.element_type !== "narration") continue;
      if (!isElementVisibleAtTimeInSlide(element, renderTime, slide)) continue;
      const metadata = element.metadata as Record<string, unknown>;
      const id =
        typeof metadata.vtuber_element_id === "string"
          ? metadata.vtuber_element_id.trim()
          : "";
      if (id) ids.add(id);
    }
    return ids;
  }, [renderTime, slide]);

  const quizAggregateSnapshot = useMemo((): QuizAggregateScoreSnapshot | null => {
    if (!quiz) return null;
    return computeQuizAggregateScore(quiz, allSlides, quizState);
  }, [allSlides, quiz, quizState]);

  const renderSlideLayer = (
    renderSlide: SlideElement,
    renderTime: number,
    interactive: boolean,
    headlessSeek: boolean,
  ): ReactNode => {
    const quizInteraction = interactive && !rendererMode;
    const playbackPipeline = interactive || rendererMode;
    const playbackGatesEngaged = isPlaying || (rendererMode && rendererWarmup);
    const bgStyle = getSlideBackgroundImageLayerStyle(
      renderSlide.background_image_url,
      renderSlide.background_image_fit,
    );
    const renderHighlights = interactive
      ? activeHighlights
      : getActiveHighlightRegions(renderSlide, renderTime);

    return (
      <>
        <div
          className="absolute inset-0"
          style={{ backgroundColor: renderSlide.background_color }}
        />
        {bgStyle ? <div className="pointer-events-none absolute inset-0 z-0" style={bgStyle} /> : null}
        <SlideBackgroundHtmlLayer
          src={renderSlide.background_html_src}
          slideId={renderSlide.element_id}
          contentZoom={renderSlide.background_html_content_zoom}
          scale={scale}
          previewStage
          interactive={quizInteraction}
          zClassName="z-0"
          playbackGateActive={playbackPipeline && playbackGatesEngaged}
          onPlaybackLoadingChange={(loading) =>
            onPlaybackLoadingTokenChange(`slide-bg-html:${renderSlide.element_id}`, loading)
          }
          loadingLabel={t("coursewarePreview.quiz.htmlLoading")}
          loadFailedTitle={t("coursewarePreview.quiz.htmlLoadFailed")}
        />
        {playbackPipeline && playbackGatesEngaged && renderSlide.background_image_url?.trim() ? (
          <PreviewSlideBackgroundPlaybackGate
            url={renderSlide.background_image_url}
            onLoadingChange={(loading) =>
              onPlaybackLoadingTokenChange(`slide-bg:${renderSlide.element_id}`, loading)
            }
          />
        ) : null}
        <div
          className={`relative z-1 min-h-full w-full${
            renderSlide.background_html_src?.trim() ? " pointer-events-none" : ""
          }`}
        >
          {buildQuestionStackRenderUnits(renderSlide).map((unit) => {
            const el = unit.element;
            if (el.element_type === "vtuber") return null;
            const quizContext: PreviewQuizContext | undefined =
              el.element_type === "quiz"
                ? (() => {
                    const quizEl = el as QuizSlideElement;
                    const question = getQuestionForLayoutPreview(quiz, quizEl);
                    if (!question) return undefined;
                    if (!quizInteraction) {
                      return buildLayoutPreviewQuizContext(quizEl, question);
                    }
                    const state = quizState[quizEl.element_id];
                    const allowResubmit = Boolean(question.allow_resubmit);
                    const isSubmitted = state?.submitted ?? false;
                    return {
                      quizElementId: quizEl.element_id,
                      question,
                      state: state ?? createEmptyQuizQuestionState(),
                      onToggleOption: (optionId: string) =>
                        toggleOption(quizEl.element_id, optionId),
                      onSubmit: (payload) => submitQuestion(quizEl.element_id, payload),
                      onSkip: !question.required
                        ? () => onSkipQuestion(quizEl.element_id)
                        : undefined,
                      onSetInput: (fieldName: string, value: string) =>
                        setInputValue(quizEl.element_id, fieldName, value),
                      onToggleRecord: (fieldName: string) =>
                        void toggleRecord(quizEl.element_id, fieldName),
                      onRetry:
                        allowResubmit && isSubmitted
                          ? () => retryQuestion(quizEl.element_id)
                          : undefined,
                      quizPostSubmitPrimaryLabel: getQuizPostSubmitPrimaryLabel(quizEl.element_id),
                      onQuizPostSubmitPrimary: () => onQuizPostSubmitPrimary(quizEl.element_id),
                    };
                  })()
                : undefined;
            return (
              <PreviewElement
                key={el.element_id}
                slide={renderSlide}
                element={el}
                currentTime={renderTime}
                narrationTime={timelineTime}
                isPlaying={playbackPipeline ? isPlaying : false}
                playbackGatesEngaged={playbackPipeline ? playbackGatesEngaged : false}
                headlessSeekDrive={headlessSeek}
                scale={scale}
                htmlIframeLayoutScale={htmlIframeLayoutScale}
                inochiUrl={inochiUrl}
                lipSyncValue={
                  playbackPipeline ? (vtuberLipSyncByElementId[el.element_id] ?? 0) : 0
                }
                onNarrationLipSyncValueChange={
                  playbackPipeline ? handleNarrationLipSyncValueChange : noopLipSyncChange
                }
                onNarrationAudioLoadingChange={
                  playbackPipeline ? handleNarrationAudioLoadingChange : noopLoadingChange
                }
                onNarrationSlideAdvanceGate={
                  playbackPipeline ? onNarrationSlideAdvanceGate : noopSlideAdvanceGate
                }
                onNarrationPlayheadDriveChange={
                  playbackPipeline ? onNarrationPlayheadDriveChange : noopPlayheadDrive
                }
                onPlaybackLoadingTokenChange={
                  playbackPipeline ? onPlaybackLoadingTokenChange : noopLoadingChange
                }
                onClick={quizInteraction ? () => onRunBinding(el) : noopClick}
                quizContext={quizContext}
                quizAggregateSnapshot={
                  quizInteraction
                    ? quizAggregateSnapshot
                    : quiz
                      ? computeQuizAggregateScore(quiz, allSlides, {})
                      : null
                }
                quizConfig={quiz}
                activeQuizPauseWrapperId={quizInteraction ? activeQuizPauseWrapperId : null}
                playbackRate={playbackRate}
                masterVolume={masterVolume}
                narrationMeasuredDurationByUrl={narrationMeasuredDurationByUrl}
                playheadRef={playheadRef}
                playheadFromRef={playheadFromRef}
                playheadClockRunning={playheadClockRunning}
              />
            );
          })}
          {playbackPipeline ? (
            <PreviewPersistentVtuberLayer
              previewCoursewareId={previewCoursewareId}
              placements={vtuberPlacements}
              scale={scale}
              inochiUrl={inochiUrl}
              lipSyncByElementId={vtuberLipSyncByElementId}
              allSlides={allSlides}
              narrationBoundVtuberIds={narrationBoundVtuberIds}
              isPlaying={isPlaying}
              rendererWarmup={rendererWarmup}
              headlessSeekDrive={headlessSeek}
              onPlaybackLoadingTokenChange={onPlaybackLoadingTokenChange}
            />
          ) : null}
          <HighlightOverlay regions={renderHighlights} />
        </div>
      </>
    );
  };

  const activeSlideTransition =
    slideTransition?.toSlideId === slide.element_id ? slideTransition : null;

  const resolveTransitionLayerStyle = (
    transition: Transition,
    role: "from" | "to",
    direction: 1 | -1,
    seekProgress?: number,
  ): CSSProperties => {
    if (headlessSeekDrive && seekProgress != null) {
      return getHeadlessTransitionLayerStyle(transition, role, direction, seekProgress);
    }
    return getPreviewTransitionLayerStyle(transition, role, direction);
  };

  return (
    <div
      ref={containerRef}
      className={`relative flex min-h-0 flex-1 overflow-hidden bg-black${
        rendererMode ? " pointer-events-none select-none" : ""
      }`}
    >
      <PreviewQuizContentNarrationLipSyncDriver
        audioRef={quizContentNarrationAudioRef}
        target={quizContentNarrationLipSyncTarget}
        onLipSyncValueChange={handleNarrationLipSyncValueChange}
      />
      <div className="flex h-full w-full items-center justify-center">
        <div
          className="relative shrink-0 overflow-hidden text-slate-100"
          style={{
            width: stageW,
            height: stageH,
            isolation: "isolate",
          }}
        >
          {activeSlideTransition ? (
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                zIndex: 1,
                ...resolveTransitionLayerStyle(
                  activeSlideTransition.transition,
                  "from",
                  activeSlideTransition.direction,
                  activeSlideTransition.seekProgress,
                ),
              }}
            >
              {renderSlideLayer(
                activeSlideTransition.fromSlide,
                activeSlideTransition.fromTime,
                false,
                headlessSeekDrive,
              )}
            </div>
          ) : null}
          <div
            className="absolute inset-0"
            style={{
              zIndex: 2,
              pointerEvents: activeSlideTransition ? "none" : "auto",
              ...(
                activeSlideTransition
                  ? resolveTransitionLayerStyle(
                      activeSlideTransition.transition,
                      "to",
                      activeSlideTransition.direction,
                      activeSlideTransition.seekProgress,
                    )
                  : {}
              ),
            }}
          >
            {renderSlideLayer(slide, renderTime, true, headlessSeekDrive)}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes previewFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes previewFadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes previewDissolveIn {
          0% { opacity: 0; filter: contrast(1.3); }
          100% { opacity: 1; filter: contrast(1); }
        }
        @keyframes previewDissolveOut {
          0% { opacity: 1; filter: contrast(1); }
          100% { opacity: 0; filter: contrast(1.3); }
        }
        @keyframes previewZoomInTo {
          from { opacity: 0; transform: scale(0.86); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes previewZoomInFrom {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0; transform: scale(1.08); }
        }
        @keyframes previewZoomOutTo {
          from { opacity: 0; transform: scale(1.12); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes previewZoomOutFrom {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0; transform: scale(0.92); }
        }
        @keyframes previewPushInleft {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
        @keyframes previewPushInright {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes previewPushInup {
          from { transform: translateY(-100%); }
          to { transform: translateY(0); }
        }
        @keyframes previewPushIndown {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @keyframes previewPushOutleft {
          from { transform: translateX(0); }
          to { transform: translateX(-100%); }
        }
        @keyframes previewPushOutright {
          from { transform: translateX(0); }
          to { transform: translateX(100%); }
        }
        @keyframes previewPushOutup {
          from { transform: translateY(0); }
          to { transform: translateY(-100%); }
        }
        @keyframes previewPushOutdown {
          from { transform: translateY(0); }
          to { transform: translateY(100%); }
        }
        @keyframes previewWipeInleft {
          from { clip-path: inset(0 0 0 100%); }
          to { clip-path: inset(0 0 0 0); }
        }
        @keyframes previewWipeInright {
          from { clip-path: inset(0 100% 0 0); }
          to { clip-path: inset(0 0 0 0); }
        }
        @keyframes previewWipeInup {
          from { clip-path: inset(100% 0 0 0); }
          to { clip-path: inset(0 0 0 0); }
        }
        @keyframes previewWipeIndown {
          from { clip-path: inset(0 0 100% 0); }
          to { clip-path: inset(0 0 0 0); }
        }
      `}</style>

      {!rendererMode && quizImageLightbox ? (
        <div
          className="fixed inset-0 z-100040 flex items-center justify-center bg-black/90 p-6"
          role="dialog"
          aria-modal="true"
          aria-label={t("coursewarePreview.quiz.imagePreview")}
          onClick={() => setQuizImageLightbox(null)}
        >
          <button
            type="button"
            className="absolute right-5 top-5 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-sm text-white backdrop-blur hover:bg-white/20"
            onClick={() => setQuizImageLightbox(null)}
          >
            {t("coursewarePreview.inspector.close")}
          </button>
          <img
            src={quizImageLightbox.src}
            alt={quizImageLightbox.alt}
            className="max-h-[min(92vh,1000px)] max-w-[min(96vw,1600px)] object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            draggable={false}
          />
        </div>
      ) : null}
    </div>
  );
}, previewSubtreePropsEqual);

// ---------- element render ----------

/**
 * The new preview-side quiz interaction context: one per `QuizSlideElement`, carrying the question's runtime
 * state and submission callbacks. Every old concept of "splitting components by role" moved into
 * the AST rendering of `<QuizRenderer>` — this is only the host's coordination channel.
 */
interface PreviewQuizContext {
  quizElementId: string;
  question: QuizQuestion;
  state: QuizQuestionState;
  onToggleOption: (optionId: string) => void;
  onSubmit: (payload: QuizSubmissionPayload) => void;
  onSkip?: () => void;
  onSetInput: (fieldName: string, value: string) => void;
  onToggleRecord: (fieldName: string) => void;
  onRetry?: () => void;
  quizPostSubmitPrimaryLabel?: string;
  onQuizPostSubmitPrimary?: () => void;
}


/** Shadowing / voice questions: the playback preview and progress bar after recording (independent of the canvas button coordinate layout) */
interface PreviewElementProps {
  slide: SlideElement;
  element: CourseElement;
  currentTime: number;
  /** Narration track/subtitles use the real playhead, separate from the idle cover renderTime. */
  narrationTime: number;
  isPlaying: boolean;
  playbackGatesEngaged?: boolean;
  playheadRef: RefObject<number>;
  playheadFromRef: boolean;
  playheadClockRunning: boolean;
  scale: number;
  htmlIframeLayoutScale?: number;
  inochiUrl: string;
  lipSyncValue: number;
  onNarrationLipSyncValueChange: (vtuberElementId: string, value: number) => void;
  onNarrationAudioLoadingChange: (elementId: string, isLoading: boolean) => void;
  onNarrationSlideAdvanceGate: (elementId: string, blocking: boolean) => void;
  onNarrationPlayheadDriveChange: (localMs: number | null) => void;
  onPlaybackLoadingTokenChange: (token: string, isLoading: boolean) => void;
  onClick: () => void;
  quizContext?: PreviewQuizContext;
  quizAggregateSnapshot?: QuizAggregateScoreSnapshot | null;
  quizConfig?: QuizConfig | null;
  activeQuizPauseWrapperId?: string | null;
  playbackRate: number;
  masterVolume: number;
  headlessSeekDrive?: boolean;
  narrationMeasuredDurationByUrl?: Readonly<Record<string, number>>;
}

const PreviewElement = memo(function PreviewElement({
  slide,
  element,
  currentTime,
  narrationTime,
  isPlaying,
  playbackGatesEngaged,
  playheadRef,
  playheadFromRef,
  playheadClockRunning,
  scale,
  htmlIframeLayoutScale,
  inochiUrl,
  lipSyncValue,
  onNarrationLipSyncValueChange,
  onNarrationAudioLoadingChange,
  onNarrationSlideAdvanceGate,
  onNarrationPlayheadDriveChange,
  onPlaybackLoadingTokenChange,
  onClick,
  quizContext,
  quizAggregateSnapshot = null,
  quizConfig = null,
  activeQuizPauseWrapperId = null,
  playbackRate,
  masterVolume,
  headlessSeekDrive = false,
  narrationMeasuredDurationByUrl = {},
}: PreviewElementProps) {
  const { t } = useI18nNew();
  /** While the preview is paused, page buttons let the user look at other pages temporarily; cleared when playback starts, following the keyframe timeline again */
  const [pptPausedPeekIndex, setPptPausedPeekIndex] = useState<number | null>(null);

  const visible = isElementVisibleAtTimeInSlide(element, currentTime, slide);
  const interp = interpolateElementTransformInSlide(element, currentTime, slide);
  const enterExitFx = useMemo(
    () => computeElementEnterExitEffectVisual(element, slide, currentTime),
    [element, slide, currentTime],
  );
  const enterExitInnerTransform = `translate(${enterExitFx.translateLogicalX * scale}px, ${enterExitFx.translateLogicalY * scale}px) rotate(${enterExitFx.rotateExtraDeg}deg) scale(${enterExitFx.uniformScale})`;

  useEffect(() => {
    if (isPlaying) setPptPausedPeekIndex(null);
  }, [isPlaying]);

  useEffect(() => {
    setPptPausedPeekIndex(null);
  }, [element.element_id]);

  const pptTimelineIndex =
    element.element_type === "ppt"
      ? resolvePptSlideIndexForTimeline(element as PPTElement, currentTime)
      : 0;
  const pptPreviewEffectiveIndex =
    element.element_type === "ppt"
      ? isPlaying || pptPausedPeekIndex === null
        ? pptTimelineIndex
        : pptPausedPeekIndex
      : 0;

  const previewPptInteractive =
    element.element_type === "ppt"
      ? {
          slideIndex: pptPreviewEffectiveIndex,
          onManualSlideChange: (i: number): void => {
            if (isPlaying) return;
            setPptPausedPeekIndex(i);
          },
          suppressNavReveal: isPlaying,
        }
      : undefined;

  const widthPx = interp.size.width * scale;
  const heightPx = interp.size.height * scale;
  const handleNarrationAudioLoadingChange = useCallback(
    (isLoading: boolean) => onNarrationAudioLoadingChange(element.element_id, isLoading),
    [element.element_id, onNarrationAudioLoadingChange],
  );
  const mediaPlaybackGateActive = visible && (playbackGatesEngaged ?? isPlaying);
  /** The media token freezes the timeline only within the actual playback interval (so preloading at t=0 doesn't block VTuber/TTS). */
  const mediaTimelineLoadingGateActive =
    mediaPlaybackGateActive &&
    currentTime >= element.timeline.start_at &&
    currentTime < element.timeline.end_at;
  const mediaToken = `media:${element.element_id}`;
  const handleMediaPlaybackLoading = useCallback(
    (loading: boolean) => onPlaybackLoadingTokenChange(mediaToken, loading),
    [mediaToken, onPlaybackLoadingTokenChange],
  );
  useEffect(() => {
    if (!mediaTimelineLoadingGateActive) {
      onPlaybackLoadingTokenChange(mediaToken, false);
    }
  }, [mediaTimelineLoadingGateActive, mediaToken, onPlaybackLoadingTokenChange]);

  const isQuizElement = element.element_type === "quiz";

  const canvasAudioDisplayForHit =
    element.element_type === "audio"
      ? getCanvasAudioDisplayMode(element)
      : "hidden";
  const isCanvasAudioVisibleUi =
    visible &&
    element.element_type === "audio" &&
    (canvasAudioDisplayForHit === "button" || canvasAudioDisplayForHit === "player");

  const baseZForStack =
    element.element_type === "narration"
      ? STAGE_NARRATION_Z_INDEX_BASE + element.style.z_index
      : element.element_type === "vtuber"
        ? STAGE_VTUBER_Z_INDEX_BASE + element.style.z_index
        : element.style.z_index;

  const style: CSSProperties = {
    position: "absolute",
    left: interp.position.x * scale,
    top: interp.position.y * scale,
    width: widthPx,
    height: heightPx,
    zIndex: baseZForStack,
    transform: `rotate(${interp.rotation_deg}deg)`,
    transformOrigin: "center center",
    opacity: visible ? interp.opacity * enterExitFx.opacityFactor : 0,
    pointerEvents:
      visible &&
      (element.element_type === "button" ||
        element.element_type === "html" ||
        element.element_type === "ppt" ||
        isQuizElement ||
        isCanvasAudioVisibleUi)
        ? "auto"
        : "none",
    transition:
      headlessSeekDrive ||
      element.element_type === "ppt" ||
      element.element_type === "svg" ||
      enterExitFx.prefersInstantOpacity
        ? "none"
        : `opacity ${QUIZ_PREVIEW_ELEMENT_OPACITY_TRANSITION_MS}ms linear`,
  };

  const handleWrapperClick = (): void => {
    if (isQuizElement) return;
    if (element.element_type === "button") onClick();
  };

  return (
    <div style={style} onClick={handleWrapperClick}>
      <div
        className="absolute inset-0"
        style={{
          transform: enterExitInnerTransform,
          transformOrigin: "center center",
        }}
      >
        {renderElementContent(
          t,
          element,
          widthPx,
          heightPx,
          inochiUrl,
          scale,
          currentTime,
          narrationTime,
          isPlaying,
          playheadRef,
          playheadFromRef,
          playheadClockRunning,
          lipSyncValue,
          onNarrationLipSyncValueChange,
          handleNarrationAudioLoadingChange,
          onNarrationSlideAdvanceGate,
          onNarrationPlayheadDriveChange,
          mediaPlaybackGateActive,
          mediaTimelineLoadingGateActive,
          handleMediaPlaybackLoading,
          quizContext,
          quizAggregateSnapshot,
          quizConfig,
          playbackRate,
          masterVolume,
          activeQuizPauseWrapperId,
          previewPptInteractive,
          htmlIframeLayoutScale,
          headlessSeekDrive,
          narrationMeasuredDurationByUrl,
        )}
      </div>
    </div>
  );
});

const renderElementContent = (
  t: CoursewareTranslateFn,
  element: CourseElement,
  widthPx: number,
  heightPx: number,
  inochiUrl: string,
  scale: number,
  currentTime: number,
  narrationTime: number,
  isPlaying: boolean,
  playheadRef: RefObject<number>,
  playheadFromRef: boolean,
  playheadClockRunning: boolean,
  lipSyncValue: number,
  onNarrationLipSyncValueChange: (vtuberElementId: string, value: number) => void,
  onNarrationAudioLoadingChange: (isLoading: boolean) => void,
  onNarrationSlideAdvanceGate: (elementId: string, blocking: boolean) => void,
  onNarrationPlayheadDriveChange: (localMs: number | null) => void,
  mediaPlaybackGateActive: boolean,
  mediaTimelineLoadingGateActive: boolean,
  onMediaPlaybackLoadingChange: (loading: boolean) => void,
  quizContext: PreviewQuizContext | undefined,
  quizAggregateSnapshot: QuizAggregateScoreSnapshot | null,
  quizConfig: QuizConfig | null,
  playbackRate: number,
  masterVolume: number,
  activeQuizPauseWrapperId: string | null = null,
  /** Preview: pages can be turned by hand while paused; playback follows the timeline again. */
  previewPptInteractive?: {
    slideIndex: number;
    onManualSlideChange: (index: number) => void;
    suppressNavReveal: boolean;
  },
  htmlIframeLayoutScale?: number,
  headlessSeekDrive = false,
  narrationMeasuredDurationByUrl: Readonly<Record<string, number>> = {},
): ReactNode => {
  void activeQuizPauseWrapperId;
  if (element.element_type === "quiz") {
    if (!quizContext) {
      return (
        <div
          className="flex h-full w-full items-center justify-center rounded-md border border-dashed border-slate-600 bg-slate-900/40 text-[11px] text-slate-500"
          style={{ padding: 8 }}
        >
          {t("coursewarePreview.playback.logQuizNotBound")}
        </div>
      );
    }
    const runtimeState = {
      submitted: quizContext.state.submitted,
      submitting: quizContext.state.isSubmitting,
      earnedScore: quizContext.state.score,
      feedback: quizContext.state.feedback,
      canAdvance: quizContext.state.canAdvance,
      skipped: quizContext.state.skipped ?? false,
    };
    // Match editor canvas: AST uses logical px; host box is already scaled to widthPx × heightPx.
    const widthLogical = scale > 0 ? widthPx / scale : widthPx;
    const heightLogical = scale > 0 ? heightPx / scale : heightPx;
    return (
      <div className="relative h-full min-h-0 w-full overflow-visible">
        <div
          className="absolute left-0 top-0 overflow-visible"
          style={{
            width: widthLogical,
            height: heightLogical,
            transform: scale > 0 ? `scale(${scale})` : undefined,
            transformOrigin: "top left",
          }}
        >
          <QuizRenderer
            question={quizContext.question}
            state={runtimeState}
            selection={{
              selectedOptionIds: [...quizContext.state.selectedOptionIds],
              inputValues: quizContext.state.inputValues,
            }}
            onToggleOption={(optionId) => quizContext.onToggleOption(optionId)}
            recording={{
              recordingFieldName: quizContext.state.recordingFieldName,
              recordingElapsedSec: quizContext.state.recordingElapsedSec,
              recordedBlobUrl: quizContext.state.recordedBlobUrl,
              recordedDurationSec: quizContext.state.recordedDurationSec,
            }}
            containerStyle={{
              width: widthLogical,
              height: heightLogical,
              boxSizing: "border-box",
            }}
            onSubmit={(payload) => {
              quizContext.onSubmit(payload);
            }}
            onSkip={quizContext.onSkip}
            onReset={quizContext.onRetry}
            onAdvance={quizContext.onQuizPostSubmitPrimary}
            onToggleRecord={quizContext.onToggleRecord}
            onInputChange={quizContext.onSetInput}
          />
        </div>
      </div>
    );
  }
  if (element.element_type === "quiz_score_summary") {
    if (!quizConfig || !quizAggregateSnapshot) {
      return (
        <div
          className="flex h-full w-full items-center justify-center rounded-md border border-dashed border-slate-600 bg-slate-900/40 text-[11px] text-slate-500"
          style={{ padding: 8 }}
        >
          {t("coursewarePreview.playback.scoreSummaryUnavailable")}
        </div>
      );
    }
    const scoreSummary = ensureQuizScoreSummaryConfig(quizConfig.score_summary, "en");
    const widthLogical = scale > 0 ? widthPx / scale : widthPx;
    const heightLogical = scale > 0 ? heightPx / scale : heightPx;
    return (
      <div className="relative h-full min-h-0 w-full overflow-hidden">
        <div
          className="absolute left-0 top-0"
          style={{
            width: widthLogical,
            height: heightLogical,
            transform: scale > 0 ? `scale(${scale})` : undefined,
            transformOrigin: "top left",
          }}
        >
          <QuizScoreSummaryRenderer
            reactLayout={scoreSummary.react_layout}
            snapshot={quizAggregateSnapshot}
            containerStyle={{
              width: widthLogical,
              height: heightLogical,
              boxSizing: "border-box",
            }}
          />
        </div>
      </div>
    );
  }
  if (element.element_type === "rich") {
    // Match quiz/score-summary: AST is authored in logical px; the host box is
    // already scaled to widthPx × heightPx, so render at logical size and scale.
    const widthLogical = scale > 0 ? widthPx / scale : widthPx;
    const heightLogical = scale > 0 ? heightPx / scale : heightPx;
    return (
      <div className="relative h-full min-h-0 w-full overflow-hidden">
        <div
          className="absolute left-0 top-0 overflow-hidden"
          style={{
            width: widthLogical,
            height: heightLogical,
            transform: scale > 0 ? `scale(${scale})` : undefined,
            transformOrigin: "top left",
          }}
        >
          <RichRenderer
            reactLayout={element.react_layout}
            containerStyle={{
              width: widthLogical,
              height: heightLogical,
              overflow: "hidden",
              boxSizing: "border-box",
            }}
          />
        </div>
      </div>
    );
  }
  if (element.element_type === "text") {
    const extraBorder: string | undefined = undefined;

    const titleColor = element.color;
    const textLineHeight = resolveTextLineHeight(element.line_height);

    const titleSpanStyle: CSSProperties = {
      fontSize: element.font_size * scale,
      color: titleColor,
      fontFamily: element.font_family,
      fontWeight: element.bold ? 700 : 400,
      fontStyle: element.italic ? "italic" : "normal",
      textAlign: element.align as CSSProperties["textAlign"],
      lineHeight: textLineHeight,
      whiteSpace: "pre-wrap",
      wordBreak: "break-all",
      overflowWrap: "anywhere",
      width: "100%",
    };

    return (
      <div
        className="flex h-full w-full items-center"
        style={{
          ...buildTextElementContainerStyle(element, scale),
          border: extraBorder,
          transition: "background-color 120ms ease, border-color 120ms ease",
        }}
      >
        <span style={titleSpanStyle}>{element.text}</span>
      </div>
    );
  }
  if (element.element_type === "image") {
    return (
      <CoursewareRasterImage
        element={element as ImageElement}
        draggable={false}
        playbackGateActive={mediaPlaybackGateActive}
        onPlaybackLoadingChange={onMediaPlaybackLoadingChange}
      />
    );
  }
  if (element.element_type === "svg") {
    return <CoursewareSvgContent element={element as SvgElement} />;
  }
  if (
    element.element_type === "rectangle" ||
    element.element_type === "ellipse" ||
    element.element_type === "line" ||
    element.element_type === "arrow"
  ) {
    return <CoursewareShapeContent element={element} scale={scale} />;
  }
  if (element.element_type === "input" || element.element_type === "textarea") {
    const isTextarea = element.element_type === "textarea";
    const meta = element.metadata as Record<string, unknown>;
    const metaBg = meta.background_color;
    const metaTc = meta.text_color;
    const backgroundColor =
      typeof metaBg === "string" && metaBg.length > 0 ? metaBg : "rgba(255, 255, 255, 0.08)";
    const color = typeof metaTc === "string" && metaTc.length > 0 ? metaTc : "#E2E8F0";
    const sharedStyle: CSSProperties = {
      width: "100%",
      height: "100%",
      backgroundColor,
      color,
      borderRadius: 12,
      border: "1px solid rgba(148, 163, 184, 0.35)",
      padding: `${10 * scale}px ${14 * scale}px`,
      fontSize: Math.max(14, 28 * scale),
      outline: "none",
      resize: isTextarea ? "none" : undefined,
      fontFamily: "inherit",
      lineHeight: 1.4,
      cursor: "default",
      opacity: 1,
    };
    if (isTextarea) {
      const ta = element as Extract<CourseElement, { element_type: "textarea" }>;
      return (
        <textarea
          value={ta.value}
          placeholder={ta.placeholder}
          rows={ta.rows ?? undefined}
          readOnly
          style={sharedStyle}
        />
      );
    }
    const inp = element as Extract<CourseElement, { element_type: "input" }>;
    return (
      <input
        type={inp.input_type === "password" ? "password" : "text"}
        value={inp.value}
        placeholder={inp.placeholder}
        readOnly
        style={sharedStyle}
      />
    );
  }
  if (element.element_type === "button") {
    const meta = element.metadata as Record<string, unknown>;
    const bg = typeof meta.background_color === "string" ? meta.background_color : "#3B82F6";
    const tc = typeof meta.text_color === "string" ? meta.text_color : "#FFFFFF";
    return (
      <button
        type="button"
        className="h-full w-full cursor-pointer rounded-lg font-semibold transition-transform hover:brightness-110 active:scale-[0.98]"
        style={{
          backgroundColor: bg,
          color: tc,
          fontSize: Math.max(14, heightPx * 0.32),
          border: "none",
        }}
      >
        {element.label}
      </button>
    );
  }
  if (element.element_type === "vtuber") {
    return null;
  }
  if (element.element_type === "video") {
    return (
      <VideoRenderer
        source={element.source}
        muted={element.muted}
        loop={element.loop}
        volume={element.volume}
        currentTime={currentTime}
        elementStartAt={element.timeline.start_at}
        elementEndAt={element.timeline.end_at}
        isPlaying={isPlaying}
        playbackGateActive={mediaPlaybackGateActive}
        timelineLoadingGateActive={mediaTimelineLoadingGateActive}
        onPlaybackLoadingChange={onMediaPlaybackLoadingChange}
        playbackRate={playbackRate}
        masterVolume={masterVolume}
      />
    );
  }
  if (element.element_type === "audio") {
    const au = element as AudioElement;
    const display = getCanvasAudioDisplayMode(element);
    if (display === "hidden") {
      return <div className="h-full w-full" aria-hidden />;
    }
    return <CanvasAudioStageWidget track={au} mode={display} volumeMultiplier={masterVolume} />;
  }
  if (element.element_type === "html") {
    const src = element.src.trim();
    if (!src) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center rounded-md border border-dashed border-slate-600 bg-slate-900/70 px-3 text-center text-slate-300">
          <FileIcon className="h-8 w-8" />
          <span className="mt-2 text-xs">{t("coursewarePreview.quiz.noHtmlUrl")}</span>
        </div>
      );
    }
    const wLog = widthPx / scale;
    const hLog = heightPx / scale;
    return (
      <CoursewareHtmlStageEmbed
        elementId={element.element_id}
        title={element.name || element.element_id}
        src={src}
        widthLogical={wLog}
        heightLogical={hLog}
        scale={scale}
        previewStage
        layoutScale={htmlIframeLayoutScale}
        contentZoom={element.content_zoom}
        playbackGateActive={mediaTimelineLoadingGateActive}
        onPlaybackLoadingChange={onMediaPlaybackLoadingChange}
        loadingLabel={t("coursewarePreview.quiz.htmlLoading")}
        loadFailedTitle={t("coursewarePreview.quiz.htmlLoadFailed")}
      />
    );
  }
  if (element.element_type === "ppt") {
    const ppt = element as PPTElement;
    const slideIndex =
      previewPptInteractive?.slideIndex ?? resolvePptSlideIndexForTimeline(ppt, currentTime);
    return (
      <PPTRenderer
        element={ppt}
        index={slideIndex}
        onIndexChange={previewPptInteractive?.onManualSlideChange}
        suppressNavReveal={previewPptInteractive?.suppressNavReveal ?? false}
        playbackGateActive={mediaTimelineLoadingGateActive}
        onPlaybackLoadingChange={onMediaPlaybackLoadingChange}
      />
    );
  }
  if (element.element_type === "narration") {
    return (
      <NarrationRenderer
        element={element as NarrationElement}
        widthPx={widthPx}
        heightPx={heightPx}
        currentTime={narrationTime}
        isPlaying={isPlaying}
        playheadRef={playheadRef}
        playheadFromRef={playheadFromRef}
        playheadClockRunning={playheadClockRunning}
        onLipSyncValueChange={onNarrationLipSyncValueChange}
        onPlaybackLoadingChange={onNarrationAudioLoadingChange}
        onSlideAdvanceGateChange={onNarrationSlideAdvanceGate}
        onPlayheadDriveChange={onNarrationPlayheadDriveChange}
        playbackRate={playbackRate}
        masterVolume={masterVolume}
        headlessSeekDrive={headlessSeekDrive}
        narrationMeasuredDurationByUrl={narrationMeasuredDurationByUrl}
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center rounded bg-slate-800/50 text-xs text-slate-400">
      {element.element_type}
    </div>
  );
};

// ---------- media renderers ----------

interface VideoRendererProps {
  source: string;
  muted: boolean;
  loop: boolean;
  volume: number;
  currentTime: number;
  elementStartAt: number;
  elementEndAt: number;
  isPlaying: boolean;
  playbackGateActive: boolean;
  /** When false, no media loading token is taken (see PreviewElement mediaTimelineLoadingGateActive). */
  timelineLoadingGateActive: boolean;
  onPlaybackLoadingChange: (loading: boolean) => void;
  playbackRate: number;
  masterVolume: number;
}

function VideoRenderer({
  source,
  muted,
  loop,
  volume,
  currentTime,
  elementStartAt,
  elementEndAt,
  isPlaying,
  playbackGateActive,
  timelineLoadingGateActive,
  onPlaybackLoadingChange,
  playbackRate,
  masterVolume,
}: VideoRendererProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const prevPlayheadMsRef = useRef(currentTime);
  const shouldPlay = isPlaying && playbackGateActive;
  const inTimelineRange =
    currentTime >= elementStartAt && currentTime < elementEndAt;

  const applyVideoPlayback = useCallback((): void => {
    const video = videoRef.current;
    if (!video) return;

    const prevMs = prevPlayheadMsRef.current;
    const deltaMs = Math.abs(currentTime - prevMs);
    const isContinuousPlayback =
      shouldPlay && deltaMs > 0 && deltaMs < 150 * Math.max(1, playbackRate);
    const expected = Math.max(0, (currentTime - elementStartAt) / 1000);

    const syncMediaTime = (): void => {
      if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;
      if (!isContinuousPlayback && Math.abs(video.currentTime - expected) > 0.35) {
        try {
          video.currentTime = expected;
        } catch {
          /* metadata / seek may still be settling */
        }
      }
    };

    syncMediaTime();
    if (shouldPlay) {
      if (!video.ended || loop) {
        void video.play().catch(() => {});
      }
    } else {
      video.pause();
    }
    prevPlayheadMsRef.current = currentTime;
  }, [currentTime, elementStartAt, shouldPlay, loop, playbackRate]);

  const applyVideoPlaybackRef = useRef(applyVideoPlayback);
  applyVideoPlaybackRef.current = applyVideoPlayback;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = clamp(volume * masterVolume, 0, 1);
    video.muted = muted;
  }, [muted, volume, masterVolume]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) applyHtmlMediaPlaybackRate(video, playbackRate);
  }, [playbackRate]);

  useEffect(() => {
    if (!timelineLoadingGateActive || !inTimelineRange) {
      onPlaybackLoadingChange(false);
      return;
    }
    const video = videoRef.current;
    if (!video) return;

    const reportLoading = (): void => {
      onPlaybackLoadingChange(
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA,
      );
    };
    reportLoading();
    if (shouldPlay) {
      void video.play().catch(() => {});
    }

    const onReady = (): void => {
      onPlaybackLoadingChange(false);
      applyVideoPlaybackRef.current();
    };
    const onWaiting = (): void => {
      if (shouldPlay && inTimelineRange) onPlaybackLoadingChange(true);
    };
    const onPlaying = (): void => onPlaybackLoadingChange(false);
    const onError = (): void => onPlaybackLoadingChange(false);

    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("canplay", onReady);
    video.addEventListener("canplaythrough", onReady);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("error", onError);
    return () => {
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("canplaythrough", onReady);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onError);
      onPlaybackLoadingChange(false);
    };
  }, [
    source,
    timelineLoadingGateActive,
    inTimelineRange,
    shouldPlay,
    onPlaybackLoadingChange,
  ]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    applyVideoPlayback();
    video.addEventListener("loadedmetadata", applyVideoPlayback);
    return () => video.removeEventListener("loadedmetadata", applyVideoPlayback);
  }, [source, applyVideoPlayback]);

  return (
    <video
      ref={videoRef}
      src={source}
      muted={muted}
      loop={loop}
      playsInline
      preload="auto"
      className="h-full w-full"
      style={{ objectFit: "contain" }}
    />
  );
}

// ---------- persistent vtuber pool (one Live2D / Inochi2D per model source) ----------

const isPreviewInochiModelUrl = (url: string): boolean => /\.inx(?:[?#]|$)/i.test(url);

function getPreviewVtuberRuntime(
  element: VtuberElement,
  inochiUrl: string,
): "inochi2d" | "live2d" {
  const meta = element.metadata as Record<string, unknown>;
  const declaredRuntime =
    typeof meta.runtime === "string" && (meta.runtime === "inochi2d" || meta.runtime === "live2d")
      ? (meta.runtime as "inochi2d" | "live2d")
      : "live2d";
  const modelUrl =
    typeof meta.model_url === "string" && meta.model_url.length > 0
      ? meta.model_url
      : typeof meta.ai_teacher_live2d_model_url === "string" &&
          meta.ai_teacher_live2d_model_url.length > 0
        ? meta.ai_teacher_live2d_model_url
        : declaredRuntime === "live2d"
          ? "/models/geekaca-teacher/geekaca-teacher.model3.json"
          : inochiUrl;
  return isPreviewInochiModelUrl(modelUrl) || declaredRuntime === "inochi2d" ? "inochi2d" : "live2d";
}

interface PreviewPersistentVtuberLayerProps {
  previewCoursewareId: string | null;
  placements: readonly PreviewVtuberPlacement[];
  scale: number;
  inochiUrl: string;
  lipSyncByElementId: Record<string, number>;
  allSlides: SlideElement[];
  narrationBoundVtuberIds: ReadonlySet<string>;
  isPlaying: boolean;
  rendererWarmup?: boolean;
  headlessSeekDrive?: boolean;
  onPlaybackLoadingTokenChange: (token: string, isLoading: boolean) => void;
}

function PreviewPersistentVtuberLayer({
  previewCoursewareId,
  placements,
  scale,
  inochiUrl,
  lipSyncByElementId,
  allSlides,
  narrationBoundVtuberIds,
  isPlaying,
  rendererWarmup = false,
  headlessSeekDrive = false,
  onPlaybackLoadingTokenChange,
}: PreviewPersistentVtuberLayerProps) {
  /** Every vtuber on the current slide (Live2D isn't unmounted on momentary opacity, so several models don't cancel each other's loading). */
  const slideVtuberPlacements = useMemo(() => {
    return [...placements].sort((a, b) => {
      const aBound = narrationBoundVtuberIds.has(a.elementId);
      const bBound = narrationBoundVtuberIds.has(b.elementId);
      if (aBound !== bBound) return aBound ? -1 : 1;
      return a.element.style.z_index - b.element.style.z_index;
    });
  }, [narrationBoundVtuberIds, placements]);

  const visiblePlacements = useMemo(() => {
    if (headlessSeekDrive) {
      return slideVtuberPlacements;
    }
    return slideVtuberPlacements.filter((placement) => {
      if (
        !isElementVisibleAtTimeInSlide(placement.element, placement.currentTime, placement.slide)
      ) {
        return false;
      }
      const interp = interpolateElementTransformInSlide(
        placement.element,
        placement.currentTime,
        placement.slide,
      );
      const enterExitFx = computeElementEnterExitEffectVisual(
        placement.element,
        placement.slide,
        placement.currentTime,
      );
      return interp.opacity * enterExitFx.opacityFactor > 0.001;
    });
  }, [headlessSeekDrive, placements, slideVtuberPlacements]);

  const visiblePlacementsLogSigRef = useRef("");
  useEffect(() => {
    const sig = visiblePlacements
      .map((placement) => `${placement.elementId}:${placement.sourceKey}`)
      .join("|");
    if (sig === visiblePlacementsLogSigRef.current) return;
    visiblePlacementsLogSigRef.current = sig;
    logger.debug("[Courseware Preview] visible vtuber placements:", {
      count: visiblePlacements.length,
      placements: visiblePlacements.map((placement) => ({
        elementId: placement.elementId,
        sourceKey: placement.sourceKey,
        zIndex: placement.element.style.z_index,
        timeline: placement.element.timeline,
        opacity: placement.element.style.opacity,
      })),
    });
  }, [visiblePlacements]);

  const { live2dMountOrderByElementId, live2dModelUrlByElementId } = useMemo(() => {
    const order = new Map<string, number>();
    const urls = new Map<string, string>();
    let index = 0;
    for (const placement of slideVtuberPlacements) {
      if (getPreviewVtuberRuntime(placement.element, inochiUrl) !== "live2d") continue;
      const mountKey = headlessSeekDrive ? placement.sourceKey : placement.elementId;
      order.set(mountKey, index++);
      urls.set(
        mountKey,
        getVtuberModelUrlFromMetadata(placement.element.metadata as Record<string, unknown>),
      );
    }
    return { live2dMountOrderByElementId: order, live2dModelUrlByElementId: urls };
  }, [headlessSeekDrive, inochiUrl, slideVtuberPlacements]);

  const live2dMountSig = useMemo(
    () =>
      [...live2dMountOrderByElementId.entries()]
        .map(([elementId, mountIndex]) => `${elementId}:${mountIndex}`)
        .join("|"),
    [live2dMountOrderByElementId],
  );

  /**
   * Serial mounting: only Live2D models with mountIndex at or below this value go into the DOM.
   * 0 = only the first, 1 = up to the second, …
   */
  const [live2dUnlockedThroughIndex, setLive2dUnlockedThroughIndex] = useState(0);
  useEffect(() => {
    if (!headlessSeekDrive) return;
    const maxIndex = Math.max(0, live2dMountOrderByElementId.size - 1);
    setLive2dUnlockedThroughIndex(maxIndex);
  }, [headlessSeekDrive, live2dMountOrderByElementId]);
  const prevLive2dMountSigRef = useRef("");
  const live2dMountSigRef = useRef(live2dMountSig);
  live2dMountSigRef.current = live2dMountSig;
  const live2dUnlockByMountSigRef = useRef(new Map<string, number>());
  const live2dMountMapsRef = useRef({
    order: live2dMountOrderByElementId,
    urls: live2dModelUrlByElementId,
  });
  live2dMountMapsRef.current = {
    order: live2dMountOrderByElementId,
    urls: live2dModelUrlByElementId,
  };

  useEffect(() => {
    const previousSig = prevLive2dMountSigRef.current;
    const { order, urls } = live2dMountMapsRef.current;
    const initial = resolveInitialLive2dUnlockedThroughIndex(
      order,
      (elementId) => urls.get(elementId) ?? "",
    );
    const remembered = getRememberedLive2dUnlockForMountSig(
      live2dUnlockByMountSigRef.current,
      live2dMountSig,
    );
    const targetUnlock = Math.max(
      initial,
      remembered ?? -1,
    );
    const preserveUnlock = shouldPreserveLive2dUnlockAcrossMountSigChange(
      previousSig,
      live2dMountSig,
    );
    prevLive2dMountSigRef.current = live2dMountSig;

    setLive2dUnlockedThroughIndex((prev) => {
      const next = preserveUnlock ? Math.max(prev, targetUnlock) : targetUnlock;
      rememberLive2dUnlockForMountSig(
        live2dUnlockByMountSigRef.current,
        live2dMountSig,
        next,
      );
      return next;
    });
  }, [live2dMountSig]);

  const handleLive2dReady = useCallback(
    (elementId: string) => {
      const mountIndex = live2dMountOrderByElementId.get(elementId);
      if (mountIndex === undefined) return;
      setLive2dUnlockedThroughIndex((prev) => {
        const next = Math.max(prev, mountIndex + 1);
        rememberLive2dUnlockForMountSig(
          live2dUnlockByMountSigRef.current,
          live2dMountSigRef.current,
          next,
        );
        return next;
      });
    },
    [live2dMountOrderByElementId],
  );

  return (
    <>
      {slideVtuberPlacements.map((placement) => {
        const mountKey = headlessSeekDrive ? placement.sourceKey : placement.elementId;
        const live2dMountIndex = live2dMountOrderByElementId.get(mountKey);
        const deferLive2dMount = headlessSeekDrive
          ? false
          : live2dMountIndex !== undefined && live2dMountIndex > live2dUnlockedThroughIndex;
        return (
          <PreviewVtuberSlot
            key={headlessSeekDrive ? placement.sourceKey : placement.elementId}
            previewCoursewareId={previewCoursewareId}
            placement={placement}
            scale={scale}
            inochiUrl={inochiUrl}
            lipSyncValue={resolveVtuberLipSyncValue(
              placement.sourceKey,
              placement.elementId,
              lipSyncByElementId,
              allSlides,
            )}
            isPlaying={isPlaying}
            rendererWarmup={rendererWarmup}
            headlessSeekDrive={headlessSeekDrive}
            onPlaybackLoadingTokenChange={onPlaybackLoadingTokenChange}
            deferLive2dMount={deferLive2dMount}
            onLive2dReady={() => handleLive2dReady(mountKey)}
          />
        );
      })}
    </>
  );
}

interface PreviewVtuberSlotProps {
  previewCoursewareId: string | null;
  placement: PreviewVtuberPlacement;
  scale: number;
  inochiUrl: string;
  lipSyncValue: number;
  isPlaying: boolean;
  rendererWarmup?: boolean;
  headlessSeekDrive?: boolean;
  onPlaybackLoadingTokenChange: (token: string, isLoading: boolean) => void;
  deferLive2dMount?: boolean;
  onLive2dReady?: () => void;
}

const PreviewVtuberSlot = memo(function PreviewVtuberSlot({
  previewCoursewareId,
  placement,
  scale,
  inochiUrl,
  lipSyncValue,
  isPlaying,
  rendererWarmup = false,
  headlessSeekDrive = false,
  onPlaybackLoadingTokenChange,
  deferLive2dMount = false,
  onLive2dReady,
}: PreviewVtuberSlotProps) {
  const { element, slide, currentTime, stageActive = true } = placement;
  const visible =
    stageActive && isElementVisibleAtTimeInSlide(element, currentTime, slide);
  const interp = interpolateElementTransformInSlide(element, currentTime, slide);
  const enterExitFx = useMemo(
    () => computeElementEnterExitEffectVisual(element, slide, currentTime),
    [element, slide, currentTime],
  );
  const enterExitOpacityFactor =
    headlessSeekDrive && stageActive ? 1 : enterExitFx.opacityFactor;
  const widthPx = interp.size.width * scale;
  const heightPx = interp.size.height * scale;
  const opacity = visible ? interp.opacity * enterExitOpacityFactor : 0;
  /** Even with an entrance opacity of 0, during playback the playhead stops until the model finishes loading (same as TTS). */
  const playbackGateActive = isPlaying || rendererWarmup;
  const modelUrl = useMemo(
    () =>
      getVtuberModelUrlFromMetadata(
        element.metadata as Record<string, unknown>,
      ),
    [element.metadata, placement.elementId, placement.sourceKey],
  );
  const modelReadyRef = useRef(false);
  const [slotModelReady, setSlotModelReady] = useState(false);
  const prevModelUrlRef = useRef(modelUrl);
  const vtuberToken = headlessSeekDrive
    ? `vtuber:${placement.sourceKey}`
    : `vtuber:${placement.elementId}`;
  const markModelReady = useCallback(() => {
    if (modelReadyRef.current) return;
    modelReadyRef.current = true;
    setSlotModelReady(true);
    onPlaybackLoadingTokenChange(vtuberToken, false);
  }, [onPlaybackLoadingTokenChange, vtuberToken]);
  const markModelReadyRef = useRef(markModelReady);
  markModelReadyRef.current = markModelReady;
  useEffect(() => {
    if (headlessSeekDrive) {
      if (modelUrl !== prevModelUrlRef.current) {
        prevModelUrlRef.current = modelUrl;
        modelReadyRef.current = false;
        setSlotModelReady(false);
      }
      return;
    }
    if (
      modelUrl === prevModelUrlRef.current &&
      (modelReadyRef.current || isVtuberModelWarmInCache(modelUrl))
    ) {
      if (!modelReadyRef.current) {
        markModelReadyRef.current();
      }
      prevModelUrlRef.current = modelUrl;
      return;
    }
    prevModelUrlRef.current = modelUrl;
    modelReadyRef.current = false;
    setSlotModelReady(false);
    if (isVtuberModelWarmInCache(modelUrl)) {
      markModelReadyRef.current();
    }
  }, [headlessSeekDrive, modelUrl, placement.sourceKey]);
  /** A safety net when onModelDisplayed doesn't arrive after Live2D completes (polls the shared cache). */
  useEffect(() => {
    if (headlessSeekDrive) return;
    if ((!isPlaying && !rendererWarmup) || deferLive2dMount || modelReadyRef.current) return;
    if (isVtuberModelWarmInCache(modelUrl)) {
      markModelReadyRef.current();
      return;
    }
    const timer = window.setInterval(() => {
      if (modelReadyRef.current) {
        window.clearInterval(timer);
        return;
      }
      if (isVtuberModelWarmInCache(modelUrl)) {
        markModelReadyRef.current();
        window.clearInterval(timer);
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [deferLive2dMount, headlessSeekDrive, isPlaying, rendererWarmup, modelUrl]);
  /** Like narration, during playback the timeline stops until the model finishes displaying (or the serial mount wait ends). */
  useEffect(() => {
    if (!isPlaying && !rendererWarmup) {
      onPlaybackLoadingTokenChange(vtuberToken, false);
      return;
    }
    if (deferLive2dMount) {
      onPlaybackLoadingTokenChange(vtuberToken, true);
      return;
    }
    onPlaybackLoadingTokenChange(vtuberToken, !modelReadyRef.current);
  }, [
    deferLive2dMount,
    isPlaying,
    rendererWarmup,
    slotModelReady,
    onPlaybackLoadingTokenChange,
    vtuberToken,
  ]);
  useEffect(
    () => () => {
      onPlaybackLoadingTokenChange(vtuberToken, false);
    },
    [onPlaybackLoadingTokenChange, vtuberToken],
  );

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: interp.position.x * scale,
        top: interp.position.y * scale,
        width: widthPx,
        height: heightPx,
        zIndex: STAGE_VTUBER_Z_INDEX_BASE + element.style.z_index,
        transform: `rotate(${interp.rotation_deg}deg)`,
        transformOrigin: "center center",
        opacity,
        visibility: headlessSeekDrive && !stageActive ? "hidden" : "visible",
        transition:
          headlessSeekDrive || slotModelReady || enterExitFx.prefersInstantOpacity
            ? "none"
            : `opacity ${QUIZ_PREVIEW_ELEMENT_OPACITY_TRANSITION_MS}ms linear`,
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${enterExitFx.translateLogicalX * scale}px, ${enterExitFx.translateLogicalY * scale}px) rotate(${enterExitFx.rotateExtraDeg}deg) scale(${enterExitFx.uniformScale})`,
          transformOrigin: "center center",
        }}
      >
        <VtuberRenderer
          element={element}
          previewCoursewareId={previewCoursewareId}
          widthPx={widthPx}
          heightPx={heightPx}
          inochiUrl={inochiUrl}
          lipSyncValue={lipSyncValue}
          playbackGateActive={playbackGateActive}
          headlessSeekDrive={headlessSeekDrive}
          sceneTimeMs={currentTime}
          stageActive={stageActive}
          deferLive2dMount={deferLive2dMount}
          onModelDisplayed={markModelReady}
          onLive2dReady={onLive2dReady}
        />
      </div>
    </div>
  );
});

// ---------- vtuber renderer ----------

interface VtuberRendererProps {
  element: VtuberElement;
  previewCoursewareId: string | null;
  widthPx: number;
  heightPx: number;
  inochiUrl: string;
  lipSyncValue: number;
  playbackGateActive?: boolean;
  onPlaybackLoadingChange?: (loading: boolean) => void;
  /** Headless rendering: the idle animation follows the scene time instead of the wall-clock RAF. */
  headlessSeekDrive?: boolean;
  sceneTimeMs?: number;
  /** Headless rendering: instances of non-current slides only warm up and don't take part in compositing. */
  stageActive?: boolean;
  /** Preview: the model component doesn't start until the second and later Live2D models mount serially. */
  deferLive2dMount?: boolean;
  onModelDisplayed?: () => void;
  onLive2dReady?: () => void;
}

const isInochiModelUrl = (url: string): boolean => /\.inx(?:[?#]|$)/i.test(url);

function VtuberRenderer({
  element,
  previewCoursewareId,
  widthPx,
  heightPx,
  inochiUrl,
  lipSyncValue,
  playbackGateActive = false,
  onPlaybackLoadingChange,
  headlessSeekDrive = false,
  sceneTimeMs = 0,
  stageActive = true,
  deferLive2dMount = false,
  onModelDisplayed,
  onLive2dReady,
}: VtuberRendererProps) {
  const { t } = useI18nNew();
  const modelRef = useRef<any>(null);
  const modelDisplayedRef = useRef(false);
  const meta = element.metadata as Record<string, unknown>;
  const declaredRuntime =
    typeof meta.runtime === "string" && (meta.runtime === "inochi2d" || meta.runtime === "live2d")
      ? (meta.runtime as "inochi2d" | "live2d")
      : "live2d";
  const modelUrl =
    typeof meta.model_url === "string" && meta.model_url.length > 0
      ? meta.model_url
      : typeof meta.ai_teacher_live2d_model_url === "string" && meta.ai_teacher_live2d_model_url.length > 0
        ? meta.ai_teacher_live2d_model_url
        : declaredRuntime === "live2d"
          ? "/models/geekaca-teacher/geekaca-teacher.model3.json"
          : inochiUrl;
  const runtime: "inochi2d" | "live2d" =
    isInochiModelUrl(modelUrl) || declaredRuntime === "inochi2d" ? "inochi2d" : "live2d";
  const modelCacheKey = getVtuberModelCacheKey(modelUrl);
  const modelRenderKey = headlessSeekDrive
    ? `${runtime}:${modelCacheKey}`
    : `${element.element_id}:${runtime}:${modelCacheKey}`;
  const warmInCache = isVtuberModelWarmInCache(modelUrl);
  const showLoadingChrome = headlessSeekDrive ? false : !warmInCache;

  const live2dApiRef = useRef<{ playPresetAction?: (preset: string) => void } | null>(null);
  const modelLoadedRef = useRef(false);

  const onPlaybackLoadingChangeRef = useRef(onPlaybackLoadingChange);
  onPlaybackLoadingChangeRef.current = onPlaybackLoadingChange;

  const [isModelLoading, setIsModelLoading] = useState(
    () =>
      headlessSeekDrive
        ? true
        : showLoadingChrome && (runtime !== "live2d" || !deferLive2dMount),
  );

  useEffect(() => {
    modelLoadedRef.current = false;
    modelDisplayedRef.current = false;
    modelRef.current = null;
    live2dApiRef.current = null;
    const warm = isVtuberModelWarmInCache(modelUrl);
    setIsModelLoading(headlessSeekDrive ? true : !warm);
    onPlaybackLoadingChangeRef.current?.(false);
  }, [headlessSeekDrive, modelRenderKey, modelUrl, runtime]);

  useEffect(() => {
    if (runtime !== "live2d" || !deferLive2dMount || warmInCache) return;
    setIsModelLoading(true);
  }, [deferLive2dMount, runtime, warmInCache]);

  const markModelDisplayed = useCallback(() => {
    if (modelDisplayedRef.current) return;
    modelDisplayedRef.current = true;
    setIsModelLoading(false);
    onModelDisplayed?.();
  }, [onModelDisplayed]);

  useEffect(() => {
    if (headlessSeekDrive) return;
    if (warmInCache) markModelDisplayed();
  }, [warmInCache, headlessSeekDrive, markModelDisplayed, modelUrl]);

  const handleModelLoadingChange = useCallback(
    (loading: boolean) => {
      if (!loading) {
        markModelDisplayed();
      }
      if (loading && modelDisplayedRef.current) return;
      setIsModelLoading(loading);
      const notify = onPlaybackLoadingChangeRef.current;
      if (!notify) return;
      if (!playbackGateActive || !modelUrl) {
        notify(false);
        return;
      }
      if (!loading && !modelDisplayedRef.current) return;
      notify(loading);
    },
    [markModelDisplayed, modelUrl, playbackGateActive],
  );

  useEffect(() => {
    const model = modelRef.current;
    if (!model) return;
    const finalValue = clamp(lipSyncValue, 0, 1);
    if (model?.internalModel?.coreModel) {
      model.internalModel.coreModel.setParameterValueById("ParamMouthOpenY", finalValue);
      return;
    }
    model.setLipSyncValue?.(finalValue);
  }, [lipSyncValue]);

  useEffect(() => {
    return () => {
      const model = modelRef.current;
      if (!model) return;
      if (model?.internalModel?.coreModel) {
        model.internalModel.coreModel.setParameterValueById("ParamMouthOpenY", 0);
      } else {
        model.resetLipSync?.();
        model.setLipSyncValue?.(0);
      }
    };
  }, []);

  useEffect(() => {
    if (runtime !== "live2d") return;
    const api = live2dApiRef.current as any;
    if (!api) return;
    const preset = typeof meta.preset === "string" ? meta.preset : undefined;
    const motion = typeof element.motion === "string" ? element.motion : undefined;
    if (preset && api.playPresetAction) {
      try { api.playPresetAction(preset); } catch { /* ignore */ }
    } else if (motion && api.playMotion) {
      try { api.playMotion(motion); } catch { /* ignore */ }
    }
  }, [runtime, meta.preset, element.motion]);

  if (runtime === "inochi2d") {
    if (!modelUrl) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center rounded-lg border border-dashed border-slate-600 bg-slate-900/60 p-4 text-center text-xs text-slate-400">
          <span className="mb-2 rounded-full bg-slate-800 px-3 py-1 font-semibold text-slate-200">
            Inochi2D
          </span>
          <span>{t("inochi2d.missingUrl")}</span>
          <span className="mt-1 text-[10px] text-slate-500">{t("coursewarePreview.vtuber.modelUrlHint")}</span>
        </div>
      );
    }
    return (
      <div className="relative h-full w-full">
        <div
          className={
            headlessSeekDrive || !(isModelLoading && showLoadingChrome && !modelDisplayedRef.current)
              ? "h-full w-full"
              : "invisible h-full w-full"
          }
        >
          <Inochi2DModelComponent
            key={modelRenderKey}
            {...buildCoursewareInochiStageModelProps(widthPx, heightPx, {
              enableIdleMotion: true,
              autoCenterX: true,
              showLoadingPlaceholder: false,
            })}
            modelUrl={modelUrl}
            sceneTimeMs={headlessSeekDrive && stageActive ? sceneTimeMs : undefined}
            headlessSceneDrive={headlessSeekDrive}
            onLoadingChange={handleModelLoadingChange}
            onModelLoaded={(model) => {
              modelRef.current = model;
              modelLoadedRef.current = true;
              markModelDisplayed();
            }}
            onError={() => {
              handleModelLoadingChange(false);
            }}
          />
        </div>
        {isModelLoading && showLoadingChrome && !modelDisplayedRef.current ? (
          <VtuberModelLoadingPlaceholder showBorder={false} />
        ) : null}
      </div>
    );
  }

  if (runtime === "live2d" && deferLive2dMount && showLoadingChrome) {
    return (
      <div
        className="relative h-full w-full"
        style={{ display: "flex", justifyContent: "center", alignItems: "flex-end" }}
      >
        <VtuberModelLoadingPlaceholder showBorder={false} />
      </div>
    );
  }

  return (
    <div
      className="relative h-full w-full"
      style={{ display: "flex", justifyContent: "center", alignItems: "flex-end" }}
    >
      <div
        className={
          headlessSeekDrive || !(isModelLoading && showLoadingChrome && !modelDisplayedRef.current)
            ? "h-full w-full"
            : "invisible h-full w-full"
        }
      >
          <Live2DModelComponent
            key={modelRenderKey}
            {...buildCoursewareLive2dStageModelProps(widthPx, heightPx, {
              showLoadingPlaceholder: false,
            })}
            modelUrl={modelUrl}
            coursewareId={previewCoursewareId ?? undefined}
            debugId={
              headlessSeekDrive
                ? `preview:${modelCacheKey}`
                : `preview:${element.element_id}:${modelUrl}`
            }
            enableInteraction={false}
            sceneTimeMs={headlessSeekDrive && stageActive ? sceneTimeMs : undefined}
            headlessSceneDrive={headlessSeekDrive}
            onLoadingChange={handleModelLoadingChange}
          onModelLoaded={(api) => {
            modelRef.current = api;
            modelLoadedRef.current = true;
            markModelDisplayed();
            live2dApiRef.current = api as any;
            onLive2dReady?.();
            const preset = typeof meta.preset === "string" ? meta.preset : undefined;
            if (preset && (api as any)?.playPresetAction) {
              try { (api as any).playPresetAction(preset); } catch { /* ignore */ }
            }
          }}
          onError={() => {
            handleModelLoadingChange(false);
          }}
        />
      </div>
      {isModelLoading && showLoadingChrome && !modelDisplayedRef.current ? (
        <VtuberModelLoadingPlaceholder showBorder={false} />
      ) : null}
    </div>
  );
}

// ---------- narration renderer ----------

interface NarrationRendererProps {
  element: NarrationElement;
  widthPx: number;
  heightPx: number;
  currentTime: number;
  isPlaying: boolean;
  playheadRef: RefObject<number>;
  playheadFromRef: boolean;
  playheadClockRunning: boolean;
  onLipSyncValueChange?: (vtuberElementId: string, value: number) => void;
  onPlaybackLoadingChange?: (isLoading: boolean) => void;
  onSlideAdvanceGateChange?: (elementId: string, blocking: boolean) => void;
  onPlayheadDriveChange?: (localMs: number | null) => void;
  playbackRate: number;
  masterVolume: number;
  headlessSeekDrive?: boolean;
  narrationMeasuredDurationByUrl?: Readonly<Record<string, number>>;
}

const formatNarrationSubtitleText = (text: string): string =>
  text.trimEnd().replace(/[。．.，,、！!；;：:…]+$/u, "").trimEnd();

function NarrationRenderer({
  element,
  widthPx,
  heightPx,
  currentTime,
  isPlaying,
  playheadRef,
  playheadFromRef,
  playheadClockRunning,
  onLipSyncValueChange,
  onPlaybackLoadingChange,
  onSlideAdvanceGateChange,
  onPlayheadDriveChange,
  playbackRate,
  masterVolume,
  headlessSeekDrive = false,
  narrationMeasuredDurationByUrl = {},
}: NarrationRendererProps) {
  const isPlayingRef = useRef(isPlaying);
  const lipSyncFrameRef = useRef<number | null>(null);
  const lipSyncBufferRef = useRef<DecodedLipSyncBuffer | null>(null);
  const [lipSyncBuffer, setLipSyncBuffer] = useState<DecodedLipSyncBuffer | null>(null);
  const mouthCurrentRef = useRef(0);

  const { audioRef, resolved, activeSegment, displaySegment, activeIndex } = useNarrationSegmentPlayback({
    element,
    currentTime,
    isPlaying,
    playbackRate,
    volumeMultiplier: masterVolume,
    playheadRef,
    playheadFromRef,
    onPlaybackLoadingChange,
    onSlideAdvanceGateChange,
    onPlayheadDriveChange,
    externalMeasuredDurationByUrl: narrationMeasuredDurationByUrl,
    useHyperframesNarrationLayout: headlessSeekDrive,
  });

  const lipSyncSegment = useMemo(() => {
    if (!headlessSeekDrive) return activeSegment;
    const index = findNarrationSegmentIndexAtTime(resolved, currentTime);
    return index >= 0 ? (resolved[index] ?? null) : null;
  }, [activeSegment, currentTime, headlessSeekDrive, resolved]);

  const lipSyncSrc = useMemo(() => {
    const canonical = lipSyncSegment?.audio_url?.trim() ?? "";
    if (!canonical) return "";
    if (headlessSeekDrive) return canonical;
    return resolveNarrationSegmentPlaybackUrl(canonical) || canonical;
  }, [headlessSeekDrive, lipSyncSegment]);

  const activeSrc = activeSegment?.audio_url ?? "";

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    if (activeIndex < 0) return;
    preloadNarrationAudioUrls(
      resolved
        .slice(activeIndex + 1, activeIndex + 3)
        .map((seg) => seg.audio_url)
        .filter((url): url is string => Boolean(url?.trim())),
    );
  }, [activeIndex, resolved]);

  const stopLipSync = useCallback(() => {
    if (lipSyncFrameRef.current !== null) {
      cancelAnimationFrame(lipSyncFrameRef.current);
      lipSyncFrameRef.current = null;
    }
    mouthCurrentRef.current = 0;
    onLipSyncValueChange?.(element.vtuber_element_id, 0);
  }, [element.vtuber_element_id, onLipSyncValueChange]);

  useEffect(() => {
    if (!lipSyncSrc) {
      lipSyncBufferRef.current = null;
      setLipSyncBuffer(null);
      stopLipSync();
      return;
    }
    stopLipSync();
    lipSyncBufferRef.current = null;
    setLipSyncBuffer(null);
    let cancelled = false;
    void loadLipSyncBuffer(lipSyncSrc).then((buf) => {
      if (cancelled) return;
      lipSyncBufferRef.current = buf;
      setLipSyncBuffer(buf);
    });
    return () => {
      cancelled = true;
      stopLipSync();
    };
  }, [lipSyncSrc, stopLipSync]);

  useEffect(() => {
    if (headlessSeekDrive) return;
    if (!lipSyncSrc) return;

    const LERP_FACTOR = 0.8;
    const updateMouth = (): void => {
      const currentAudio = audioRef.current;
      const buf = lipSyncBufferRef.current;
      if (!currentAudio || currentAudio.paused || !isPlayingRef.current) {
        onLipSyncValueChange?.(element.vtuber_element_id, 0);
        mouthCurrentRef.current = 0;
        lipSyncFrameRef.current = requestAnimationFrame(updateMouth);
        return;
      }
      if (!buf) {
        lipSyncFrameRef.current = requestAnimationFrame(updateMouth);
        return;
      }
      const targetMouthSyncValue = computeLipSyncMouthFromBuffer(buf, currentAudio.currentTime);
      mouthCurrentRef.current += (targetMouthSyncValue - mouthCurrentRef.current) * LERP_FACTOR;
      const naturalVariation = (Math.random() - 0.5) * 0.05;
      const finalValue = clamp(mouthCurrentRef.current + naturalVariation, 0, 1);
      onLipSyncValueChange?.(element.vtuber_element_id, finalValue);
      lipSyncFrameRef.current = requestAnimationFrame(updateMouth);
    };
    lipSyncFrameRef.current = requestAnimationFrame(updateMouth);

    return () => {
      stopLipSync();
    };
  }, [audioRef, element.vtuber_element_id, headlessSeekDrive, lipSyncSrc, onLipSyncValueChange, stopLipSync]);

  useEffect(() => {
    if (!headlessSeekDrive) return;
    if (!lipSyncSegment || !lipSyncBuffer) {
      onLipSyncValueChange?.(element.vtuber_element_id, 0);
      return;
    }
    if (currentTime < lipSyncSegment.startMs || currentTime >= lipSyncSegment.endMs) {
      onLipSyncValueChange?.(element.vtuber_element_id, 0);
      return;
    }
    const offsetSec = (currentTime - lipSyncSegment.startMs) / 1000;
    onLipSyncValueChange?.(
      element.vtuber_element_id,
      computeLipSyncMouthFromBuffer(lipSyncBuffer, offsetSec),
    );
  }, [
    currentTime,
    element.vtuber_element_id,
    headlessSeekDrive,
    lipSyncBuffer,
    lipSyncSegment,
    onLipSyncValueChange,
  ]);

  useEffect(
    () => () => {
      stopLipSync();
      lipSyncBufferRef.current = null;
    },
    [stopLipSync],
  );

  const subtitleSize = Math.max(16, Math.min(56, heightPx * 0.45));
  const subtitleBgOpacity = clamp(
    typeof element.subtitle_background_opacity === "number"
      ? element.subtitle_background_opacity
      : element.subtitle_background_transparent
        ? 0
        : 0.7,
    0,
    1,
  );
  const subtitleBgColor = applyOpacityToHexColor(
    element.subtitle_background_color || "#020617",
    subtitleBgOpacity,
  );
  const subtitleTextColor = element.subtitle_text_color || "#FFFFFF";
  const activeSubtitleText =
    element.subtitle_visible === false
      ? ""
      : displaySegment
        ? formatNarrationSubtitleText(displaySegment.text)
        : "";

  return (
    <div className="relative flex h-full w-full items-end justify-center">
      {!headlessSeekDrive ? (
        <audio ref={audioRef} hidden preload="auto" playsInline crossOrigin="anonymous" />
      ) : null}
      {activeSubtitleText ? (
        <div
          className="max-w-full rounded px-3 py-2 text-center shadow"
          style={{
            backgroundColor: subtitleBgColor,
            color: subtitleTextColor,
            fontSize: subtitleSize,
            lineHeight: 1.25,
            maxWidth: widthPx,
          }}
        >
          {activeSubtitleText}
        </div>
      ) : null}
    </div>
  );
}

// ---------- control bar ----------

function PreviewFlowPauseMarker({
  marker,
  isPassed,
  onSeek,
}: {
  marker: SceneFlowPauseMarker & { label: string };
  isPassed: boolean;
  onSeek: (sceneMs: number) => void;
}) {
  return (
    <div
      className="absolute top-1/2 z-3 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${marker.ratio * 100}%` }}
    >
      <button
        type="button"
        className="group/marker relative flex h-5 w-3 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-amber-500/60"
        aria-label={marker.label}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSeek(marker.scene_time_ms);
        }}
      >
        <span
          className={`block w-0.5 rounded-full transition-all duration-150 group-hover/marker:h-3 ${
            isPassed
              ? "h-2.5 bg-amber-500 group-hover/marker:bg-amber-600 dark:bg-amber-300 dark:group-hover/marker:bg-amber-200"
              : "h-2 bg-amber-400/90 group-hover/marker:bg-amber-500 dark:bg-amber-400/80 dark:group-hover/marker:bg-amber-300"
          }`}
        />
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900/95 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/marker:opacity-100 group-focus-visible/marker:opacity-100 dark:bg-slate-800/95"
        >
          {marker.label}
        </span>
      </button>
    </div>
  );
}

function PreviewSlideBoundaryMarker({
  marker,
  isPassed,
  onSeek,
}: {
  marker: PreviewSlideBoundaryMarker & { label: string };
  isPassed: boolean;
  onSeek: (sceneMs: number) => void;
}) {
  return (
    <div
      className="absolute top-1/2 z-3 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${marker.ratio * 100}%` }}
    >
      <button
        type="button"
        className="group/marker relative flex h-5 w-5 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#2F5C75]/60 dark:focus-visible:ring-sky-400/60"
        aria-label={marker.label}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSeek(marker.sceneTimeMs);
        }}
      >
        <span
          className={`block rounded-full ring-1 transition-all duration-150 group-hover/marker:h-3 group-hover/marker:w-3 group-hover/marker:shadow-md ${
            isPassed
              ? "h-2 w-2 bg-[#2F5C75] ring-white/90 group-hover/marker:bg-[#254A5E] dark:bg-sky-500 dark:group-hover/marker:bg-sky-400 dark:ring-slate-900/80"
              : "h-1.5 w-1.5 bg-slate-300 ring-white/80 group-hover/marker:bg-[#2F5C75] dark:bg-slate-600 dark:group-hover/marker:bg-sky-500 dark:ring-slate-900/80"
          }`}
        />
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900/95 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/marker:opacity-100 group-focus-visible/marker:opacity-100 dark:bg-slate-800/95"
        >
          {marker.label}
        </span>
      </button>
    </div>
  );
}

interface ControlBarProps {
  /** Whole-scene playhead while paused (ms) */
  sceneCurrentTimeMs: number;
  /** Start of the current slide on the whole-scene timeline (ms) */
  sceneSlideOffsetMs: number;
  playheadRef: RefObject<number>;
  playheadFromRef: boolean;
  playheadClockRunning: boolean;
  /** Total whole-scene duration (ms), all slides flattened */
  sceneTotalDurationMs: number;
  /** Switch points of each slide (with display text) */
  slideBoundaryMarkers: Array<PreviewSlideBoundaryMarker & { label: string }>;
  flowPauseMarkers: Array<SceneFlowPauseMarker & { label: string }>;
  isPlaying: boolean;
  isPlayLoading: boolean;
  /** Paused by an unanswered quiz: continuing playback and seeking / skipping forward to later slides are forbidden */
  quizAwaitingInteraction: boolean;
  rate: number;
  currentSlideIndex: number;
  slideCount: number;
  onPlayPause: () => void;
  /** Whole-scene time (ms) */
  onSeek: (sceneMs: number) => void;
  onScrubbingChange?: (scrubbing: boolean) => void;
  onRateChange: (rate: number) => void;
  onPrevSlide: () => void;
  onNextSlide: () => void;
  onRestart: () => void;
  isFullscreen: boolean;
  onFullscreen: () => void;
  assistantOpen: boolean;
  isVoiceInputOpen: boolean;
  getVoiceAnalyser: () => AnalyserNode | null;
  onOpenHistory: () => void;
  onToggleVoiceInput: () => void;
  onOpenTextInput: () => void;
  volumePercent: number;
  onVolumeChange: (percent: number) => void;
  overlayMode?: boolean;
  chromeVisible?: boolean;
  onChromeHoverStart?: () => void;
  onChromeHoverEnd?: () => void;
  /** Touch devices with narrow screens: the bottom bar fullscreen is hidden, replaced by the floating landscape button */
  hideFullscreenControl?: boolean;
  /** Narrow screens: hide speak/text input to keep the bottom bar uncluttered (also for narrowed PC windows) */
  hideAssistantInputControls?: boolean;
}

const ControlBar = memo(function ControlBar({
  sceneCurrentTimeMs,
  sceneSlideOffsetMs,
  playheadRef,
  playheadFromRef,
  playheadClockRunning,
  sceneTotalDurationMs,
  slideBoundaryMarkers,
  flowPauseMarkers,
  isPlaying,
  isPlayLoading,
  quizAwaitingInteraction,
  rate,
  currentSlideIndex,
  slideCount,
  onPlayPause,
  onSeek,
  onScrubbingChange,
  onRateChange,
  onPrevSlide,
  onNextSlide,
  onRestart,
  isFullscreen,
  onFullscreen,
  assistantOpen,
  isVoiceInputOpen,
  getVoiceAnalyser,
  onOpenHistory,
  onToggleVoiceInput,
  onOpenTextInput,
  volumePercent,
  onVolumeChange,
  overlayMode = false,
  chromeVisible = true,
  onChromeHoverStart,
  onChromeHoverEnd,
  hideFullscreenControl = false,
  hideAssistantInputControls = false,
}: ControlBarProps) {
  const { t } = useI18nNew();
  const revealed = !overlayMode || chromeVisible;
  const seekRef = useRef<HTMLDivElement | null>(null);
  const scrubbingRef = useRef(false);
  const [isScrubbing, setIsScrubbing] = useState(false);

  const setScrubbing = useCallback(
    (scrubbing: boolean): void => {
      scrubbingRef.current = scrubbing;
      setIsScrubbing(scrubbing);
      onScrubbingChange?.(scrubbing);
    },
    [onScrubbingChange],
  );

  /** The progress bar/time text share the stage's 60fps source; slide playheadRef + slide offset = whole-scene time. */
  const slideLocalPlayheadMs = usePlaybackPlayheadMs(
    playheadFromRef && !isScrubbing,
    playheadClockRunning && !isScrubbing,
    sceneCurrentTimeMs - sceneSlideOffsetMs,
    playheadRef,
  );
  const displaySceneTimeMs =
    playheadFromRef && !isScrubbing
      ? sceneSlideOffsetMs + slideLocalPlayheadMs
      : sceneCurrentTimeMs;
  const progressRatio =
    sceneTotalDurationMs > 0
      ? clamp(displaySceneTimeMs / sceneTotalDurationMs, 0, 1)
      : 0;

  const seekFromEvent = (e: { clientX: number }): void => {
    const track = seekRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    onSeek(ratio * sceneTotalDurationMs);
  };

  const endScrub = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    setScrubbing(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, [setScrubbing]);

  return (
    <div
      onPointerEnter={onChromeHoverStart}
      onPointerLeave={onChromeHoverEnd}
      className={`z-40 flex shrink-0 flex-col bg-white text-slate-500 dark:bg-slate-900 dark:text-slate-500 ${
        overlayMode
          ? `preview-chrome-overlay-bottom ${revealed ? "preview-chrome-overlay-visible" : "preview-chrome-overlay-hidden"}`
          : "relative"
      }`}
    >
      <div
        className={`flex w-full items-center justify-between overflow-hidden border-t border-slate-100 bg-white px-4 transition-all duration-300 sm:px-6 dark:border-slate-800/80 dark:bg-slate-900/90 ${
          isVoiceInputOpen && !assistantOpen ? "max-h-16 py-2.5 opacity-100" : "max-h-0 py-0 opacity-0"
        }`}
      >
        <div className="flex flex-1 flex-col gap-0.5 py-2">
          <span className="animate-pulse text-[10px] font-bold tracking-wider text-red-500 sm:text-xs">
            {t("player.controlIsland.listening")}
          </span>
          <p className="text-xs font-semibold italic text-slate-800 sm:text-sm dark:text-slate-100">
            「 ... 」
          </p>
        </div>
        <MicAnalyserWaveform
          active={isVoiceInputOpen && !assistantOpen}
          getAnalyser={getVoiceAnalyser}
          barColor="#ef4444"
          className="ml-4 h-6 w-20 shrink-0 sm:w-24"
          barCount={18}
        />
      </div>

      <div
        ref={seekRef}
        role="slider"
        aria-label={`${formatTimeMs(displaySceneTimeMs)} / ${formatTimeMs(sceneTotalDurationMs)}`}
        aria-valuemin={0}
        aria-valuemax={sceneTotalDurationMs}
        aria-valuenow={Math.round(displaySceneTimeMs)}
        className="group relative z-10 flex h-6 w-full cursor-pointer touch-none items-center select-none"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          setScrubbing(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromEvent(e);
        }}
        onPointerMove={(e) => {
          if (!scrubbingRef.current) return;
          seekFromEvent(e);
        }}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
      >
        <div className="relative h-[3px] w-full rounded-full bg-slate-100 group-hover:h-1 dark:bg-slate-800">
          <div
            className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-[#2F5C75] dark:bg-sky-500"
            style={{ width: `${progressRatio * 100}%` }}
          />
          {flowPauseMarkers.map((marker) => (
            <PreviewFlowPauseMarker
              key={`flow-pause-${marker.pause_id}-${marker.slide_index}`}
              marker={marker}
              isPassed={displaySceneTimeMs >= marker.scene_time_ms - 0.5}
              onSeek={onSeek}
            />
          ))}
          {slideBoundaryMarkers.map((marker) => (
            <PreviewSlideBoundaryMarker
              key={`slide-boundary-${marker.slideIndex}`}
              marker={marker}
              isPassed={displaySceneTimeMs >= marker.sceneTimeMs - 0.5}
              onSeek={onSeek}
            />
          ))}
          <div
            className={`pointer-events-none absolute top-1/2 z-4 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#2F5C75] shadow-md dark:bg-sky-500 ${
              isScrubbing || isPlaying
                ? "scale-100 opacity-100"
                : "scale-100 opacity-0 group-hover:opacity-100"
            }`}
            style={{ left: `${progressRatio * 100}%` }}
          />
        </div>
      </div>

      <div className="relative z-10 flex items-center justify-between gap-3 border-t border-slate-50 bg-white px-4 pb-2.5 text-xs sm:px-6 dark:border-slate-800/50 dark:bg-slate-900">
        <div className="flex items-center gap-3.5 text-slate-400 dark:text-slate-500">
          <PreviewControlButton
            label={t("coursewarePreview.controls.prevSlide")}
            icon={<SkipBack className="h-4 w-4" />}
            onClick={onPrevSlide}
            disabled={currentSlideIndex === 0}
          />
          <PreviewControlButton
            label={
              quizAwaitingInteraction
              ? t("coursewarePreview.controls.awaitingAnswer")
              : isPlayLoading
                ? t("coursewarePreview.controls.loading")
                : isPlaying
                  ? t("coursewarePreview.controls.pause")
                  : t("coursewarePreview.controls.play")
            }
            icon={
              quizAwaitingInteraction ? (
                <MessageCircleQuestionMark className="h-4 w-4 text-white" />
              ) : isPlayLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isPlaying ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )
            }
            onClick={onPlayPause}
            disabled={isPlayLoading}
            quizWaiting={quizAwaitingInteraction}
          />
          <PreviewControlButton
            label={t("coursewarePreview.controls.nextSlide")}
            icon={<SkipForward className="h-4 w-4" />}
            onClick={onNextSlide}
            disabled={quizAwaitingInteraction || currentSlideIndex >= slideCount - 1}
          />
          <span className="ml-1 pt-px font-mono text-[11px] font-medium tracking-wider text-slate-500 tabular-nums">
            {formatTimeMs(displaySceneTimeMs)} / {formatTimeMs(sceneTotalDurationMs)}
          </span>
        </div>

        <div className="flex items-center gap-3 text-slate-400 sm:gap-4 dark:text-slate-500">
          <div className="group relative flex items-center justify-center">
            <button
              type="button"
              className="transition-colors hover:text-[#2F5C75] dark:hover:text-sky-400"
              title={t("coursewarePreview.controls.volume")}
              aria-label={t("coursewarePreview.controls.volume")}
            >
              <Volume2 className={`h-4 w-4 ${volumePercent === 0 ? "text-red-400" : ""}`} aria-hidden />
            </button>
            <div className="invisible absolute bottom-full left-1/2 z-50 -translate-x-1/2 translate-y-2 pb-3 opacity-0 transition-all duration-300 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
              <div className="flex h-28 w-10 items-center justify-center rounded-xl border border-slate-200/80 bg-white/95 px-2 py-4 shadow-[0_4px_20px_rgb(0,0,0,0.1)] backdrop-blur-xl dark:border-slate-700/80 dark:bg-slate-800/95">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={volumePercent}
                  onChange={(e) => onVolumeChange(Number(e.target.value))}
                  className="h-1.5 w-20 origin-center -rotate-90 cursor-pointer appearance-none rounded-lg bg-slate-200 accent-[#2F5C75] dark:bg-slate-700 dark:accent-sky-500"
                  aria-label={t("coursewarePreview.controls.volume")}
                />
              </div>
            </div>
          </div>

          <div className="group relative flex items-center justify-center">
            <button
              type="button"
              className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-600 transition-colors hover:bg-indigo-100 dark:bg-indigo-500/20 dark:text-indigo-400"
              title={t("player.controlIsland.speedTitle")}
              aria-label={t("player.controlIsland.speed")}
            >
              {rate.toFixed(1)}x
            </button>
            <div className="invisible absolute bottom-full left-1/2 z-50 -translate-x-1/2 translate-y-2 pb-3 opacity-0 transition-all duration-300 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
              <div className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white/95 p-3 shadow-[0_4px_20px_rgb(0,0,0,0.1)] backdrop-blur-xl dark:border-slate-700/80 dark:bg-slate-800/95">
                <span className="text-[10px] font-medium text-slate-400">0.5x</span>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={rate}
                  onChange={(e) => onRateChange(Number(e.target.value))}
                  className="h-1.5 w-24 cursor-pointer appearance-none rounded-lg bg-slate-200 accent-indigo-500 dark:bg-slate-700 dark:accent-indigo-400"
                  aria-label={t("player.controlIsland.speed")}
                />
                <span className="text-[10px] font-medium text-slate-400">2.0x</span>
              </div>
            </div>
          </div>

          <PreviewControlButton
            label={t("coursewarePreview.controls.restartSlide")}
            icon={<RotateCcw className="h-[15px] w-[15px]" />}
            onClick={onRestart}
          />
          {!hideFullscreenControl ? (
            <PreviewControlButton
              label={
                isFullscreen
                  ? t("coursewarePreview.controls.exitFullscreen")
                  : t("coursewarePreview.controls.fullscreen")
              }
              icon={isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              onClick={onFullscreen}
            />
          ) : null}
          <PreviewControlButton
            label={t("coursewarePreview.assistant.chatHistory")}
            icon={<MessageCircle className="h-4 w-4" />}
            onClick={onOpenHistory}
            active={assistantOpen}
          />
          {!assistantOpen && !hideAssistantInputControls ? (
            <>
              <div className="mx-0.5 h-3.5 w-px bg-slate-200 dark:bg-slate-700" />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleVoiceInput}
                  className={`flex h-8 items-center justify-center gap-1.5 rounded-full border px-3.5 text-white shadow-[0_2px_10px_rgba(47,92,117,0.3)] transition-all sm:h-9 sm:px-4 ${
                    isVoiceInputOpen
                      ? "preview-pulse-red border-red-500 bg-red-500"
                      : "border-transparent bg-[#2F5C75] hover:bg-[#254A5E] dark:bg-sky-500 dark:hover:bg-sky-600"
                  }`}
                  title={t("coursewarePreview.assistant.voiceInput")}
                  aria-pressed={isVoiceInputOpen}
                >
                  <Mic className="h-3.5 w-3.5" aria-hidden />
                  <span className="text-[11px] font-bold tracking-wider sm:text-[12px]">
                    {t("coursewarePreview.assistant.speak")}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={onOpenTextInput}
                  className="flex h-8 items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-3.5 text-slate-600 shadow-sm transition-colors hover:border-[#2F5C75] hover:text-[#2F5C75] sm:h-9 sm:px-4 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-400"
                  title={t("coursewarePreview.assistant.message")}
                >
                  <Type className="h-3.5 w-3.5" aria-hidden />
                  <span className="text-[11px] font-bold tracking-wider sm:text-[12px]">
                    {t("coursewarePreview.assistant.type")}
                  </span>
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
});

function PreviewControlButton({
  label,
  icon,
  onClick,
  disabled,
  quizWaiting,
  active,
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /** Quiz waiting for interaction: amber emphasis, buttons disabled */
  quizWaiting?: boolean;
  active?: boolean;
}) {
  const isDisabled = Boolean(disabled || quizWaiting);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={isDisabled}
      onClick={quizWaiting ? undefined : onClick}
      className={`flex items-center justify-center rounded transition ${
        quizWaiting
          ? "h-8 w-8 cursor-not-allowed bg-amber-500 text-amber-950 ring-1 ring-amber-300/70 shadow-[0_0_14px_rgba(245,158,11,0.35)]"
          : disabled
            ? "h-8 w-8 cursor-not-allowed text-slate-300 dark:text-slate-700"
            : active
              ? "h-8 w-8 text-[#2F5C75] dark:text-sky-400"
              : "h-8 w-8 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
      }`}
    >
      {icon}
    </button>
  );
}

interface AssistantPanelProps {
  open: boolean;
  activeTab: AssistantTab;
  messages: AssistantMessage[];
  assistantBusy: boolean;
  assistantHistoryLoading: boolean;
  knowledgeFiles: CourseKnowledgeFileInfo[];
  knowledgeFilesLoading: boolean;
  courseTree: CourseTreeResponse | null;
  courseTreeLoading: boolean;
  sectionContext: CoursewarePreviewSectionContext | null;
  isVoiceInputOpen: boolean;
  chatInputFocusSeq: number;
  chatDraft: string;
  onChatDraftChange: (value: string) => void;
  voiceDictationState: WhisperVoiceDictationState;
  voiceDictationError: WhisperVoiceDictationError | null;
  getVoiceAnalyser: () => AnalyserNode | null;
  onToggleVoiceInput: () => void;
  onSubmitMessage: (text: string) => void;
  onSubmitAgentUserQuestion?: (args: {
    requestId: string;
    answers: Record<string, string>;
  }) => void | Promise<void>;
  onClose: () => void;
  onTabChange: (tab: AssistantTab) => void;
}

function AssistantCurriculumTabContent({
  courseTree,
  loading,
  sectionContext,
  t,
}: {
  courseTree: CourseTreeResponse | null;
  loading: boolean;
  sectionContext: CoursewarePreviewSectionContext | null;
  t: CoursewareTranslateFn;
}) {
  const [navigatingSectionId, setNavigatingSectionId] = useState<string | null>(null);

  const handleSectionClick = useCallback(
    async (courseNode: CourseTreeNode, chapterId: string, targetSectionId: string) => {
      if (!sectionContext) return;
      const isCurrentSection = targetSectionId === sectionContext.sectionId;
      const sectionNode = findSectionNodeInTree(courseNode, chapterId, targetSectionId);
      const canAccess = sectionNode?.section.can_access !== false;
      if (isCurrentSection || !canAccess || navigatingSectionId) return;

      const isLiveNow =
        canAccess &&
        sectionNode?.section.section_type === CourseSectionType.Live &&
        sectionNode.section.live_classroom?.can_join_live === true;

      setNavigatingSectionId(targetSectionId);
      try {
        const url = await resolveSectionNavigationUrl({
          courseNode,
          courseId: courseNode.course.course_id,
          orgId: sectionContext.orgId ?? courseNode.course.org_id,
          chapterId,
          sectionId: targetSectionId,
          fromPublic: sectionContext.fromPublic,
          fromTrial: sectionContext.fromTrial,
          from: sectionContext.from ?? undefined,
          isLiveNow,
        });
        window.location.href = url;
      } catch (error) {
        logger.error("Failed to navigate to section:", error);
        setNavigatingSectionId(null);
      }
    },
    [navigatingSectionId, sectionContext],
  );

  if (!sectionContext) {
    return (
      <div className="p-8 text-center text-slate-400">
        <p className="text-sm">{t("player.drawer.curriculum.empty")}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-500">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#2F5C75]" aria-hidden />
        <p className="mt-2 text-sm">{t("player.drawer.curriculum.loading")}</p>
      </div>
    );
  }

  if (!courseTree || courseTree.courses.length === 0) {
    return (
      <div className="p-8 text-center text-slate-500">
        <p className="text-sm">{t("player.drawer.curriculum.empty")}</p>
      </div>
    );
  }

  return (
    <div>
      {courseTree.courses.map((courseNode) => (
        <div key={courseNode.course.course_id}>
          {courseNode.chapters.map((chapterNode, chapterIndex) => (
            <div key={chapterNode.chapter.chapter_id} className="mb-4">
              <div className="p-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                {t("player.drawer.curriculum.chapterLabel", {
                  number: chapterIndex + 1,
                  name: chapterNode.chapter.chapter_name,
                })}
              </div>
              <div className="space-y-2">
                {chapterNode.sections.map((sectionNode) => {
                  const isCurrentSection =
                    sectionNode.section.section_id === sectionContext.sectionId;
                  const canAccess = sectionNode.section.can_access !== false;
                  const isExpired = sectionNode.section.expired === true;
                  const isNavigating = navigatingSectionId === sectionNode.section.section_id;

                  return (
                    <button
                      key={sectionNode.section.section_id}
                      type="button"
                      disabled={!canAccess || isCurrentSection || isNavigating}
                      onClick={() => {
                        void handleSectionClick(
                          courseNode,
                          chapterNode.chapter.chapter_id,
                          sectionNode.section.section_id,
                        );
                      }}
                      className={`mb-2 flex w-full items-center gap-3.5 rounded-xl border p-4 text-left transition-all ${
                        !canAccess
                          ? isExpired
                            ? "cursor-not-allowed border border-dashed border-red-300 text-red-400 dark:border-red-500/20 dark:text-red-400/70"
                            : "cursor-not-allowed border border-dashed border-slate-300 text-slate-500 dark:border-white/10 dark:text-slate-400"
                          : isCurrentSection
                            ? "cursor-default border border-[#2F5C75]/10 bg-[#2F5C75]/5 text-[#2F5C75] dark:border-transparent dark:bg-[#2F5C75]/30"
                            : "cursor-pointer border border-slate-200 bg-white text-slate-800 hover:-translate-y-0.5 hover:border-[#2F5C75] hover:shadow-lg dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:border-[#2F5C75] dark:hover:bg-white/10"
                      }`}
                    >
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-all ${
                          !canAccess
                            ? isExpired
                              ? "bg-red-100 text-red-400 dark:bg-red-500/10 dark:text-red-400/70"
                              : "bg-slate-200 text-slate-500 dark:bg-white/10 dark:text-slate-400"
                            : isCurrentSection
                              ? "border border-[#2F5C75] bg-[#2F5C75] text-white"
                              : "border border-transparent bg-slate-100 text-[#2F5C75] dark:bg-white/10 dark:text-slate-300"
                        }`}
                      >
                        {!canAccess ? (
                          <Lock className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                        ) : isNavigating ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Play className="h-3.5 w-3.5 fill-current" aria-hidden />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 text-sm font-semibold leading-snug">
                          {sectionNode.section.section_name}
                        </div>
                        <div
                          className={`text-[11px] ${
                            !canAccess
                              ? isExpired
                                ? "text-red-400 dark:text-red-400/70"
                                : "text-slate-400 dark:text-slate-500"
                              : isCurrentSection
                                ? "text-[#2F5C75] dark:text-sky-300"
                                : "text-slate-400"
                          }`}
                        >
                          {!canAccess
                            ? isExpired
                              ? t("player.drawer.curriculum.expired")
                              : getCourseSectionLockedReason(sectionNode.section, t)
                            : isCurrentSection
                              ? t("player.drawer.curriculum.learning")
                              : sectionNode.section.section_description || t("player.startLearning")}
                        </div>
                      </div>
                      {isCurrentSection && canAccess ? (
                        <span className="ml-auto shrink-0 rounded bg-[#2F5C75] px-2 py-1 text-[10px] font-bold text-white shadow-sm">
                          {t("player.drawer.curriculum.inProgress")}
                        </span>
                      ) : null}
                      {!canAccess ? (
                        <Lock
                          className={`ml-auto h-3.5 w-3.5 shrink-0 opacity-60 ${
                            isExpired
                              ? "text-red-400 dark:text-red-400/70"
                              : "text-slate-400 dark:text-slate-500"
                          }`}
                          strokeWidth={2}
                          aria-hidden
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function getKnowledgeFileIcon(fileType: string, t: CoursewareTranslateFn): string {
  switch (fileType.toLowerCase()) {
    case "pdf":
      return t("player.fileIcon.pdf");
    case "docx":
      return t("player.fileIcon.doc");
    case "excel":
    case "xlsx":
      return t("player.fileIcon.excel");
    case "pptx":
      return t("player.fileIcon.powerPoint");
    case "audio":
      return t("player.fileIcon.audio");
    case "video":
      return t("player.fileIcon.video");
    case "image":
      return t("player.fileIcon.image");
    case "text":
      return t("player.fileIcon.text");
    default:
      return t("player.fileIcon.file");
  }
}

function getKnowledgeFileIconColor(fileType: string): { bg: string; text: string; border: string } {
  const type = fileType.toLowerCase();
  if (type === "pdf") {
    return { bg: "bg-red-50", text: "text-red-500", border: "border-red-100" };
  }
  if (type === "audio") {
    return { bg: "bg-blue-50", text: "text-blue-500", border: "border-blue-100" };
  }
  if (type === "video") {
    return { bg: "bg-purple-50", text: "text-purple-500", border: "border-purple-100" };
  }
  if (type === "image") {
    return { bg: "bg-green-50", text: "text-green-500", border: "border-green-100" };
  }
  if (type === "excel" || type === "xlsx") {
    return { bg: "bg-emerald-50", text: "text-emerald-500", border: "border-emerald-100" };
  }
  if (type === "pptx" || type === "pptist") {
    return { bg: "bg-orange-50", text: "text-orange-500", border: "border-orange-100" };
  }
  return { bg: "bg-slate-50", text: "text-slate-500", border: "border-slate-100" };
}

function formatKnowledgeFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.round((bytes / k ** i) * 100) / 100} ${sizes[i]}`;
}

function getKnowledgeFileTypeLabel(fileType: string, t: CoursewareTranslateFn): string {
  switch (fileType.toLowerCase()) {
    case "pdf":
      return t("player.fileType.pdf");
    case "docx":
      return t("player.fileType.word");
    case "excel":
    case "xlsx":
      return t("player.fileType.excel");
    case "pptx":
      return t("player.fileType.powerPoint");
    case "audio":
      return t("player.fileType.audio");
    case "video":
      return t("player.fileType.video");
    case "image":
      return t("player.fileType.image");
    case "text":
      return t("player.fileType.text");
    default:
      return t("player.fileType.other");
  }
}

function AssistantKnowledgeFileRow({
  file,
  t,
}: {
  file: CourseKnowledgeFileInfo;
  t: CoursewareTranslateFn;
}) {
  const iconColor = getKnowledgeFileIconColor(file.file_type);
  return (
    <div className="mb-2.5 flex items-center gap-3 rounded-xl border border-slate-50 bg-white p-3 transition-all hover:-translate-y-px hover:border-slate-200 hover:shadow-sm dark:border-white/5 dark:bg-white/5 dark:hover:border-white/10 dark:hover:bg-white/10">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border text-[10px] font-bold dark:border-opacity-20 dark:bg-opacity-20 dark:text-opacity-80 ${iconColor.bg} ${iconColor.text} ${iconColor.border}`}
      >
        {getKnowledgeFileIcon(file.file_type, t)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 truncate text-[13px] font-semibold text-slate-700 dark:text-slate-200">
          {file.file_name}
        </div>
        <div className="text-[11px] text-slate-400">
          {formatKnowledgeFileSize(file.file_size)} · {getKnowledgeFileTypeLabel(file.file_type, t)}
        </div>
      </div>
      <a
        href={file.file_url}
        download={file.file_name}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-slate-400 transition-colors hover:bg-slate-100 hover:text-[#2F5C75] dark:hover:bg-white/10"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Download className="h-[18px] w-[18px]" aria-hidden />
      </a>
    </div>
  );
}

function AssistantMaterialsTabContent({
  files,
  loading,
  t,
}: {
  files: CourseKnowledgeFileInfo[];
  loading: boolean;
  t: CoursewareTranslateFn;
}) {
  if (loading) {
    return (
      <div className="p-8 text-center text-slate-500">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#2F5C75]" aria-hidden />
        <p className="mt-2 text-sm">{t("player.drawer.curriculum.loading")}</p>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-slate-400">{t("player.materials.empty")}</div>
    );
  }

  const pdfFiles = files.filter((file) => file.file_type.toLowerCase() === "pdf");
  const audioFiles = files.filter((file) => file.file_type.toLowerCase() === "audio");
  const videoFiles = files.filter((file) => file.file_type.toLowerCase() === "video");
  const imageFiles = files.filter((file) => file.file_type.toLowerCase() === "image");
  const otherFiles = files.filter(
    (file) => !["pdf", "audio", "video", "image"].includes(file.file_type.toLowerCase()),
  );

  return (
    <>
      {pdfFiles.length > 0 ? (
        <>
          <div className="p-2 text-xs font-bold uppercase tracking-wide text-slate-400">
            {t("player.materials.handout")}
          </div>
          {pdfFiles.map((file) => (
            <AssistantKnowledgeFileRow key={file.file_id} file={file} t={t} />
          ))}
        </>
      ) : null}
      {audioFiles.length > 0 ? (
        <>
          <div className="mt-5 p-2 text-xs font-bold uppercase tracking-wide text-slate-400">
            {t("player.materials.audio")}
          </div>
          {audioFiles.map((file) => (
            <AssistantKnowledgeFileRow key={file.file_id} file={file} t={t} />
          ))}
        </>
      ) : null}
      {videoFiles.length > 0 ? (
        <>
          <div className="mt-5 p-2 text-xs font-bold uppercase tracking-wide text-slate-400">
            {t("player.materials.video")}
          </div>
          {videoFiles.map((file) => (
            <AssistantKnowledgeFileRow key={file.file_id} file={file} t={t} />
          ))}
        </>
      ) : null}
      {imageFiles.length > 0 ? (
        <>
          <div className="mt-5 p-2 text-xs font-bold uppercase tracking-wide text-slate-400">
            {t("player.materials.image")}
          </div>
          {imageFiles.map((file) => (
            <AssistantKnowledgeFileRow key={file.file_id} file={file} t={t} />
          ))}
        </>
      ) : null}
      {otherFiles.length > 0 ? (
        <>
          <div className="mt-5 p-2 text-xs font-bold uppercase tracking-wide text-slate-400">
            {t("player.materials.other")}
          </div>
          {otherFiles.map((file) => (
            <AssistantKnowledgeFileRow key={file.file_id} file={file} t={t} />
          ))}
        </>
      ) : null}
    </>
  );
}

function AssistantChatInputBar({
  isVoiceInputOpen,
  assistantBusy,
  assistantHistoryLoading,
  focusRequestSeq,
  chatDraft,
  onChatDraftChange,
  voiceDictationState,
  voiceDictationError,
  getVoiceAnalyser,
  onToggleVoiceInput,
  onSubmitMessage,
  t,
}: {
  isVoiceInputOpen: boolean;
  assistantBusy: boolean;
  assistantHistoryLoading: boolean;
  focusRequestSeq: number;
  chatDraft: string;
  onChatDraftChange: (value: string) => void;
  voiceDictationState: WhisperVoiceDictationState;
  voiceDictationError: WhisperVoiceDictationError | null;
  getVoiceAnalyser: () => AnalyserNode | null;
  onToggleVoiceInput: () => void;
  onSubmitMessage: (text: string) => void;
  t: CoursewareTranslateFn;
}) {
  const inputBlocked = assistantBusy || assistantHistoryLoading;
  const voiceWaveformActive =
    isVoiceInputOpen &&
    (voiceDictationState === "connecting" ||
      voiceDictationState === "listening");
  const [focusRippleActive, setFocusRippleActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback((): void => {
    const el = textareaRef.current;
    if (!el) return;
    if (!chatDraft) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [chatDraft]);

  useLayoutEffect(() => {
    adjustHeight();
  }, [chatDraft, adjustHeight]);

  useEffect(() => {
    if (focusRequestSeq <= 0) return;
    let rippleTimer: number | undefined;
    const focusTimer = window.setTimeout(() => {
      const el = textareaRef.current;
      if (el) {
        el.style.height = "";
        el.focus();
      }
      setFocusRippleActive(true);
      rippleTimer = window.setTimeout(() => setFocusRippleActive(false), 1000);
    }, 320);
    return () => {
      window.clearTimeout(focusTimer);
      if (rippleTimer !== undefined) {
        window.clearTimeout(rippleTimer);
      }
    };
  }, [focusRequestSeq]);

  const submit = (): void => {
    const value = chatDraft.trim();
    if (!value || inputBlocked) return;
    onSubmitMessage(value);
    onChatDraftChange("");
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="shrink-0 border-t border-slate-200 bg-white/95 p-3 dark:border-slate-700 dark:bg-slate-900/95">
      {voiceDictationError?.code === INSUFFICIENT_CREDITS_FRAME_CODE ? (
        <div className="mb-2">
          <AiAssistantInsufficientPersonalCreditsCard />
        </div>
      ) : null}
      {isVoiceInputOpen ? (
        <div className="mb-2 flex flex-col gap-1 px-1">
          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] font-bold tracking-wider ${
                voiceDictationState === "error"
                  ? "text-red-600 dark:text-red-400"
                  : voiceDictationState === "connecting" ||
                      voiceDictationState === "recognizing"
                    ? "animate-pulse text-amber-600 dark:text-amber-400"
                    : "animate-pulse text-red-500"
              }`}
            >
              {voiceDictationState === "error"
                ? t("coursewarePreview.assistant.voiceInputError")
                : voiceDictationState === "connecting"
                  ? t("personalDashboard.gemini.voiceConnecting")
                  : voiceDictationState === "recognizing"
                    ? t("ainobiEntry.hero.micRecognizing")
                    : t("player.controlIsland.listening")}
            </span>
            <MicAnalyserWaveform
              active={voiceWaveformActive}
              getAnalyser={getVoiceAnalyser}
              barColor="#ef4444"
              className="ml-auto h-5 w-20"
              barCount={20}
            />
          </div>
          {voiceDictationError &&
          voiceDictationError.code !== INSUFFICIENT_CREDITS_FRAME_CODE ? (
            <p className="text-[11px] font-medium text-red-600 dark:text-red-400">
              {voiceDictationError.message}
            </p>
          ) : null}
        </div>
      ) : null}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <button
          type="button"
          onClick={onToggleVoiceInput}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-all ${
            isVoiceInputOpen
              ? "preview-pulse-red border-red-500 bg-red-500 text-white"
              : "border-slate-200 bg-slate-100 text-slate-600 hover:border-[#2F5C75] hover:text-[#2F5C75] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-400"
          }`}
          title={t("coursewarePreview.assistant.voiceInput")}
          aria-pressed={isVoiceInputOpen}
          aria-label={t("coursewarePreview.assistant.voiceInput")}
        >
          <Mic className="h-4 w-4" aria-hidden />
        </button>
        <div className="relative h-fit min-h-0 min-w-0 flex-1">
          {focusRippleActive ? (
            <span
              aria-hidden
              className="preview-chat-input-ripple pointer-events-none absolute inset-0 rounded-xl border-2 border-[#2F5C75]/40 dark:border-sky-400/50"
            />
          ) : null}
          <textarea
            ref={textareaRef}
            value={chatDraft}
            onChange={(e) => onChatDraftChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={inputBlocked}
            placeholder={t("coursewarePreview.assistant.messagePlaceholder")}
            rows={1}
            className="block min-h-[36px] max-h-[120px] w-full resize-none overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] leading-normal text-slate-800 outline-none focus:border-[#2F5C75] focus:ring-1 focus:ring-[#2F5C75]/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-sky-500 dark:focus:ring-sky-500/30"
          />
        </div>
        <button
          type="submit"
          disabled={!chatDraft.trim() || inputBlocked}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-all ${
            chatDraft.trim() && !inputBlocked
              ? "bg-[#2F5C75] text-white hover:opacity-90 dark:bg-sky-500"
              : "cursor-not-allowed bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-500"
          }`}
          title={t("teachingAgentInterface.button.send")}
          aria-label={t("teachingAgentInterface.button.send")}
        >
          <Send className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </div>
  );
}

const ASSISTANT_CHAT_SCROLL_BOTTOM_THRESHOLD_PX = 80;

function isAssistantChatScrollNearBottom(
  scrollEl: HTMLElement,
  threshold = ASSISTANT_CHAT_SCROLL_BOTTOM_THRESHOLD_PX,
): boolean {
  return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight <= threshold;
}

function flushAssistantChatScrollToBottom(scrollEl: HTMLElement): void {
  scrollEl.scrollTop = scrollEl.scrollHeight;
}

/** After the panel expand animation or history loading the DOM height may lag a beat, so stick to the bottom over several frames */
function scheduleFlushAssistantChatScrollToBottom(
  getScrollEl: () => HTMLElement | null,
): void {
  const tick = (): void => {
    const el = getScrollEl();
    if (el) flushAssistantChatScrollToBottom(el);
  };
  tick();
  requestAnimationFrame(() => {
    tick();
    requestAnimationFrame(() => {
      tick();
      requestAnimationFrame(tick);
    });
  });
  queueMicrotask(tick);
  window.setTimeout(tick, 0);
}

function AssistantPanel({
  open,
  activeTab,
  messages,
  assistantBusy,
  assistantHistoryLoading,
  knowledgeFiles,
  knowledgeFilesLoading,
  courseTree,
  courseTreeLoading,
  sectionContext,
  isVoiceInputOpen,
  chatInputFocusSeq,
  chatDraft,
  onChatDraftChange,
  voiceDictationState,
  voiceDictationError,
  getVoiceAnalyser,
  onToggleVoiceInput,
  onSubmitMessage,
  onSubmitAgentUserQuestion,
  onClose,
  onTabChange,
}: AssistantPanelProps) {
  const { t } = useI18nNew();
  // Display identity follows the org of the section being previewed
  // (sectionContext.orgId), not the session's current org; the hook falls
  // back to the global account identity when there is no org student card.
  const orgIdentity = useOrgStudentIdentity(sectionContext?.orgId ?? null);
  const userAvatar = decodeURIComponent(orgIdentity.avatarUrl || "/avatar-unnamed.png");
  const studentDisplayName =
    orgIdentity.name || t("player.drawer.profile.studentNameFallback");
  const asideRef = useRef<HTMLElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const resizeDragRef = useRef({ startX: 0, startWidth: ASSISTANT_PANEL_MIN_WIDTH_PX });
  const [panelWidth, setPanelWidth] = useState(ASSISTANT_PANEL_MIN_WIDTH_PX);
  const [isResizing, setIsResizing] = useState(false);

  const chatScrollKey = useMemo(() => {
    const parts: string[] = [
      `${assistantBusy ? 1 : 0}`,
      `${assistantHistoryLoading ? 1 : 0}`,
    ];
    for (const message of messages) {
      let blockSig = "";
      if (message.blocks?.length) {
        for (const block of message.blocks) {
          if (block.type === "prose") blockSig += `p${block.text.length}`;
          else if (block.type === "todos") {
            blockSig += `t${block.items.length}`;
            for (const item of block.items) blockSig += `${item.status[0]}${item.content.length}`;
          } else if (block.type === "tool") {
            blockSig += `o${block.title.length}${block.output?.length ?? 0}`;
          } else if (block.type === "insufficient_org_credits") {
            blockSig += "co";
          } else if (block.type === "insufficient_personal_credits") {
            blockSig += "cp";
          } else if (block.type === "agent_context_reset_required") {
            blockSig += "cr";
          } else if (block.type === "user_question") {
            blockSig += `q${block.questions.length}${block.answered ? 1 : 0}`;
          }
        }
      }
      parts.push(
        `${message.id}\u0001${message.text.length}\u0001${blockSig}\u0001${message.isStreaming ? 1 : 0}\u0001${message.timestampMs}`,
      );
    }
    return parts.join("\u0002");
  }, [assistantBusy, assistantHistoryLoading, messages]);

  const chatRenderItems = useMemo(
    () => buildAssistantChatRenderItems(messages, t),
    [messages, t],
  );

  const scrollAssistantChatToBottomIfNeeded = useCallback(
    (force = false): void => {
      const scrollEl = chatScrollRef.current;
      if (!scrollEl || !open || activeTab !== "history") return;
      if (force || assistantBusy || isAssistantChatScrollNearBottom(scrollEl)) {
        flushAssistantChatScrollToBottom(scrollEl);
      }
    },
    [activeTab, assistantBusy, open],
  );

  useLayoutEffect(() => {
    if (!open || activeTab !== "history") return;
    scheduleFlushAssistantChatScrollToBottom(() => chatScrollRef.current);
  }, [activeTab, open]);

  useLayoutEffect(() => {
    if (!open || activeTab !== "history") return;
    scrollAssistantChatToBottomIfNeeded(false);
  }, [activeTab, chatScrollKey, open, scrollAssistantChatToBottomIfNeeded]);

  useLayoutEffect(() => {
    if (!open || activeTab !== "history" || assistantHistoryLoading) return;
    scheduleFlushAssistantChatScrollToBottom(() => chatScrollRef.current);
  }, [activeTab, assistantHistoryLoading, messages.length, open]);

  useLayoutEffect(() => {
    if (!open || activeTab !== "history") return;
    const scrollEl = chatScrollRef.current;
    if (!scrollEl || typeof MutationObserver === "undefined") return;

    let raf = 0;
    const scheduleScroll = (): void => {
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        scrollAssistantChatToBottomIfNeeded(false);
      });
    };

    const observer = new MutationObserver(scheduleScroll);
    observer.observe(scrollEl, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [activeTab, open, scrollAssistantChatToBottomIfNeeded]);

  const getContainerWidth = useCallback((): number => {
    return asideRef.current?.parentElement?.clientWidth ?? window.innerWidth;
  }, []);

  useEffect(() => {
    const parent = asideRef.current?.parentElement;
    if (!parent) return;
    const syncWidth = (): void => {
      setPanelWidth((current) => clampAssistantPanelWidth(current, parent.clientWidth));
    };
    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    resizeDragRef.current = { startX: e.clientX, startWidth: panelWidth };
    setIsResizing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleResizePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!isResizing) return;
    const delta = e.clientX - resizeDragRef.current.startX;
    const next = resizeDragRef.current.startWidth - delta;
    setPanelWidth(clampAssistantPanelWidth(next, getContainerWidth()));
  };

  const endResize = (e: React.PointerEvent<HTMLDivElement>): void => {
    setIsResizing(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <aside
      ref={asideRef}
      style={{ width: open ? panelWidth : 0 }}
      className={`relative z-40 flex h-full shrink-0 flex-col ${
        isResizing ? "" : "transition-all duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
      } ${
        open
          ? "border-l border-slate-200 bg-white/95 shadow-[-10px_0_40px_rgba(0,0,0,0.1)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95"
          : "pointer-events-none overflow-hidden border-none bg-transparent opacity-0 shadow-none"
      }`}
      aria-hidden={!open}
    >
      {open ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("coursewarePreview.assistant.resizePanel")}
          aria-valuemin={getAssistantPanelWidthBounds(getContainerWidth()).min}
          aria-valuemax={getAssistantPanelWidthBounds(getContainerWidth()).max}
          aria-valuenow={panelWidth}
          className="absolute top-0 left-0 z-50 flex h-full w-3 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        >
          <div
            className={`h-12 w-1 rounded-full transition-colors ${
              isResizing
                ? "bg-[#2F5C75] dark:bg-sky-400"
                : "bg-slate-300/80 hover:bg-[#2F5C75]/70 dark:bg-slate-600/80 dark:hover:bg-sky-400/70"
            }`}
          />
        </div>
      ) : null}
      <div className="shrink-0 border-b border-transparent px-6 pt-4">
        <div className="flex items-center gap-3">
          <img
            src={userAvatar}
            alt=""
            className="h-12 w-12 rounded-full border-2 border-white object-cover shadow-md"
          />
          <div>
            <div className="text-base font-bold text-slate-800 dark:text-slate-100">
              {studentDisplayName}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {t("player.drawer.profile.studentRole")}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto cursor-pointer border-none bg-transparent text-slate-400 transition-transform hover:scale-110 hover:text-slate-600 dark:hover:text-slate-200"
            aria-label={t("coursewarePreview.inspector.close")}
          >
            <X className="h-6 w-6" aria-hidden />
          </button>
        </div>
        <div className="relative flex mt-2 border-b border-slate-200 dark:border-slate-700">
          {ASSISTANT_TABS.map((tab) => (
            <AssistantTabButton
              key={tab}
              active={activeTab === tab}
              label={
                tab === "history"
                  ? t("coursewarePreview.assistant.chatHistory")
                  : tab === "curriculum"
                    ? t("player.drawer.tab.curriculum")
                    : t("player.drawer.tab.materials")
              }
              onClick={() => onTabChange(tab)}
            />
          ))}
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 flex h-0.5 w-1/3 justify-center transition-transform duration-300 ease-out"
            style={{
              transform: `translateX(${ASSISTANT_TABS.indexOf(activeTab) * 100}%)`,
            }}
          >
            <span className="h-full w-10 rounded-full bg-[#2F5C75] dark:bg-[#38bdf8]" />
          </div>
        </div>
      </div>

      {activeTab === "history" ? (
        <>
          <div
            ref={chatScrollRef}
            className="preview-scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4"
          >
            <div className="preview-slide-in flex flex-col gap-4">
              {assistantHistoryLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500 dark:text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  <span>{t("coursewareEditor.aiPanel.loadingHistory")}</span>
                </div>
              ) : null}
              {chatRenderItems.map((item) =>
                item.kind === "time-divider" ? (
                  <div
                    key={item.id}
                    className="my-1 text-center text-[10px] font-medium text-slate-400"
                  >
                    {item.label}
                  </div>
                ) : item.message.role === "assistant" ? (
                  <div key={item.message.id} className="flex w-full flex-col gap-1">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {t("coursewarePreview.assistant.aiAssistant")}
                    </span>
                    <div className="w-full min-w-0 rounded-2xl bg-slate-100 px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-800 shadow-sm dark:bg-slate-700/50 dark:text-slate-200">
                      {item.message.isStreaming &&
                      !assistantPanelBubbleHasVisibleBody(
                        item.message.text,
                        item.message.blocks,
                      ) ? (
                        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                          <span>{t("coursewarePreview.assistant.thinking")}</span>
                        </div>
                      ) : (
                        <CoursewareAiAssistantMessageBody
                          content={item.message.text}
                          blocks={item.message.blocks}
                          isLive={Boolean(item.message.isStreaming)}
                          markdownClassName="text-[13px] leading-relaxed"
                          onSubmitAgentUserQuestion={onSubmitAgentUserQuestion}
                          practiceQuiz
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  <div key={item.message.id} className="flex w-full flex-col items-end gap-1">
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {studentDisplayName}
                    </span>
                    <div className="max-w-[92%] rounded-2xl bg-[#2F5C75] px-3.5 py-2.5 text-[13px] leading-relaxed text-white shadow-sm">
                      {item.message.text}
                    </div>
                  </div>
                ),
              )}
            </div>
          </div>
          <AssistantChatInputBar
            isVoiceInputOpen={isVoiceInputOpen}
            assistantBusy={assistantBusy}
            assistantHistoryLoading={assistantHistoryLoading}
            focusRequestSeq={chatInputFocusSeq}
            chatDraft={chatDraft}
            onChatDraftChange={onChatDraftChange}
            voiceDictationState={voiceDictationState}
            voiceDictationError={voiceDictationError}
            getVoiceAnalyser={getVoiceAnalyser}
            onToggleVoiceInput={onToggleVoiceInput}
            onSubmitMessage={onSubmitMessage}
            t={t}
          />
        </>
      ) : (
        <div className="preview-scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4 pb-10">
          {activeTab === "materials" ? (
            <div className="preview-slide-in">
              <AssistantMaterialsTabContent
                files={knowledgeFiles}
                loading={knowledgeFilesLoading}
                t={t}
              />
            </div>
          ) : (
            <div className="preview-slide-in">
              <AssistantCurriculumTabContent
                courseTree={courseTree}
                loading={courseTreeLoading}
                sectionContext={sectionContext}
                t={t}
              />
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function AssistantTabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex-1 py-3 text-center text-[13px] font-semibold transition-colors duration-300 ${
        active
          ? "text-[#2F5C75] dark:text-[#38bdf8]"
          : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
      }`}
    >
      {label}
    </button>
  );
}

function PreviewStudentViewStyles() {
  return (
    <style>{`
      .force-landscape-root {
        position: fixed;
        inset: 0;
        width: var(--force-landscape-viewport-width, 100dvw);
        height: var(--force-landscape-viewport-height, 100dvh);
        background: #000;
        z-index: 9999;
        overflow: hidden;
      }
      .force-landscape-root .preview-player-shell {
        position: absolute;
        top: 0;
        left: 0;
        /* Overrides Tailwind h-dvh/w-full: before rotating, width and height must swap with the viewport */
        width: var(--force-landscape-viewport-height, 100dvh) !important;
        height: var(--force-landscape-viewport-width, 100dvw) !important;
        max-width: none !important;
        transform: rotate(90deg) translateY(calc(-1 * var(--force-landscape-viewport-width, 100dvw)));
        transform-origin: top left;
        overflow: hidden;
      }
      html:has(.preview-player-root:not(.force-landscape-root)),
      html:has(.preview-player-root:not(.force-landscape-root)) body {
        height: 100%;
        overflow: hidden;
      }
      .preview-player-root:not(.force-landscape-root) {
        height: 100dvh;
        max-height: 100dvh;
      }
      .preview-player-root:fullscreen,
      .preview-player-root:-webkit-full-screen {
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
      .preview-player-root:fullscreen .preview-player-shell,
      .preview-player-root:-webkit-full-screen .preview-player-shell {
        height: 100%;
        width: 100%;
      }
      .preview-player-root.preview-player-cursor-hidden,
      .preview-player-root.preview-player-cursor-hidden * {
        cursor: none !important;
      }
      .preview-chrome-overlay-top,
      .preview-chrome-overlay-bottom {
        position: absolute;
        left: 0;
        right: 0;
        transition: transform 300ms ease-out, opacity 300ms ease-out;
        will-change: transform;
      }
      .preview-chrome-overlay-top {
        top: 0;
      }
      .preview-chrome-overlay-bottom {
        top: auto;
        bottom: 0;
      }
      .preview-chrome-overlay-visible {
        transform: translate3d(0, 0, 0);
        opacity: 1;
        pointer-events: auto;
      }
      .preview-chrome-overlay-hidden {
        pointer-events: none;
        opacity: 0;
      }
      .preview-chrome-overlay-top.preview-chrome-overlay-hidden {
        transform: translate3d(0, -100%, 0);
      }
      .preview-chrome-overlay-bottom.preview-chrome-overlay-hidden {
        transform: translate3d(0, 100%, 0);
      }
      @keyframes previewStudentSound {
        0% { height: 6px; }
        100% { height: 20px; }
      }
      @keyframes previewStudentPulseRed {
        0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
        50% { transform: scale(1.05); box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
      }
      @keyframes previewStudentSlideIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .preview-sound-bar {
        animation: previewStudentSound 0.5s ease-in-out infinite alternate;
      }
      .preview-pulse-red {
        animation: previewStudentPulseRed 1.5s infinite;
      }
      @keyframes previewChatInputRipple {
        0% {
          opacity: 1;
          transform: scale(1);
          box-shadow: 0 0 0 0 rgba(47, 92, 117, 0.4);
        }
        100% {
          opacity: 0;
          transform: scale(1.03);
          box-shadow: 0 0 0 14px rgba(47, 92, 117, 0);
        }
      }
      .preview-chat-input-ripple {
        animation: previewChatInputRipple 1s ease-out forwards;
      }
      .preview-slide-in {
        animation: previewStudentSlideIn 0.3s ease forwards;
      }
      @keyframes previewActionHintIn {
        from { opacity: 0; transform: scale(0.92); }
        to { opacity: 1; transform: scale(1); }
      }
      @keyframes previewActionHintOut {
        from { opacity: 1; transform: scale(1); }
        to { opacity: 0; transform: scale(0.92); }
      }
      .preview-action-hint-visible {
        animation: previewActionHintIn 0.2s ease-out forwards;
      }
      .preview-action-hint-exiting {
        animation: previewActionHintOut 0.22s ease-in forwards;
      }
      .preview-scrollbar-thin::-webkit-scrollbar {
        width: 4px;
      }
      .preview-scrollbar-thin::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.1);
        border-radius: 4px;
      }
      .preview-scrollbar-thin::-webkit-scrollbar-track {
        background: transparent;
      }
    `}</style>
  );
}

export { Stage as CoursewarePlaybackStage };
export type { SlideTransitionState, StageProps as CoursewarePlaybackStageProps };
