// SPDX-License-Identifier: AGPL-3.0-only
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { flushSync } from "react-dom";
import { Loader2 } from "lucide-react";
import { GlobalAudioTracks } from "../components/courseware/GlobalAudioTracks.tsx";
import { HyperframesSceneMediaDeclarations } from "../components/courseware/HyperframesSceneMediaDeclarations.tsx";
import {
  flushAllSharedLive2dStages,
  hasPaintedLive2dSharedStageTargets,
  isLive2dSharedStageBoundForCapture,
  setLive2dSharedStageCaptureManualMode,
} from "@ainobi/avatar/live2d-shared-stage";
import {
  collectSlideCanvasAudioElementsForMixer,
  createSceneScriptRuntime,
  deserializeScene,
  executeElementBinding,
  clampSlideLocalSnapshotTime,
  type ElementScriptRuntime,
  type Scene,
  type SceneScriptRuntime,
  type SlideElement,
  type Element as CourseElement,
} from "../lib/courseware/index.ts";
import { findFlowPauseCrossing, getSlideFlowPausePoints } from "@ainobi/courseware-core/slide-flow-pause.ts";
import { buildRendererFlowPauseAckSet } from "../lib/courseware-renderer/build-flow-pause-ack-set.ts";
import {
  buildRendererAutoSkippedQuizState,
  type RendererQuizQuestionState,
} from "../lib/courseware-renderer/build-renderer-quiz-state.ts";
import { preloadScenePlaybackAssets } from "../lib/courseware-renderer/preload-scene-playback-assets.ts";
import {
  getHyperframesSceneTotalDurationMs,
  getHyperframesSceneSlideOffsetMs,
  getSceneTotalDurationMs,
  getSlidePlaybackDurationMs,
  resolveHyperframesSceneTimeMs,
  resolveSceneTimeMs,
} from "../lib/courseware-renderer/playback-timing.ts";
import {
  resolveHeadlessSlideTransition,
  SLIDE_TRANSITION_MS,
  transitionBetweenSlides,
} from "../lib/courseware-renderer/slide-transition.ts";
import { sceneHasVtuberOnAnySlide } from "@ainobi/courseware-core/slide-stack.ts";
import {
  collectHyperframesMediaDeclarations,
  collectNarrationAudioUrlsFromScene,
} from "../lib/courseware-renderer/hyperframes-media-declarations.ts";
import {
  isHyperframesMediaDomReady,
  logHyperframesDomAudioDiagnostics,
  logHyperframesMediaDiagnostics,
  logHyperframesNarrationFetchVerification,
  logHyperframesNarrationMeasurement,
  logHyperframesTimelineDiagnostics,
  tailUrlForDiag,
  verifyNarrationUrlsForMux,
  type HyperframesNarrationMeasureDiag,
} from "../lib/courseware-renderer/hyperframes-media-diagnostics.ts";
import { measureNarrationAudioDurationMsForExport } from "../lib/courseware/narration-audio-duration.ts";
import {
  preloadNarrationSegmentUrls,
  setNarrationBlobPlaybackEnabled,
  waitForAllNarrationSegmentPreloads,
} from "../lib/courseware/narration-preload.ts";
import { narrationPendingStartElapsedMs, setNarrationPendingStart, NARRATION_COLD_START_HOLD_MS } from "../lib/courseware/narration-pending-start.ts";
import {
  isRendererLoadSceneMessage,
  isRendererSeekMessage,
  isRendererStartPlaybackMessage,
  postCoursewareRendererMessage,
} from "../lib/courseware-renderer/post-message.ts";
import {
  loadSceneFromRemoteCourseware,
  normalizeInitialSlideIndex,
  parseSceneFromBase64,
  presignLoadedScene,
  readSceneFromPreviewStorage,
  rendererLoadsRemoteCoursewareOnly,
  type PreviewStorageScene,
} from "../lib/courseware-renderer/scene-loader.ts";
import { useI18nNew } from "../hooks/useI18nNew.tsx";
import type { CoursewareTranslateFn } from "../lib/i18n/coursewareRoutesI18n.ts";
import sessionManager from "../host/session-manager.ts";
import {
  CoursewarePlaybackStage,
  type SlideTransitionState,
} from "./courseware-preview.tsx";

const PLAYBACK_UI_PUBLISH_MS = 80;
const RENDERER_WARMUP_TIMEOUT_MS = 120_000;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const resolveRendererIdleSlideLocalTime = (slide: SlideElement | undefined): number => {
  if (!slide) return 0;
  return clampSlideLocalSnapshotTime(slide);
};

const SLIDE_LOGICAL_WIDTH = 1920;
const SLIDE_LOGICAL_HEIGHT = 1080;
const DEFAULT_DURATION_MS = 5_000;

const RENDERER_PLACEHOLDER_SCENE_NAME = "Courseware Renderer";

const buildRendererPlaceholderScene = (): Scene =>
  deserializeScene({
    scene_id: "renderer_empty",
    name: RENDERER_PLACEHOLDER_SCENE_NAME,
    controller: {
      play: false,
      next: false,
      back: false,
      seekBar: false,
      time: false,
      slideNumber: false,
      volume: false,
      fullScreen: false,
      brand: false,
      playbackRate: false,
    },
    transitions: [],
    preset_script: "",
    metadata: {},
    slide_elements: [],
    vtuber_elements: [],
    audio_elements: [],
  });

const buildRendererFallbackSlide = (): SlideElement =>
  deserializeScene({
    scene_id: "renderer_fallback_scene",
    name: RENDERER_PLACEHOLDER_SCENE_NAME,
    controller: {
      play: false,
      next: false,
      back: false,
      seekBar: false,
      time: false,
      slideNumber: false,
      volume: false,
      fullScreen: false,
      brand: false,
      playbackRate: false,
    },
    transitions: [],
    preset_script: "",
    metadata: {},
    slide_elements: [
      {
        element_type: "slide",
        element_id: "renderer_fallback_slide",
        name: "",
        html: "",
        fps: 30,
        enter_effect: "none",
        exit_effect: "none",
        animations: [],
        event_bindings: [],
        action_mappings: {},
        event_scripts: {},
        preset_script: "",
        position: { x: 0, y: 0 },
        size: { width: SLIDE_LOGICAL_WIDTH, height: SLIDE_LOGICAL_HEIGHT },
        timeline: { start_at: 0, end_at: DEFAULT_DURATION_MS },
        style: { opacity: 1, rotation_deg: 0, z_index: 0 },
        keyframes: [],
        metadata: {},
        background_color: "#000000",
        children_elements: [],
      },
    ],
    vtuber_elements: [],
    audio_elements: [],
  }).slide_elements[0]!;

type RendererPhase = "bootstrapping" | "warming" | "ready" | "playing" | "complete" | "error";

type RendererLoadProgress = {
  phase: "bootstrapping" | "warming";
  message: string;
  percent: number;
  detail?: string;
};

const RENDERER_LOAD_PROGRESS = {
  SCENE_DONE: 10,
  PRESIGN_DONE: 20,
  PRELOAD_START: 20,
  PRELOAD_END: 70,
  WARMUP_START: 70,
  WARMUP_END: 99,
  COMPLETE: 100,
} as const;

type PendingSlideSeek = {
  localTimeMs: number;
  resumePlayback: boolean;
};

export default function CoursewareRendererPage() {
  return <CoursewareRendererContent />;
}

function CoursewareRendererContent() {
  const { t, language } = useI18nNew();
  const previewCoursewareId = useMemo((): string | null => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("courseware_id")?.trim() || null;
  }, []);

  const hfHeadlessDrive = useMemo((): boolean => {
    if (typeof window === "undefined") return false;
    const search = new URLSearchParams(window.location.search);
    return search.get("hf") === "1" || search.get("wvc") === "1";
  }, []);

  const renderTokenFromUrl = useMemo((): string | undefined => {
    if (typeof window === "undefined") return undefined;
    return new URLSearchParams(window.location.search).get("render_token")?.trim() || undefined;
  }, []);

  const hfRenderMeta = useMemo(() => {
    if (!hfHeadlessDrive || typeof window === "undefined") return null;
    const search = new URLSearchParams(window.location.search);
    const width = Number(search.get("hf_width") ?? "1920");
    const height = Number(search.get("hf_height") ?? "1080");
    const durationMs = Number(search.get("hf_duration_ms") ?? "0");
    return {
      width: Number.isFinite(width) && width > 0 ? width : 1920,
      height: Number.isFinite(height) && height > 0 ? height : 1080,
      durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null,
    };
  }, [hfHeadlessDrive]);

  const [scene, setScene] = useState<Scene>(() => buildRendererPlaceholderScene());
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [idleCoverLocalTimeMs, setIdleCoverLocalTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlaybackLoading, setIsPlaybackLoading] = useState(false);
  const [phase, setPhase] = useState<RendererPhase>(() =>
    rendererLoadsRemoteCoursewareOnly() ? "bootstrapping" : "bootstrapping",
  );
  const [loadProgress, setLoadProgress] = useState<RendererLoadProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [slideTransition, setSlideTransition] = useState<SlideTransitionState | null>(null);
  const [htmlIframeLayoutScale, setHtmlIframeLayoutScale] = useState<number | undefined>(
    undefined,
  );
  const [quizState, setQuizState] = useState<Record<string, RendererQuizQuestionState>>({});
  const [hfNarrationMeasuredByUrl, setHfNarrationMeasuredByUrl] = useState<
    Record<string, number>
  >({});

  const playbackLoadingTokensRef = useRef(new Set<string>());
  const isPlaybackLoadingRef = useRef(false);
  const currentTimeRef = useRef(0);
  const idleCoverLocalTimeRef = useRef(0);
  const isPlayingRef = useRef(false);
  const previewSlideAdvanceScheduledRef = useRef(false);
  const narrationSlideAdvanceBlockersRef = useRef(new Set<string>());
  const narrationPlayheadDriveRef = useRef<number | null>(null);
  const flowPauseAcknowledgedRef = useRef<Set<number>>(new Set());
  const pendingSeekRef = useRef<PendingSlideSeek | null>(null);
  const sceneRuntimeRef = useRef<SceneScriptRuntime | null>(null);
  const playbackCompletePostedRef = useRef(false);
  const warmupStartedAtRef = useRef<number | null>(null);
  const warmupMaxTokensRef = useRef(0);
  const warmupHeadlessLive2dReadyRef = useRef(false);
  const sceneHasVtuberRef = useRef(false);
  const hfCaptureSeekRef = useRef(false);
  const tryCompleteWarmupRef = useRef<(() => boolean) | null>(null);
  const hfNarrationMeasureReadyRef = useRef(!hfHeadlessDrive);
  const hfNarrationFetchReadyRef = useRef(!hfHeadlessDrive);
  const hfNarrationFetchSignatureRef = useRef("");
  const phaseRef = useRef<RendererPhase>(phase);
  phaseRef.current = phase;
  const loadedPreviewStorageKeyRef = useRef<string | null>(null);
  const quizContentNarrationAudioRef = useRef<HTMLAudioElement | null>(null);

  // Public render page: no login redirect callback is registered, so a ProtectedRoute callback carried over from other pages doesn't kick the user to /login.
  useEffect(() => {
    sessionManager.setEventCallbacks({
      onSessionExpired: () => {},
      onAgentSessionExpired: () => {},
    });
    return () => {
      sessionManager.setEventCallbacks({});
    };
  }, []);

  const slideList = scene.slide_elements;
  const slideCount = slideList.length;
  const effectiveSlideIndex = slideCount === 0 ? 0 : clamp(currentSlideIndex, 0, slideCount - 1);
  const slide: SlideElement =
    slideCount === 0
      ? buildRendererFallbackSlide()
      : (slideList[effectiveSlideIndex] ?? buildRendererFallbackSlide());
  const duration = Math.max(1, slide.timeline.end_at - slide.timeline.start_at);
  const slideDurationRef = useRef(duration);
  slideDurationRef.current = duration;
  const effectiveSlideIndexRef = useRef(effectiveSlideIndex);
  effectiveSlideIndexRef.current = effectiveSlideIndex;
  const slideCountRef = useRef(slideCount);
  slideCountRef.current = slideCount;

  const playheadFromRefForUi = hfHeadlessDrive ? false : isPlaying;
  const playheadClockRunningForUi = hfHeadlessDrive ? false : isPlaying;

  const slideCanvasAudioTracks = useMemo(
    () => collectSlideCanvasAudioElementsForMixer(slide),
    [slide],
  );

  const sceneSlideOffsetMs = useMemo(() => {
    if (hfHeadlessDrive) {
      return getHyperframesSceneSlideOffsetMs(
        slideList,
        effectiveSlideIndex,
        hfNarrationMeasuredByUrl,
      );
    }
    let acc = 0;
    for (let i = 0; i < effectiveSlideIndex; i += 1) {
      const s = slideList[i];
      if (!s) continue;
      acc += getSlidePlaybackDurationMs(s);
    }
    return acc;
  }, [effectiveSlideIndex, hfHeadlessDrive, hfNarrationMeasuredByUrl, slideList]);

  const sceneCurrentTime = sceneSlideOffsetMs + currentTime;
  const sceneTotalDurationMs = useMemo(
    () =>
      hfHeadlessDrive
        ? getHyperframesSceneTotalDurationMs(scene.slide_elements, hfNarrationMeasuredByUrl)
        : getSceneTotalDurationMs(scene.slide_elements),
    [hfHeadlessDrive, hfNarrationMeasuredByUrl, scene.slide_elements],
  );

  const hfMediaDeclarations = useMemo(
    () =>
      hfHeadlessDrive
        ? collectHyperframesMediaDeclarations(scene, hfNarrationMeasuredByUrl)
        : null,
    [hfHeadlessDrive, hfNarrationMeasuredByUrl, scene],
  );
  const hfMediaDiagSignatureRef = useRef("");
  const hfMediaDeclarationsRef = useRef(hfMediaDeclarations);
  hfMediaDeclarationsRef.current = hfMediaDeclarations;

  const hfCompositionDurationSec = useMemo(() => {
    const fromQueryMs = hfRenderMeta?.durationMs;
    if (fromQueryMs) return fromQueryMs / 1000;
    return Math.max(0.001, sceneTotalDurationMs / 1000);
  }, [hfRenderMeta, sceneTotalDurationMs]);
  const hfCompositionDurationSecRef = useRef(hfCompositionDurationSec);
  hfCompositionDurationSecRef.current = hfCompositionDurationSec;
  const hfHeadlessDriveRef = useRef(hfHeadlessDrive);
  hfHeadlessDriveRef.current = hfHeadlessDrive;
  const hfNarrationMeasuredByUrlRef = useRef(hfNarrationMeasuredByUrl);
  hfNarrationMeasuredByUrlRef.current = hfNarrationMeasuredByUrl;

  const syncSlideCoverLocalTime = useCallback((targetSlide: SlideElement | undefined): void => {
    const cover = resolveRendererIdleSlideLocalTime(targetSlide);
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
  }, []);

  const syncWarmupLoadProgress = useCallback(() => {
    if (phaseRef.current !== "warming") return;
    const active = playbackLoadingTokensRef.current.size;
    warmupMaxTokensRef.current = Math.max(warmupMaxTokensRef.current, active);
    const max = Math.max(warmupMaxTokensRef.current, 1);
    const ratio = 1 - active / max;
    const percent = Math.round(
      RENDERER_LOAD_PROGRESS.WARMUP_START +
        ratio * (RENDERER_LOAD_PROGRESS.WARMUP_END - RENDERER_LOAD_PROGRESS.WARMUP_START),
    );
    setLoadProgress({
      phase: "warming",
      message: t("coursewareRenderer.loading.stage"),
      percent: active === 0 ? RENDERER_LOAD_PROGRESS.WARMUP_END : percent,
      detail:
        active > 0
          ? t("coursewareRenderer.loading.stageDetail", { count: active })
          : undefined,
    });
  }, [t]);

  const applyPlaybackLoadingToken = useCallback(
    (token: string, loading: boolean) => {
      if (loading) playbackLoadingTokensRef.current.add(token);
      else playbackLoadingTokensRef.current.delete(token);
      const nextLoading = playbackLoadingTokensRef.current.size > 0;
      if (isPlaybackLoadingRef.current !== nextLoading) {
        isPlaybackLoadingRef.current = nextLoading;
        setIsPlaybackLoading(nextLoading);
      }
      if (phaseRef.current === "warming") {
        syncWarmupLoadProgress();
      }
    },
    [syncWarmupLoadProgress],
  );

  const clearPlaybackLoadingTokens = useCallback((reason: string) => {
    if (playbackLoadingTokensRef.current.size === 0 && !isPlaybackLoadingRef.current) return;
    playbackLoadingTokensRef.current.clear();
    isPlaybackLoadingRef.current = false;
    setIsPlaybackLoading(false);
    void reason;
  }, []);

  const handleCanvasAudioTrackBuffering = useCallback(
    (elementId: string, buffering: boolean) => {
      applyPlaybackLoadingToken(`canvas-audio:${elementId}`, buffering);
    },
    [applyPlaybackLoadingToken],
  );

  const appendLog = useCallback((_message: string): void => {}, []);

  const sceneRuntime: SceneScriptRuntime = useMemo(
    () =>
      createSceneScriptRuntime({
        getCurrentSlideIndex: () =>
          scene.slide_elements.length === 0
            ? 0
            : clamp(currentSlideIndex, 0, scene.slide_elements.length - 1),
        slideCount: scene.slide_elements.length,
        goToSlide: (index) => {
          const count = scene.slide_elements.length;
          if (count === 0) return;
          const fromIndex = clamp(currentSlideIndex, 0, count - 1);
          const toIndex = clamp(index, 0, count - 1);
          if (fromIndex === toIndex) return;
          const nextSlide = scene.slide_elements[toIndex];
          const fromSlide = scene.slide_elements[fromIndex];
          if (!nextSlide || !fromSlide) return;

          const transition = transitionBetweenSlides(scene, fromIndex, toIndex);
          const fromTime = currentTimeRef.current;
          if (transition === "none" || hfHeadlessDriveRef.current) {
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
            }, SLIDE_TRANSITION_MS);
          }

          const pending = pendingSeekRef.current;
          pendingSeekRef.current = null;
          const targetLocalMs = pending?.localTimeMs ?? 0;
          currentTimeRef.current = targetLocalMs;
          setCurrentTime(targetLocalMs);
          setCurrentSlideIndex(toIndex);
          if (pending?.resumePlayback) {
            isPlayingRef.current = true;
            setIsPlaying(true);
          }
        },
        openExternalUrl: () => {
          /* external links aren't opened in the video rendering environment */
        },
      }),
    [currentSlideIndex, scene],
  );

  sceneRuntimeRef.current = sceneRuntime;

  const elementRuntime: ElementScriptRuntime = useMemo(
    () => ({
      scene: sceneRuntime as unknown as Record<string, unknown>,
      browser: { openUrl: () => {} },
      external: {
        nextSlide: () => sceneRuntime.nextSlide(),
        previousSlide: () => sceneRuntime.previousSlide(),
        firstSlide: () => sceneRuntime.firstSlide(),
        lastSlide: () => sceneRuntime.lastSlide(),
        jumpToPage: (...args: unknown[]) => sceneRuntime.jumpToPage(Number(args[0] ?? 1)),
        markCorrect: () => {},
        markWrong: () => {},
      },
    }),
    [sceneRuntime],
  );

  const runBinding = useCallback(
    (element: CourseElement): void => {
      const binding = element.event_bindings.find((b) => b.event === "click" && b.enabled);
      if (!binding) return;
      try {
        executeElementBinding(element, binding, elementRuntime, {});
      } catch {
        /* the rendering environment ignores interactive script failures */
      }
    },
    [elementRuntime],
  );

  const seekSceneTime = useCallback(
    (sceneTimeMs: number): void => {
      const applySeek = (): void => {
        const slides = scene.slide_elements;
        const { slideIndex, localTimeMs } = hfHeadlessDriveRef.current
          ? resolveHyperframesSceneTimeMs(slides, sceneTimeMs, hfNarrationMeasuredByUrlRef.current)
          : resolveSceneTimeMs(slides, sceneTimeMs);

        if (slideIndex !== effectiveSlideIndexRef.current) {
          setCurrentSlideIndex(slideIndex);
          syncSlideCoverLocalTime(slides[slideIndex]);
        }

        currentTimeRef.current = localTimeMs;
        setCurrentTime(localTimeMs);

        if (hfHeadlessDriveRef.current) {
          const headlessTransition = resolveHeadlessSlideTransition(
            scene,
            slides,
            slideIndex,
            localTimeMs,
            hfNarrationMeasuredByUrlRef.current,
          );
          setSlideTransition(
            headlessTransition
              ? {
                  ...headlessTransition,
                  key: sceneTimeMs,
                }
              : null,
          );
        }

        if (!isPlayingRef.current) {
          isPlayingRef.current = true;
          setIsPlaying(true);
        }
        if (phaseRef.current !== "playing" && phaseRef.current !== "complete") {
          setPhase("playing");
        }
      };

      const { localTimeMs } = hfHeadlessDriveRef.current
        ? resolveHyperframesSceneTimeMs(
            scene.slide_elements,
            sceneTimeMs,
            hfNarrationMeasuredByUrlRef.current,
          )
        : resolveSceneTimeMs(scene.slide_elements, sceneTimeMs);
      currentTimeRef.current = localTimeMs;

      if (hfHeadlessDriveRef.current && hfCaptureSeekRef.current) {
        flushSync(applySeek);
      } else if (hfHeadlessDriveRef.current) {
        startTransition(applySeek);
      } else {
        applySeek();
      }
    },
    [scene, scene.slide_elements, syncSlideCoverLocalTime],
  );
  const seekSceneTimeRef = useRef(seekSceneTime);
  seekSceneTimeRef.current = seekSceneTime;

  const exposeHfProtocol = useCallback((): void => {
    if (!hfHeadlessDriveRef.current) return;
    if (hfCompositionDurationSecRef.current <= 0) return;
    const w = window as Window & {
      __hf?: { duration: number; seek: (timeSec: number) => void | Promise<void> };
    };
    w.__hf = {
      get duration() {
        return hfCompositionDurationSecRef.current;
      },
      seek(timeSec: number) {
        hfCaptureSeekRef.current = true;
        try {
          seekSceneTimeRef.current(Math.max(0, timeSec * 1000));
        } finally {
          hfCaptureSeekRef.current = false;
        }
        flushAllSharedLive2dStages();
        flushAllSharedLive2dStages();
      },
    };
  }, []);
  const exposeHfProtocolRef = useRef(exposeHfProtocol);
  exposeHfProtocolRef.current = exposeHfProtocol;

  /** Headless: marked ready only after the slot is bound and the tile blitted; coursewares without a vtuber pass directly. */
  const ensureHeadlessLive2dCaptureReady = useCallback((): boolean => {
    if (!hfHeadlessDriveRef.current) return true;
    if (warmupHeadlessLive2dReadyRef.current) return true;
    if (!sceneHasVtuberRef.current) {
      warmupHeadlessLive2dReadyRef.current = true;
      return true;
    }
    if (!isLive2dSharedStageBoundForCapture()) return false;
    flushAllSharedLive2dStages();
    if (!hasPaintedLive2dSharedStageTargets()) return false;
    flushAllSharedLive2dStages();
    warmupHeadlessLive2dReadyRef.current = true;
    return true;
  }, []);
  const ensureHeadlessLive2dCaptureReadyRef = useRef(ensureHeadlessLive2dCaptureReady);
  ensureHeadlessLive2dCaptureReadyRef.current = ensureHeadlessLive2dCaptureReady;

  const beginPlayback = useCallback(() => {
    if (phase === "complete") {
      flowPauseAcknowledgedRef.current = buildRendererFlowPauseAckSet(scene);
      currentTimeRef.current = 0;
      setCurrentTime(0);
      setCurrentSlideIndex(0);
      syncSlideCoverLocalTime(scene.slide_elements[0]);
      playbackCompletePostedRef.current = false;
      setPhase("ready");
    }
    setLoadProgress(null);
    isPlayingRef.current = true;
    setIsPlaying(true);
    setPhase("playing");
    postCoursewareRendererMessage({ type: "courseware-renderer:playback-started" });
  }, [phase, scene, syncSlideCoverLocalTime]);

  const finishSceneLoad = useCallback(
    async (
      loaded: Scene | PreviewStorageScene,
      source: "URL" | "localStorage" | "postMessage" | "remote",
      storageId?: string,
      initialSlideIndex?: number,
    ) => {
      setPhase("bootstrapping");
      setErrorMessage(null);
      try {
        if (hfHeadlessDrive) {
          setNarrationBlobPlaybackEnabled(false);
        }
        const isStorageScene =
          loaded && typeof loaded === "object" && "scene" in loaded && "revision" in loaded;
        let nextScene = isStorageScene ? loaded.scene : loaded;
        const nextHtmlLayoutScale = isStorageScene ? loaded.htmlIframeLayoutScale : undefined;
        const nextStorageKey =
          storageId && isStorageScene && loaded.revision
            ? `${storageId}:${loaded.revision}`
            : null;
        const nextSlideIndex = normalizeInitialSlideIndex(
          initialSlideIndex,
          nextScene.slide_elements.length,
        );

        setLoadProgress({
          phase: "bootstrapping",
          message: t("coursewareRenderer.loading.presign"),
          percent: RENDERER_LOAD_PROGRESS.SCENE_DONE,
        });
        nextScene = await presignLoadedScene(nextScene, previewCoursewareId, {
          // Dedicated to FC headless rendering: lets the backend swap the OSS branch's signed URLs for the region's internal host (no internet traffic fees, faster).
          // Enabled only with hf=1/wvc=1 (headless driver); a real user browser opening this page must never pass internal.
          network: hfHeadlessDrive ? "internal" : "public",
          renderToken: renderTokenFromUrl,
        });
        setLoadProgress({
          phase: "bootstrapping",
          message: t("coursewareRenderer.loading.presign"),
          percent: RENDERER_LOAD_PROGRESS.PRESIGN_DONE,
        });

        setLoadProgress({
          phase: "bootstrapping",
          message: t("coursewareRenderer.loading.assets"),
          percent: RENDERER_LOAD_PROGRESS.PRELOAD_START,
        });
        await preloadScenePlaybackAssets(nextScene, {
            onProgress: (completed, total) => {
              const span = RENDERER_LOAD_PROGRESS.PRELOAD_END - RENDERER_LOAD_PROGRESS.PRELOAD_START;
              const percent =
                total === 0
                  ? RENDERER_LOAD_PROGRESS.PRELOAD_END
                  : RENDERER_LOAD_PROGRESS.PRELOAD_START +
                    Math.round((completed / total) * span);
              setLoadProgress({
                phase: "bootstrapping",
                message: t("coursewareRenderer.loading.assets"),
                percent,
                detail:
                  total > 0
                    ? t("coursewareRenderer.loading.assetsDetail", {
                        current: completed,
                        total,
                      })
                    : undefined,
              });
            },
          });

        loadedPreviewStorageKeyRef.current = nextStorageKey;
        flowPauseAcknowledgedRef.current = buildRendererFlowPauseAckSet(nextScene);
        const nextQuizState = buildRendererAutoSkippedQuizState(nextScene);

        setScene(nextScene);
        setHtmlIframeLayoutScale(nextHtmlLayoutScale);
        setSlideTransition(null);
        setQuizState(nextQuizState);
        setCurrentSlideIndex(nextSlideIndex);
        currentTimeRef.current = 0;
        setCurrentTime(0);
        syncSlideCoverLocalTime(nextScene.slide_elements[nextSlideIndex]);
        isPlayingRef.current = false;
        setIsPlaying(false);
        clearPlaybackLoadingTokens("scene-loaded");
        playbackCompletePostedRef.current = false;

        postCoursewareRendererMessage({
          type: "courseware-renderer:scene-loaded",
          sceneId: nextScene.scene_id,
          slideCount: nextScene.slide_elements.length,
          durationMs: getSceneTotalDurationMs(nextScene.slide_elements),
        });

        warmupStartedAtRef.current = performance.now();
        warmupMaxTokensRef.current = 0;
        warmupHeadlessLive2dReadyRef.current = false;
        sceneHasVtuberRef.current = sceneHasVtuberOnAnySlide(nextScene.slide_elements);
        setLoadProgress({
          phase: "warming",
          message: t("coursewareRenderer.loading.stage"),
          percent: RENDERER_LOAD_PROGRESS.WARMUP_START,
        });
        setPhase("warming");

        const autoplay =
          source !== "postMessage" &&
          new URLSearchParams(window.location.search).get("autoplay") !== "0";
        if (autoplay && !hfHeadlessDrive) {
          // After warming completes, the effect starts playback automatically
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setErrorMessage(message);
        setLoadProgress(null);
        setPhase("error");
        postCoursewareRendererMessage({ type: "courseware-renderer:error", message });
      }
    },
    [clearPlaybackLoadingTokens, previewCoursewareId, renderTokenFromUrl, syncSlideCoverLocalTime, t, hfHeadlessDrive],
  );

  const replaceScene = useCallback(
    (
      load: () => Scene | PreviewStorageScene | Promise<Scene | PreviewStorageScene>,
      source: "URL" | "localStorage" | "postMessage" | "remote",
      storageId?: string,
      initialSlideIndex?: number,
    ) => {
      void (async () => {
        try {
          setPhase("bootstrapping");
          setLoadProgress({
            phase: "bootstrapping",
            message: t("coursewareRenderer.loading.scene"),
            percent: 2,
          });
          const loaded = await Promise.resolve(load());
          setLoadProgress({
            phase: "bootstrapping",
            message: t("coursewareRenderer.loading.scene"),
            percent: RENDERER_LOAD_PROGRESS.SCENE_DONE,
          });
          await finishSceneLoad(loaded, source, storageId, initialSlideIndex);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setErrorMessage(message);
          setLoadProgress(null);
          setPhase("error");
          postCoursewareRendererMessage({ type: "courseware-renderer:error", message });
        }
      })();
    },
    [finishSceneLoad, t],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const search = new URLSearchParams(window.location.search);
    const previewId = search.get("id")?.trim();
    if (previewId) {
      replaceScene(() => readSceneFromPreviewStorage(previewId, t), "localStorage", previewId);
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
    const coursewareIdFromUrl = search.get("courseware_id")?.trim() || null;
    if (coursewareIdFromUrl) {
      const renderToken = search.get("render_token")?.trim() || undefined;
      replaceScene(
        () =>
          loadSceneFromRemoteCourseware(coursewareIdFromUrl, t, {
            authRequired: false,
            renderToken,
          }),
        "remote",
        undefined,
        normalizeInitialSlideIndex(search.get("slideIndex"), Number.MAX_SAFE_INTEGER),
      );
    }
  }, [replaceScene, t]);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      if (isRendererLoadSceneMessage(event.data)) {
        replaceScene(
          () => readSceneFromPreviewStorage(event.data.previewId, t),
          "postMessage",
          event.data.previewId,
          event.data.slideIndex,
        );
        return;
      }
      if (isRendererStartPlaybackMessage(event.data)) {
        beginPlayback();
        return;
      }
      if (isRendererSeekMessage(event.data)) {
        seekSceneTime(event.data.sceneTimeMs);
        return;
      }
    };
    window.addEventListener("message", onMessage);
    postCoursewareRendererMessage({ type: "courseware-renderer:ready" });
    return () => window.removeEventListener("message", onMessage);
  }, [beginPlayback, replaceScene, seekSceneTime, t]);

  const completeWarmup = useCallback(() => {
    if (phaseRef.current !== "warming") return;
    setLoadProgress({
      phase: "warming",
      message: t("coursewareRenderer.loading.stage"),
      percent: RENDERER_LOAD_PROGRESS.COMPLETE,
    });
    setPhase("ready");
    setLoadProgress(null);
    postCoursewareRendererMessage({ type: "courseware-renderer:preload-complete" });
    const autoplay = new URLSearchParams(window.location.search).get("autoplay") !== "0";
    if (autoplay) beginPlayback();
  }, [beginPlayback, t]);

  useEffect(() => {
    if (!hfHeadlessDrive) return;
    setNarrationBlobPlaybackEnabled(false);
    setLive2dSharedStageCaptureManualMode(true);
    const w = window as Window & {
      __hf?: { duration: number; seek: (timeSec: number) => void | Promise<void> };
      __hfFlushSync?: () => void | Promise<void>;
      __COURSEWARE_RENDERER_PHASE__?: RendererPhase;
      __COURSEWARE_RENDERER_ERROR__?: string | null;
    };
    w.__COURSEWARE_RENDERER_PHASE__ = phase;
    w.__COURSEWARE_RENDERER_ERROR__ = errorMessage;
    w.__hfFlushSync = () =>
      new Promise<void>((resolve) => {
        flushAllSharedLive2dStages();
        requestAnimationFrame(() => {
          flushAllSharedLive2dStages();
          requestAnimationFrame(() => resolve());
        });
      });

    if (phase === "ready" || phase === "playing" || phase === "complete") {
      exposeHfProtocolRef.current();
    } else {
      delete w.__hf;
    }

    return () => {
      setNarrationBlobPlaybackEnabled(true);
      setLive2dSharedStageCaptureManualMode(false);
      delete w.__hf;
      delete w.__hfFlushSync;
    };
  }, [errorMessage, hfHeadlessDrive, phase]);

  useEffect(() => {
    if (!hfHeadlessDrive) {
      hfNarrationMeasureReadyRef.current = true;
      hfNarrationFetchReadyRef.current = true;
      return;
    }

    hfNarrationMeasureReadyRef.current = false;
    hfNarrationFetchReadyRef.current = false;
    hfNarrationFetchSignatureRef.current = "";
    setHfNarrationMeasuredByUrl({});

    const urls = collectNarrationAudioUrlsFromScene(scene);
    if (urls.length === 0) {
      hfNarrationMeasureReadyRef.current = true;
      hfNarrationFetchReadyRef.current = true;
      return;
    }

    preloadNarrationSegmentUrls(urls);

    let cancelled = false;
    void (async (): Promise<void> => {
      await waitForAllNarrationSegmentPreloads(urls);
      const measured: Record<string, number> = {};
      const measureDiag: HyperframesNarrationMeasureDiag[] = [];
      for (const url of urls) {
        const ms = await measureNarrationAudioDurationMsForExport(url);
        measureDiag.push({
          urlTail: tailUrlForDiag(url),
          durationMs: ms,
          ok: ms > 0,
        });
        if (ms > 0) measured[url] = ms;
      }
      if (cancelled) return;
      logHyperframesNarrationMeasurement(measureDiag);
      flushSync(() => {
        setHfNarrationMeasuredByUrl(measured);
      });
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });
      if (cancelled) return;
      hfNarrationMeasureReadyRef.current = true;
      tryCompleteWarmupRef.current?.();
    })();

    return () => {
      cancelled = true;
    };
  }, [hfHeadlessDrive, scene]);

  useEffect(() => {
    if (!hfHeadlessDrive || !hfMediaDeclarations) return;
    const signature = JSON.stringify({
      audios: hfMediaDeclarations.audios.length,
      skipped: hfMediaDeclarations.diagnostics.skippedCount,
      measured: Object.keys(hfNarrationMeasuredByUrl).length,
    });
    if (signature === hfMediaDiagSignatureRef.current) return;
    hfMediaDiagSignatureRef.current = signature;
    logHyperframesMediaDiagnostics(hfMediaDeclarations.diagnostics);
    if (Object.keys(hfNarrationMeasuredByUrl).length > 0) {
      logHyperframesTimelineDiagnostics(scene, hfNarrationMeasuredByUrl);
      logHyperframesDomAudioDiagnostics(hfMediaDeclarations.audios);

      const fetchSignature = hfMediaDeclarations.audios.map((track) => track.src).join("|");
      if (fetchSignature !== hfNarrationFetchSignatureRef.current) {
        hfNarrationFetchSignatureRef.current = fetchSignature;
        hfNarrationFetchReadyRef.current = false;
        void (async () => {
          // Retry whole-batch verification a few times: OSS can drop individual
          // connections (ERR_CONNECTION_CLOSED) even after measure succeeded.
          let results = await verifyNarrationUrlsForMux(
            collectNarrationAudioUrlsFromScene(scene),
          );
          for (let round = 1; round < 3 && results.some((r) => !r.ok); round += 1) {
            const failedUrls = results.filter((r) => !r.ok).map((r) => r.url);
            await new Promise((resolve) => setTimeout(resolve, 300 * round));
            const retried = await verifyNarrationUrlsForMux(failedUrls);
            const byUrl = new Map(results.map((r) => [r.url, r]));
            for (const row of retried) byUrl.set(row.url, row);
            results = [...byUrl.values()];
          }
          logHyperframesNarrationFetchVerification(results, hfMediaDeclarations.audios);
          const stillFailed = results.filter((r) => !r.ok);
          if (stillFailed.length > 0) {
            const ids = stillFailed
              .flatMap((r) => r.declaredIds ?? [r.urlTail])
              .join("; ");
            const message = `Narration audio URL(s) unreachable after retries — aborting render to avoid silent TTS: ${ids}`;
            console.error(`[hf-media]:error`, message);
            setErrorMessage(message);
            setPhase("error");
            postCoursewareRendererMessage({ type: "courseware-renderer:error", message });
            return;
          }
          hfNarrationFetchReadyRef.current = true;
          tryCompleteWarmupRef.current?.();
        })();
      }
    }
    if (typeof window !== "undefined") {
      (window as Window & { __hfMediaDiag?: unknown }).__hfMediaDiag =
        hfMediaDeclarations.diagnostics;
    }
    tryCompleteWarmupRef.current?.();
  }, [hfHeadlessDrive, hfMediaDeclarations, hfNarrationMeasuredByUrl, scene]);

  useEffect(() => {
    if (phase !== "warming") return;

    const MIN_WARMUP_MS = 120;
    const POLL_MS = 100;
    const warmupTimeoutMs = RENDERER_WARMUP_TIMEOUT_MS;
    const expectedNarrationUrlCount = hfHeadlessDrive
      ? collectNarrationAudioUrlsFromScene(scene).length
      : 0;

    const tryComplete = (): boolean => {
      if (phaseRef.current !== "warming") return true;
      const startedAt = warmupStartedAtRef.current ?? performance.now();
      const elapsed = performance.now() - startedAt;
      const headlessLive2dReady = ensureHeadlessLive2dCaptureReadyRef.current();
      const measuredCount = Object.keys(hfNarrationMeasuredByUrlRef.current).length;
      const narrationMeasured =
        !hfHeadlessDrive ||
        expectedNarrationUrlCount === 0 ||
        measuredCount >= expectedNarrationUrlCount;
      const declarations = hfMediaDeclarationsRef.current;
      const domReady =
        !hfHeadlessDrive ||
        !declarations ||
        declarations.audios.length === 0 ||
        isHyperframesMediaDomReady(declarations.audios);
      const mediaReady = hfHeadlessDrive
        ? narrationMeasured &&
          domReady &&
          headlessLive2dReady &&
          hfNarrationFetchReadyRef.current
        : !isPlaybackLoadingRef.current && hfNarrationMeasureReadyRef.current;
      if (elapsed >= MIN_WARMUP_MS && mediaReady) {
        if (hfHeadlessDrive && declarations) {
          logHyperframesDomAudioDiagnostics(declarations.audios);
        }
        exposeHfProtocolRef.current();
        completeWarmup();
        return true;
      }
      return false;
    };

    tryCompleteWarmupRef.current = tryComplete;

    if (tryComplete()) return;

    const pollId = window.setInterval(() => {
      if (tryComplete()) window.clearInterval(pollId);
    }, POLL_MS);

    const timeoutId = window.setTimeout(() => {
      if (phaseRef.current !== "warming") return;
      ensureHeadlessLive2dCaptureReadyRef.current();
      if (!hfHeadlessDrive || hfNarrationMeasureReadyRef.current) {
        exposeHfProtocolRef.current();
        completeWarmup();
      }
    }, warmupTimeoutMs);

    return () => {
      tryCompleteWarmupRef.current = null;
      window.clearInterval(pollId);
      window.clearTimeout(timeoutId);
    };
  }, [completeWarmup, hfHeadlessDrive, phase, scene]);

  useEffect(() => {
    if (phase !== "warming") return;
    syncWarmupLoadProgress();
  }, [isPlaybackLoading, phase, syncWarmupLoadProgress]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    if (isPlayingRef.current) return;
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    if (!playheadClockRunningForUi || hfHeadlessDrive) return;

    let raf = 0;
    let last = performance.now();
    let lastUiPublishAt = performance.now();

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
          // Headless rendering has no user who could press play — give up the stuck narration segment and resume the wall clock to keep rendering
          // (that segment is silent, the scene advances to completion as usual, and playback-complete is sent normally).
          setNarrationPendingStart(false);
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
        rawNext = prev + (now - last);
        last = now;
      }

      let next = rawNext;
      const slideLocal = slide;
      const durationLocal = slideDurationRef.current;

      const flowCrossing = findFlowPauseCrossing(
        getSlideFlowPausePoints(slideLocal),
        prev,
        next,
        flowPauseAcknowledgedRef.current,
      );
      if (flowCrossing) {
        next = flowCrossing.at_ms;
        narrationPlayheadDriveRef.current = null;
      }

      if (next >= durationLocal) {
        const narrationBlockingAdvance = narrationSlideAdvanceBlockersRef.current.size > 0;
        if (narrationBlockingAdvance) {
          next = durationLocal;
        } else if (
          slideCountRef.current > 0 &&
          effectiveSlideIndexRef.current < slideCountRef.current - 1
        ) {
          if (!previewSlideAdvanceScheduledRef.current) {
            previewSlideAdvanceScheduledRef.current = true;
            const overflow = Math.max(0, next - durationLocal);
            const nextSlide = scene.slide_elements[effectiveSlideIndexRef.current + 1];
            pendingSeekRef.current = {
              localTimeMs: nextSlide
                ? clamp(overflow, 0, getSlidePlaybackDurationMs(nextSlide))
                : 0,
              resumePlayback: true,
            };
            queueMicrotask(() => {
              sceneRuntimeRef.current?.nextSlide();
            });
          }
          next = durationLocal;
        } else {
          queueMicrotask(() => {
            isPlayingRef.current = false;
            setIsPlaying(false);
            if (!playbackCompletePostedRef.current) {
              playbackCompletePostedRef.current = true;
              setPhase("complete");
              postCoursewareRendererMessage({ type: "courseware-renderer:playback-complete" });
            }
          });
          next = durationLocal;
        }
      }

      currentTimeRef.current = next;
      if (now - lastUiPublishAt >= PLAYBACK_UI_PUBLISH_MS || next >= durationLocal) {
        lastUiPublishAt = now;
        startTransition(() => setCurrentTime(next));
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playheadClockRunningForUi, scene.slide_elements, slide, hfHeadlessDrive]);

  useEffect(() => {
    if (isPlaying) return;
    narrationPlayheadDriveRef.current = null;
    clearPlaybackLoadingTokens("pause");
    const synced = currentTimeRef.current;
    startTransition(() => {
      setCurrentTime((prev) => (prev === synced ? prev : synced));
    });
  }, [clearPlaybackLoadingTokens, isPlaying]);

  useEffect(() => {
    previewSlideAdvanceScheduledRef.current = false;
    narrationSlideAdvanceBlockersRef.current.clear();
    narrationPlayheadDriveRef.current = null;
    clearPlaybackLoadingTokens("slide-change");
    if (currentTimeRef.current <= 0) {
      syncSlideCoverLocalTime(scene.slide_elements[currentSlideIndex]);
    }
  }, [clearPlaybackLoadingTokens, currentSlideIndex, scene.slide_elements, syncSlideCoverLocalTime]);

  const noopQuizStateChange: Dispatch<SetStateAction<Record<string, RendererQuizQuestionState>>> =
    useCallback(() => {}, []);

  return (
    <div
      className="courseware-renderer-root fixed inset-0 overflow-hidden bg-black text-white"
      {...(hfHeadlessDrive
        ? {
            id: "stage",
            "data-composition-id": "courseware",
            "data-start": "0",
            "data-width": String(hfRenderMeta?.width ?? 1920),
            "data-height": String(hfRenderMeta?.height ?? 1080),
            "data-duration": String(hfCompositionDurationSec),
            "data-no-timeline": "true",
            "data-hf-headless": "true",
          }
        : {})}
    >
      <style>{`
        html:has(.courseware-renderer-root),
        html:has(.courseware-renderer-root) body {
          margin: 0;
          height: 100%;
          overflow: hidden;
          background: #000;
        }
        .courseware-renderer-root {
          width: 100dvw;
          height: 100dvh;
        }
        .courseware-renderer-root[data-hf-headless] * {
          transition: none !important;
          animation: none !important;
        }
      `}</style>

      {phase === "bootstrapping" || phase === "warming" ? (
        <RendererLoadingOverlay progress={loadProgress} t={t} />
      ) : null}

      {phase === "error" && errorMessage ? (
        <div
          className="absolute inset-0 z-60 flex items-center justify-center bg-black px-6 text-center text-sm text-red-300"
          role="alert"
        >
          {errorMessage}
        </div>
      ) : null}

      {hfHeadlessDrive && hfMediaDeclarations ? (
        <HyperframesSceneMediaDeclarations declarations={hfMediaDeclarations} />
      ) : null}

      <GlobalAudioTracks
        tracks={scene.audio_elements}
        sceneCurrentTime={sceneCurrentTime}
        sceneTimeOffsetMs={sceneSlideOffsetMs}
        playheadRef={currentTimeRef}
        playheadFromRef={playheadFromRefForUi}
        playheadClockRunning={playheadClockRunningForUi}
        pausedSceneTimeMs={currentTime}
        isPlaying={isPlaying}
        playIntent={isPlaying}
        onTrackBufferingChange={handleCanvasAudioTrackBuffering}
        rate={1}
        volumeMultiplier={1}
      />
      <GlobalAudioTracks
        tracks={slideCanvasAudioTracks}
        sceneCurrentTime={currentTime}
        sceneTimeOffsetMs={0}
        playheadRef={currentTimeRef}
        playheadFromRef={playheadFromRefForUi}
        playheadClockRunning={playheadClockRunningForUi}
        pausedSceneTimeMs={currentTime}
        isPlaying={isPlaying}
        playIntent={isPlaying}
        onTrackBufferingChange={handleCanvasAudioTrackBuffering}
        rate={1}
        volumeMultiplier={1}
      />
      <audio ref={quizContentNarrationAudioRef} className="hidden" aria-hidden preload="auto" />

      <main className="absolute inset-0 flex overflow-hidden bg-black">
        <CoursewarePlaybackStage
          rendererMode
          rendererWarmup={phase === "warming"}
          previewCoursewareId={previewCoursewareId}
          language={language}
          sectionOrgId={null}
          sectionCourseId={null}
          sectionId={null}
          requiredQuizWrapperIds={[]}
          htmlIframeLayoutScale={htmlIframeLayoutScale}
          slide={slide}
          allSlides={scene.slide_elements}
          quiz={scene.quiz ?? null}
          sceneId={scene.scene_id}
          quizState={quizState}
          onQuizStateChange={noopQuizStateChange}
          currentTime={currentTime}
          idleCoverLocalTimeMs={idleCoverLocalTimeMs}
          playheadRef={currentTimeRef}
          playheadFromRef={playheadFromRefForUi}
          playheadClockRunning={playheadClockRunningForUi}
          isPlaying={isPlaying}
          onPlaybackLoadingTokenChange={applyPlaybackLoadingToken}
          onNarrationSlideAdvanceGate={setNarrationSlideAdvanceGate}
          onNarrationPlayheadDriveChange={setNarrationPlayheadDrive}
          slideTransition={slideTransition}
          inochiUrl=""
          onRunBinding={runBinding}
          getQuizPostSubmitPrimaryLabel={() => ""}
          onQuizPostSubmitPrimary={() => {}}
          onSkipQuestion={() => {}}
          onScoreResult={() => {}}
          onLog={appendLog}
          quizStemAutoplay={null}
          activeQuizPauseWrapperId={null}
          onQuizRecordingStarted={() => {}}
          quizAttemptSessionIdRef={{ current: null }}
          quizAttemptSessionStorageKey={null}
          attachQuestionSnapshotToQuizSubmit={false}
          quizContentNarrationAudioRef={quizContentNarrationAudioRef}
          playbackRate={1}
          masterVolume={1}
          headlessSeekDrive={hfHeadlessDrive}
          narrationMeasuredDurationByUrl={hfNarrationMeasuredByUrl}
          forceLandscapeLayoutEpoch={false}
        />
      </main>
    </div>
  );
}

function RendererLoadingOverlay({
  progress,
  t,
}: {
  progress: RendererLoadProgress | null;
  t: CoursewareTranslateFn;
}) {
  const percent = progress?.percent ?? 0;
  const message =
    progress?.message ??
    (progress?.phase === "warming"
      ? t("coursewareRenderer.loading.stage")
      : t("coursewareRenderer.loading.scene"));

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white px-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <Loader2 className="h-10 w-10 animate-spin text-blue-600" aria-hidden />
      <div className="flex w-full max-w-xs flex-col gap-2">
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-blue-600 transition-[width] duration-300 ease-out"
            style={{ width: `${clamp(percent, 0, 100)}%` }}
          />
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
          <span className="truncate">{message}</span>
          <span className="shrink-0 tabular-nums text-slate-500">
            {t("coursewareRenderer.loading.percent", { percent })}
          </span>
        </div>
        {progress?.detail ? (
          <p className="text-center text-[11px] text-slate-400">{progress.detail}</p>
        ) : null}
      </div>
    </div>
  );
}
