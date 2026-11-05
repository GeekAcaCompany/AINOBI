// SPDX-License-Identifier: AGPL-3.0-only
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AudioLines,
  BookType,
  Gauge,
  GripVertical,
  Loader2,
  Mic,
  Pause,
  Play,
  Plus,
  RotateCw,
  Shuffle,
  Square,
  Trash2,
  User,
  X,
} from "lucide-react";
import aiTeacherApi from "@ainobi/courseware-player/host/ai-teacher-api";
import coursewareAssetsApi from "@ainobi/courseware-player/api/courseware_assets";
import ttsApi from "@ainobi/courseware-player/host/tts-api";
import { TTSProvider, TTSStatus } from "@ainobi/courseware-player/enums/tts";
import { useI18nNew } from "@ainobi/courseware-player/hooks/useI18nNew";
import type { CoursewareTranslateFn } from "@ainobi/courseware-player/lib/i18n/coursewareRoutesI18n";
import { measureNarrationAudioDurationMs } from "@ainobi/courseware-player/lib/courseware/narration-audio-duration";
import { stripCoursewareAssetSignatureFromUrl } from "@ainobi/courseware-player/api/courseware";
import type {
  NarrationElement,
  NarrationSegment,
  SlideElement,
  VtuberElement,
} from "@ainobi/courseware-player/lib/courseware/index";
import {
  listSlideNarrationTimelineRefs,
  resolveNextNarrationStartAt,
} from "@ainobi/courseware-core/narration-timeline-overlap.ts";
import { fixRecordedWebmBlob } from "@ainobi/courseware-player/lib/fix-recorded-webm-blob";
import type { AITeacherInfo } from "@ainobi/courseware-player/schemas/ai_teacher";
import type { TTSInfo } from "@ainobi/courseware-player/schemas/tts";
import { NarrationPronunciationDictModal } from "./NarrationPronunciationDictPanel.tsx";

const NARRATION_DEFAULT_GAP_MS = 200;
const NARRATION_TEACHER_BINDING_UNLINKED_META = "ai_teacher_binding_unlinked";
const SPEED_MIN = 0.5;
const SPEED_MAX = 1.5;
const SPEED_STEP = 0.05;
/** Sensing zone and maximum scroll speed when dragging a paragraph near the top/bottom edge of the scroll container */
const SEGMENT_EDGE_SCROLL_ZONE_PX = 56;
const SEGMENT_EDGE_SCROLL_MAX_SPEED_PX = 18;
/** Narration segment textarea: starts at one row, at most 3 rows, scrolling beyond that */
const SEGMENT_TEXTAREA_LINE_PX = 20;
const SEGMENT_TEXTAREA_PAD_Y_PX = 16;
const SEGMENT_TEXTAREA_MAX_LINES = 3;
const SEGMENT_TEXTAREA_MAX_PX =
  SEGMENT_TEXTAREA_LINE_PX * SEGMENT_TEXTAREA_MAX_LINES + SEGMENT_TEXTAREA_PAD_Y_PX;

const fitSegmentTextareaHeight = (el: HTMLTextAreaElement): void => {
  el.style.height = "auto";
  const contentHeight = el.scrollHeight;
  el.style.height = `${Math.min(contentHeight, SEGMENT_TEXTAREA_MAX_PX)}px`;
  el.style.overflowY = contentHeight > SEGMENT_TEXTAREA_MAX_PX ? "auto" : "hidden";
};

/** Pixels to scroll per frame when the pointer is at the top/bottom edge of the scroll container (negative up, positive down). */
const segmentEdgeScrollDeltaY = (clientY: number, frame: HTMLElement): number => {
  const rect = frame.getBoundingClientRect();
  const yInFrame = clientY - rect.top;
  if (yInFrame < SEGMENT_EDGE_SCROLL_ZONE_PX) {
    const t = 1 - Math.max(0, yInFrame) / SEGMENT_EDGE_SCROLL_ZONE_PX;
    return -SEGMENT_EDGE_SCROLL_MAX_SPEED_PX * t;
  }
  if (yInFrame > rect.height - SEGMENT_EDGE_SCROLL_ZONE_PX) {
    const dist = yInFrame - (rect.height - SEGMENT_EDGE_SCROLL_ZONE_PX);
    const t = Math.min(1, Math.max(0, dist) / SEGMENT_EDGE_SCROLL_ZONE_PX);
    return SEGMENT_EDGE_SCROLL_MAX_SPEED_PX * t;
  }
  return 0;
};

const RECORDING_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg;codecs=opus",
] as const;

const recordingFileExtension = (mimeType: string): string => {
  const lower = mimeType.toLowerCase();
  if (lower.includes("mp4") || lower.includes("m4a") || lower.includes("aac")) return "mp4";
  if (lower.includes("mpeg") || lower.includes("mp3")) return "mp3";
  if (lower.includes("ogg")) return "ogg";
  return "webm";
};

const pickRecordingMimeType = (): string => {
  if (typeof MediaRecorder === "undefined") return "";
  return RECORDING_MIME_CANDIDATES.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? "";
};

const genId = (prefix: string): string =>
  `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

const clearNarrationTeacherUnlinkedMeta = (
  metadata: NarrationElement["metadata"],
): NarrationElement["metadata"] => {
  if (!metadata || typeof metadata !== "object") return metadata;
  const next = { ...(metadata as Record<string, unknown>) };
  delete next[NARRATION_TEACHER_BINDING_UNLINKED_META];
  return next as NarrationElement["metadata"];
};

export const generateNarrationAudioSegment = async (params: {
  coursewareId: string;
  line: string;
  ttsId?: string;
  /** Narration style key (a recommended preset or style catalog key); effective for Google TTS */
  ttsStyle?: string;
  teacherId: string;
  speechRate: number;
  gapMs: number;
}): Promise<NarrationSegment> => {
  const ttsResult = await coursewareAssetsApi.synthesizeAiTeacherTts({
    coursewareId: params.coursewareId,
    text: params.line,
    format: "mp3",
    aiTeacherId: params.teacherId,
    speechRate: params.speechRate,
    ...(params.ttsId?.trim() ? { ttsId: params.ttsId.trim() } : {}),
    ...(params.ttsStyle?.trim() ? { ttsStyle: params.ttsStyle.trim() } : {}),
  });
  const ttsUrl = ttsResult.tts_url;
  const signedByOriginal = await coursewareAssetsApi.batchPresignUrls(params.coursewareId, [
    ttsUrl,
  ]);
  const playableUrl = signedByOriginal[ttsUrl] ?? ttsUrl;
  // Always measure the file duration; the TTS API's duration_ms is often short, and across several segments the timeline would drift.
  let durationMs = await measureNarrationAudioDurationMs(playableUrl);
  if (durationMs <= 0 && typeof ttsResult.duration_ms === "number" && ttsResult.duration_ms > 0) {
    durationMs = Math.round(ttsResult.duration_ms);
  }
  return {
    text: params.line,
    // Playback keeps the presigned URL from the TTS response: a key just generated and not yet stored isn't in courseware.content,
    // so batch_presign would refuse to sign it (against privilege abuse), and the bare URL with the signature stripped always 404s on the private bucket.
    // Persisting strips the signature uniformly on the save path (agent normalize + three-way merge), so signatures are never persisted.
    audio_url: playableUrl,
    duration_ms: Math.max(200, durationMs > 0 ? durationMs : 1500),
    gap_ms: params.gapMs,
    speech_rate: params.speechRate,
    source: "tts",
  };
};

type SegmentDraftStatus = "pending" | "generating" | "success" | "failed" | "recording";

interface SegmentDraft {
  id: string;
  text: string;
  status: SegmentDraftStatus;
  segment: NarrationSegment | null;
  speechRate: number;
  /** Index in the committed narration; independent of unsaved draft reordering. */
  savedIndex?: number;
  error?: string;
  speedPanelOpen?: boolean;
}

interface NarrationModalProps {
  coursewareId: string;
  coursewareOrgId: string | null;
  slide: SlideElement;
  vtubers: VtuberElement[];
  initialVtuberId: string;
  initialNarrationElementId?: string | null;
  onClose: () => void;
  onSwitchNarrator: (params: {
    sourceVtuberElementId: string;
    narrationElementId: string | null;
  }) => void;
  onConfirm: (narration: NarrationElement) => void;
  onSegmentSave: (narration: NarrationElement) => void;
}

const findNarrationForModalPrefill = (
  slide: SlideElement,
  initialNarrationElementId: string | null,
  selectedVtuber: VtuberElement | undefined,
): NarrationElement | undefined => {
  if (initialNarrationElementId) {
    const pinned = slide.children_elements.find(
      (el): el is NarrationElement =>
        el.element_id === initialNarrationElementId && el.element_type === "narration",
    );
    if (pinned) return pinned;
  }
  if (selectedVtuber) {
    return slide.children_elements.find(
      (el): el is NarrationElement =>
        el.element_type === "narration" &&
        (el as NarrationElement).vtuber_element_id === selectedVtuber.element_id,
    );
  }
  return slide.children_elements.find(
    (el): el is NarrationElement => el.element_type === "narration",
  );
};

const buildNarrationElement = (params: {
  styleKey?: string;
  vtuber: VtuberElement;
  aiTeacher: AITeacherInfo | null;
  existing?: NarrationElement | null;
  segments: NarrationSegment[];
  ttsId?: string | null;
  speechRate?: number;
  unlinkStaleTeacher?: boolean;
  /** Whether subtitles show on the canvas; defaults to the existing narration or true */
  subtitleVisible?: boolean;
  /** Other narration tracks on the current page; a new one offsets its start automatically */
  slide?: SlideElement;
  /** Display name of the narration element (generated in the current language; never hard-code the Chinese "讲解") */
  narrationName: (teacherDisplayName: string) => string;
}): NarrationElement => {
  const base = params.existing;
  const totalMs = params.segments.reduce(
    (acc, seg) => acc + seg.gap_ms + seg.duration_ms,
    0,
  );
  const teacherId = params.aiTeacher?.ai_teacher_id?.trim()
    ? params.aiTeacher.ai_teacher_id
    : (base?.ai_teacher_id?.trim() ?? "");
  const teacherName = params.unlinkStaleTeacher
    ? (base?.ai_teacher_name ?? "")
    : (params.aiTeacher?.ai_teacher_name ??
      base?.ai_teacher_name ??
      "AI Teacher");
  const displayName = teacherName || "AI Teacher";
  const slideStart = params.slide?.timeline.start_at ?? base?.timeline.start_at ?? 0;
  const startAt = base
    ? base.timeline.start_at
    : resolveNextNarrationStartAt(
        slideStart,
        params.slide ? listSlideNarrationTimelineRefs(params.slide) : [],
      );
  const joinedText = params.segments
    .map((seg) => seg.text.trim())
    .filter(Boolean)
    .join("\n");
  const baseMetadata = (base?.metadata ?? {}) as Record<string, unknown>;
  const metadata = params.unlinkStaleTeacher
    ? {
        ...baseMetadata,
        ai_teacher_id: teacherId,
        ai_teacher_name: teacherName,
        vtuber_element_id: params.vtuber.element_id,
        [NARRATION_TEACHER_BINDING_UNLINKED_META]: true,
      }
    : {
        ...(base?.metadata ? clearNarrationTeacherUnlinkedMeta(base.metadata) : {}),
        ai_teacher_id: teacherId,
        ai_teacher_name: teacherName,
        vtuber_element_id: params.vtuber.element_id,
      };
  const ttsId =
    params.ttsId?.trim() ||
    params.aiTeacher?.ai_teacher_tts_id ||
    base?.ai_teacher_tts_id;
  const speechRate =
    params.speechRate ??
    params.aiTeacher?.ai_teacher_tts_speed ??
    base?.ai_teacher_tts_speed ??
    1;
  return {
    element_type: "narration",
    element_id: base?.element_id ?? genId("el_narration"),
    name: params.narrationName(displayName),
    html: base?.html ?? "",
    fps: base?.fps ?? 30,
    position: base?.position ?? { x: 60, y: 940 },
    size: base?.size ?? { width: 1800, height: 100 },
    timeline: {
      start_at: startAt,
      end_at: Math.max(startAt + 1, startAt + totalMs),
    },
    style: base?.style ?? { opacity: 1, rotation_deg: 0, z_index: 1 },
    enter_effect: base?.enter_effect ?? "none",
    exit_effect: base?.exit_effect ?? "none",
    animations: base?.animations ?? [],
    keyframes: base?.keyframes ?? [],
    event_bindings: base?.event_bindings ?? [],
    action_mappings: base?.action_mappings ?? {},
    event_scripts: base?.event_scripts ?? {},
    preset_script: base?.preset_script ?? "",
    metadata,
    ai_teacher_id: teacherId,
    ai_teacher_name: teacherName,
    ai_teacher_tts_id: ttsId,
    ai_teacher_tts_style: params.styleKey?.trim() || undefined,
    ai_teacher_tts_speed: speechRate,
    ai_teacher_tts_volume: params.aiTeacher?.ai_teacher_tts_volume ?? base?.ai_teacher_tts_volume,
    ai_teacher_tts_pitch: params.aiTeacher?.ai_teacher_tts_pitch ?? base?.ai_teacher_tts_pitch,
    ai_teacher_language: params.aiTeacher?.ai_teacher_language ?? base?.ai_teacher_language,
    vtuber_element_id: params.vtuber.element_id,
    script: joinedText,
    transcript: joinedText,
    segments: params.segments.map((seg, index) => ({
      ...seg,
      gap_ms: index === 0 ? 0 : NARRATION_DEFAULT_GAP_MS,
    })),
    subtitle_background_color: base?.subtitle_background_color ?? "#020617",
    subtitle_text_color: base?.subtitle_text_color ?? "#FFFFFF",
    subtitle_background_opacity: base?.subtitle_background_opacity ?? 0.7,
    subtitle_background_transparent: base?.subtitle_background_transparent ?? false,
    subtitle_visible: params.subtitleVisible ?? base?.subtitle_visible ?? true,
  };
};

const formatDurationSec = (ms: number, t: CoursewareTranslateFn): string =>
  t("coursewareEditor.narration.durationSeconds", {
    seconds: (Math.max(0, ms) / 1000).toFixed(1),
  });

/** Empty string = language not set (tts_language empty) */
const UNKNOWN_TTS_LANGUAGE = "";

const TTS_LANGUAGE_ORDER = ["zh", "ja", "en"] as const;

const normalizeTtsLanguage = (lang: string | null | undefined): string =>
  (lang ?? "").trim().toLowerCase();


/**
 * The voice picked once the catalog finishes loading. Priority: the user's explicit choice > the narration's saved value >
 * the AI teacher's binding > the current automatic choice > Chinese > the first one. When the user switched the language explicitly,
 * only voices of that language are chosen from (it doesn't go back to the bound voice's language).
 */
export function pickPreferredVoice<T extends { tts_id: string; tts_language?: string | null }>(
  list: readonly T[],
  ctx: {
    userPickedTtsId?: string | null;
    userPickedLanguage?: string | null;
    persistedTtsId?: string | null;
    teacherTtsId?: string | null;
    currentTtsId?: string | null;
  },
): T | undefined {
  const lang = ctx.userPickedLanguage ?? null;
  const inLang = (voice: T) => normalizeTtsLanguage(voice.tts_language) === lang;
  const candidates = lang !== null && list.some(inLang) ? list.filter(inLang) : list;
  const byId = (id: string | null | undefined) =>
    id ? candidates.find((voice) => voice.tts_id === id) : undefined;
  return (
    byId(ctx.userPickedTtsId) ??
    byId(ctx.persistedTtsId) ??
    byId(ctx.teacherTtsId) ??
    byId(ctx.currentTtsId) ??
    (lang !== null ? candidates[0] : undefined) ??
    list.find((voice) => normalizeTtsLanguage(voice.tts_language) === "zh") ??
    list[0]
  );
}

// Follows editorLanguageMenuLabel: "English" is its own name in every locale.
const ttsLanguageLabel = (
  lang: string,
  unknownLabel: string,
  t: CoursewareTranslateFn,
): string => {
  if (!lang) return unknownLabel;
  if (lang === "zh") return t("coursewareEditor.toolbar.languageZh");
  if (lang === "ja") return t("coursewareEditor.toolbar.languageJa");
  if (lang === "en") return "English";
  return lang;
};

const sortTtsLanguages = (langs: string[]): string[] =>
  [...langs].sort((a, b) => {
    const order = TTS_LANGUAGE_ORDER as readonly string[];
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai !== -1 || bi !== -1) {
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    }
    return a.localeCompare(b);
  });

export function NarrationModal({
  coursewareId,
  coursewareOrgId,
  slide,
  vtubers,
  initialVtuberId,
  initialNarrationElementId = null,
  onClose,
  onSwitchNarrator,
  onConfirm,
  onSegmentSave,
}: NarrationModalProps) {
  const { t, language } = useI18nNew();
  const [vtuberId, setVtuberId] = useState<string>(initialVtuberId);
  const [aiTeacher, setAITeacher] = useState<AITeacherInfo | null>(null);
  const [aiTeacherError, setAITeacherError] = useState<string | null>(null);
  const [isLoadingTeacher, setIsLoadingTeacher] = useState(false);
  const [teacherUnavailable, setTeacherUnavailable] = useState(false);

  const [ttsCatalog, setTtsCatalog] = useState<TTSInfo[]>([]);
  const [isLoadingTts, setIsLoadingTts] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("zh");
  const [selectedTtsId, setSelectedTtsId] = useState<string>("");
  // Narration style key (a recommended preset or style catalog key); the picker shows only for Google TTS voices
  const [selectedStyleKey, setSelectedStyleKey] = useState<string>("");
  // Source of the style value: explicit (user choice / stored on the element) can't be overridden by inheritance; inherited/none
  // is re-evaluated with the current teacher (after rebinding it switches to the new teacher's style automatically)
  const [styleSource, setStyleSource] = useState<"none" | "inherited" | "explicit">(
    "none",
  );
  const [ttsStyleCatalog, setTtsStyleCatalog] = useState<{
    default_style_key: string;
    recommended: Array<{
      style_key: string;
      label: string;
      label_en?: string;
      label_ja?: string;
    }>;
  } | null>(null);
  const [ttsStyleCatalogSettled, setTtsStyleCatalogSettled] = useState(false);
  // Explicitly choosing "default" materializes the platform default key (used for synthesis/saving, overriding the teacher style)
  const defaultStyleKey = ttsStyleCatalog?.default_style_key || "friendly_teacher";
  const styleDirtyRef = useRef(false);
  const hydratedNarrationIdRef = useRef<string | null>(null);
  // The ID the user chose explicitly in the voice selector. On catalog refetch it has top priority,
  // while anything else (automatic fallback choices) is overwritten by narration/teacher bindings that arrive later.
  const userPickedTtsIdRef = useRef<string | null>(null);
  // The language the user switched to explicitly. Even after the catalog refetch completes, only voices of this
  // language are chosen from again (it doesn't go back to the bound voice's language on its own).
  const userPickedLanguageRef = useRef<string | null>(null);
  const [subtitleVisible, setSubtitleVisible] = useState(true);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);

  const [drafts, setDrafts] = useState<SegmentDraft[]>([]);
  // Rows may be deleted/reordered during async generation: always read the latest draft through the ref by id
  const draftsRef = useRef<SegmentDraft[]>(drafts);
  draftsRef.current = drafts;
  const committedNarrationRef = useRef<NarrationElement | undefined>(undefined);
  const savedSegmentsRef = useRef<NarrationSegment[] | null>(null);
  const pendingFallbackDraftIdsRef = useRef(new Set<string>());
  const generationEpochRef = useRef(0);
  useEffect(() => () => { generationEpochRef.current += 1; }, []);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [recordingIndex, setRecordingIndex] = useState<number | null>(null);
  const [pronDictOpen, setPronDictOpen] = useState(false);
  /** Paragraph drag reorder: from=-1 means not dragging */
  const [segmentDrag, setSegmentDrag] = useState<{
    from: number;
    hoverTo: number | null;
  }>({ from: -1, hoverTo: null });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordStartedAtRef = useRef(0);
  const playableUrlByAudioUrlRef = useRef<Record<string, string>>({});
  const voiceHydratedRef = useRef(false);
  const prevSelectedTtsIdRef = useRef<string>("");
  const prevBoundTeacherIdRef = useRef<string | null>(null);
  const segmentTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const pendingFocusDraftIdRef = useRef<string | null>(null);
  const segmentListScrollRef = useRef<HTMLDivElement | null>(null);
  const segmentDragClientYRef = useRef(0);
  const segmentEdgeScrollRafRef = useRef<number | null>(null);
  const segmentDragFromRef = useRef(-1);
  segmentDragFromRef.current = segmentDrag.from;

  useLayoutEffect(() => {
    for (const draft of drafts) {
      const el = segmentTextareaRefs.current[draft.id];
      if (el) fitSegmentTextareaHeight(el);
    }
    const focusId = pendingFocusDraftIdRef.current;
    if (focusId) {
      const el = segmentTextareaRefs.current[focusId];
      if (el) {
        pendingFocusDraftIdRef.current = null;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.focus();
      }
    }
  }, [drafts]);

  const selectedVtuber = vtubers.find((v) => v.element_id === vtuberId) ?? vtubers[0];
  const selectedVoice = ttsCatalog.find((voice) => voice.tts_id === selectedTtsId);
  const selectedVoiceProvider = selectedVoice?.tts_provider;
  const isMiniMaxProvider = selectedVoiceProvider === TTSProvider.MiniMax;
  const isFishAudioProvider = selectedVoiceProvider === TTSProvider.FishAudio;
  const isGoogleProvider = selectedVoiceProvider === TTSProvider.Google;
  // The Japanese kana dictionary applies to Google / Fish Audio / MiniMax, the Chinese tone dictionary only to MiniMax
  // (consistent with shouldApplyPronunciationDict / shouldApplyMinimaxToneDict on the courseware side).
  const isJaOnlyDictProvider = isFishAudioProvider || isGoogleProvider;
  const supportsPronunciationDict =
    selectedLanguage === "ja"
      ? isMiniMaxProvider || isJaOnlyDictProvider
      : selectedLanguage === "zh"
        ? isMiniMaxProvider
        : false;
  const pronunciationDictDisabledReason = !supportsPronunciationDict
    ? isGoogleProvider && selectedLanguage !== "ja"
      ? t("coursewareEditor.narration.pronDict.googleJaOnly")
      : isFishAudioProvider && selectedLanguage !== "ja"
      ? t("coursewareEditor.narration.pronDict.fishJaOnly")
      : selectedLanguage !== "zh" && selectedLanguage !== "ja"
        ? t("coursewareEditor.narration.pronDict.zhJaOnly")
        : t("coursewareEditor.narration.pronDict.unsupportedProvider")
    : undefined;
  const aiTeacherIdFromVtuber =
    typeof selectedVtuber?.metadata?.ai_teacher_id === "string"
      ? (selectedVtuber.metadata.ai_teacher_id as string).trim() || null
      : null;
  const existingNarrationForModal = findNarrationForModalPrefill(
    slide,
    initialNarrationElementId,
    selectedVtuber,
  );
  const boundNarrationVtuberId = existingNarrationForModal?.vtuber_element_id?.trim() ?? "";
  const narrationVtuberOnSlide =
    !!boundNarrationVtuberId &&
    vtubers.some((vtuber) => vtuber.element_id === boundNarrationVtuberId);
  const isOrphanNarrationBinding = !!existingNarrationForModal && !narrationVtuberOnSlide;
  const narrationTeacherIdFromSlide = existingNarrationForModal?.ai_teacher_id?.trim() || null;
  const persistedNarrationTtsId =
    existingNarrationForModal?.ai_teacher_tts_id?.trim() || null;
  const aiTeacherIdForLoad =
    aiTeacherIdFromVtuber || (narrationVtuberOnSlide ? narrationTeacherIdFromSlide : null);

  const availableLanguages = useMemo(() => {
    const set = new Set(
      ttsCatalog.map((voice) => normalizeTtsLanguage(voice.tts_language)),
    );
    return sortTtsLanguages(Array.from(set));
  }, [ttsCatalog]);

  const voicesForLanguage = useMemo(() => {
    return ttsCatalog.filter(
      (voice) => normalizeTtsLanguage(voice.tts_language) === selectedLanguage,
    );
  }, [selectedLanguage, ttsCatalog]);

  const showTtsStyleSelect = selectedVoice?.tts_provider === "google";
  // Custom style: choosing "custom style…" enters custom mode, and the text box value is the style value;
  // the effective value = effectiveStyleKey (synthesis/saving both use it)
  const CUSTOM_STYLE_VALUE = "__custom__";
  const [customStyleMode, setCustomStyleMode] = useState(false);
  const [customStyleText, setCustomStyleText] = useState("");
  const effectiveStyleKey = customStyleMode ? customStyleText : selectedStyleKey;
  // Classify once the catalog arrives: an existing value that isn't a known key → switch to custom mode (editing backfills the custom text).
  // Runs only after the catalog is ready (settled): both loading and failed wait for the decision here.
  useEffect(() => {
    if (!ttsStyleCatalogSettled || customStyleMode || !selectedStyleKey) return;
    const known = (ttsStyleCatalog?.recommended ?? []).some(
      (s) => s.style_key === selectedStyleKey,
    );
    if (!known) {
      setCustomStyleMode(true);
      setCustomStyleText(selectedStyleKey);
      // The backfilled display is the baseline: applying the classification doesn't count as a style change
      prevEffectiveStyleRef.current = selectedStyleKey;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsStyleCatalogSettled, ttsStyleCatalog, selectedStyleKey, customStyleMode]);
  const styleSelectValue = customStyleMode ? CUSTOM_STYLE_VALUE : selectedStyleKey;
  const showCustomStyleInput = showTtsStyleSelect && customStyleMode;
  // The style picker's hint text follows the narration language (like the labels), not the UI language
  const stylePickerTexts =
    selectedLanguage === "ja"
      ? {
          default: "デフォルト（おすすめスタイル）",
          custom: "カスタムスタイル…",
          recommended: "おすすめ",
          all: "すべてのスタイル",
        }
      : selectedLanguage === "en"
        ? {
            default: "Default (recommended style)",
            custom: "Custom style…",
            recommended: "Recommended",
            all: "All styles",
          }
        : {
            default: "默认（推荐风格）",
            custom: "自定义风格…",
            recommended: "推荐风格",
            all: "全部风格",
          };

  // Inheriting the teacher's bound style: once the catalog is ready + the teacher finished loading and is the teacher currently requested (during rebinding
  // aiTeacher is still the old teacher, whose style must not be inherited) + the narration hasn't chosen a style explicitly, show the teacher's
  // configured style (consistent with the synthesis-side prepare priority "narration override > teacher style > default").
  // After applying, the classification effect decides the select/custom form; see there for how the baseline advances.
  useEffect(() => {
    if (!ttsStyleCatalogSettled || isLoadingTeacher) return;
    if (styleSource === "explicit") return;
    const currentTeacherId = aiTeacherIdForLoad?.trim() || "";
    if (!aiTeacher || aiTeacher.ai_teacher_id !== currentTeacherId) return;
    // Inheriting resets the whole form shape: a recommended key → select; custom text → custom mode;
    // no style → back to default, leaving custom. customStyleMode is only the display form,
    // and doesn't block inheritance on its own (after rebinding, A's custom text must be replaced by B's style).
    const inherited = aiTeacher.ai_teacher_tts_style?.trim() || "";
    setSelectedStyleKey(inherited);
    if (
      inherited &&
      !(ttsStyleCatalog?.recommended ?? []).some((s) => s.style_key === inherited)
    ) {
      setCustomStyleMode(true);
      setCustomStyleText(inherited);
    } else {
      setCustomStyleMode(false);
      setCustomStyleText("");
    }
    setStyleSource(inherited ? "inherited" : "none");
    prevEffectiveStyleRef.current = inherited;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ttsStyleCatalogSettled,
    isLoadingTeacher,
    aiTeacher,
    aiTeacherIdForLoad,
    styleSource,
  ]);
  // After the narration style changes, existing audio counts as stale: the same hint wording as a voice change.
  // The warning is triggered only by user actions (choosing/typing); baseline advancers such as inheritance/classification/backfill
  // update prevEffectiveStyleRef silently, so effects never chase each other.
  const prevEffectiveStyleRef = useRef<string | null>(null);
  const styleTrackingArmedRef = useRef(false);
  const warnStyleChange = (nextEffective: string): void => {
    if (!styleTrackingArmedRef.current) return;
    if (prevEffectiveStyleRef.current === nextEffective) return;
    prevEffectiveStyleRef.current = nextEffective;
    stopPlayback();
    setAudioError(t("coursewareEditor.narration.styleChangedRegenHint"));
  };
  const recommendedStyleOptions = useMemo(
    () =>
      (ttsStyleCatalog?.recommended ?? []).map((style) => ({
        style_key: style.style_key,
        // Labels follow the narration language (like the voice names): Japanese → label_ja, English → label_en
        label:
          selectedLanguage === "zh"
            ? style.label
            : selectedLanguage === "ja"
              ? style.label_ja || style.label_en || style.label
              : style.label_en || style.label,
      })),
    [ttsStyleCatalog, selectedLanguage],
  );

  const totalAudioMs = drafts.reduce(
    (acc, draft) => acc + (draft.segment?.duration_ms ?? 0) + (draft.segment?.gap_ms ?? 0),
    0,
  );

  useEffect(() => {
    if (!initialVtuberId) return;
    setVtuberId((prev) => (prev === initialVtuberId ? prev : initialVtuberId));
    setTeacherUnavailable(false);
  }, [initialVtuberId]);

  useEffect(() => {
    if (vtubers.length === 0) return;
    if (vtubers.some((vtuber) => vtuber.element_id === vtuberId)) return;
    const reboundId =
      boundNarrationVtuberId && vtubers.some((v) => v.element_id === boundNarrationVtuberId)
        ? boundNarrationVtuberId
        : vtubers[0].element_id;
    setVtuberId(reboundId);
    setTeacherUnavailable(false);
  }, [boundNarrationVtuberId, vtuberId, vtubers]);

  // Prefill drafts from existing narration
  useEffect(() => {
    const existing = findNarrationForModalPrefill(
      slide,
      initialNarrationElementId,
      selectedVtuber,
    );
    // Our segment write updates slide/vtuber props. Do not rehydrate and discard
    // other drafts (or invalidate the remaining requests in a batch).
    if (existing && existing.segments === savedSegmentsRef.current) {
      committedNarrationRef.current = existing;
      // Echo of a newly created/regenerated item within the session: neither the style value nor its source changed — keep the current classification
      // (an inherited value must not be relabeled explicit because of the echo, or it couldn't be re-inherited after rebinding);
      // the baseline prevEffectiveStyleRef is already set by the inheritance/classification paths, and this only arms the tracking
      styleTrackingArmedRef.current = true;
      return;
    }
    generationEpochRef.current += 1;
    committedNarrationRef.current = existing;
    savedSegmentsRef.current = null;
    pendingFallbackDraftIdsRef.current.clear();
    voiceHydratedRef.current = false;
    prevSelectedTtsIdRef.current = "";
    playableUrlByAudioUrlRef.current = {};
    setSubtitleVisible(existing?.subtitle_visible ?? true);
    // The narration style is backfilled for plain text narration too (restore it even without segments, or a retry would use the default style)
    const existingStyleKey = existing?.ai_teacher_tts_style?.trim() ?? "";
    // A rebind re-render within the same dialog session (including the flow of a new narration without an element id yet):
    // the user's unsaved explicit style choice is kept, not overwritten by the persisted old value
    const sameModalStyleContext =
      hydratedNarrationIdRef.current === initialNarrationElementId;
    if (!(sameModalStyleContext && styleDirtyRef.current)) {
      setSelectedStyleKey(existingStyleKey);
      // A stored style counts as an explicit source: it stops the inheritance effect from overriding the user's persisted choice
      setStyleSource(existingStyleKey ? "explicit" : "none");
      setCustomStyleMode(false);
      setCustomStyleText("");
      prevEffectiveStyleRef.current = existingStyleKey;
    }
    styleTrackingArmedRef.current = Boolean(existing);
    hydratedNarrationIdRef.current = initialNarrationElementId ?? null;
    if (existing?.segments?.length) {
      setDrafts(
        existing.segments.map((seg, savedIndex) => ({
          savedIndex,
          id: genId("seg"),
          text: seg.text,
          status: "success" as const,
          segment: seg,
          speechRate: seg.speech_rate ?? existing.ai_teacher_tts_speed ?? 1,
        })),
      );
      if (existing.ai_teacher_tts_id) {
        setSelectedTtsId(existing.ai_teacher_tts_id);
      }
      const urls = existing.segments
        .map((seg) => seg.audio_url?.trim())
        .filter((url): url is string => !!url);
      if (urls.length > 0) {
        void coursewareAssetsApi
          .batchPresignUrls(coursewareId, urls)
          .then((signedByOriginal) => {
            for (const url of urls) {
              playableUrlByAudioUrlRef.current[url] = signedByOriginal[url] ?? url;
            }
          })
          .catch(() => {
            /* the playback path retries when presigning fails */
          });
      }
    } else {
      // Text exists but no generated audio yet (automatic TTS failed / an imported pending narration): restore the text for viewing and retrying
      const fallbackText =
        existing?.transcript?.trim() || existing?.script?.trim() || "";
      if (fallbackText) {
        const fallbackDrafts = fallbackText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => ({
            id: genId("seg"),
            text: line,
            status: "pending" as const,
            segment: null,
            speechRate: existing?.ai_teacher_tts_speed ?? 1,
          }));
        pendingFallbackDraftIdsRef.current = new Set(fallbackDrafts.map((draft) => draft.id));
        setDrafts(fallbackDrafts);
        if (existing?.ai_teacher_tts_id) {
          setSelectedTtsId(existing.ai_teacher_tts_id);
        }
      } else {
        setDrafts([
          {
            id: genId("seg"),
            text: "",
            status: "pending",
            segment: null,
            speechRate: 1,
          },
        ]);
      }
    }
  }, [coursewareId, initialNarrationElementId, selectedVtuber, slide]);

  // Load AI teacher
  useEffect(() => {
    let cancelled = false;
    const hasPersistedNarration =
      !!existingNarrationForModal &&
      (existingNarrationForModal.script.trim().length > 0 ||
        existingNarrationForModal.transcript.trim().length > 0 ||
        existingNarrationForModal.segments.length > 0);

    if (!aiTeacherIdForLoad) {
      setAITeacher(null);
      setAvatarLoadFailed(false);
      setTeacherUnavailable(hasPersistedNarration || isOrphanNarrationBinding);
      setAITeacherError(
        isOrphanNarrationBinding
          ? null
          : hasPersistedNarration
            ? t("coursewareEditor.narration.staleTeacherUnlinked")
            : t("coursewareEditor.narration.vtuberNoTeacher"),
      );
      return () => {
        cancelled = true;
      };
    }
    if (!coursewareOrgId?.trim()) {
      return () => {
        cancelled = true;
      };
    }
    setIsLoadingTeacher(true);
    setAITeacherError(null);
    setTeacherUnavailable(false);
    aiTeacherApi
      .getAITeacher(aiTeacherIdForLoad, undefined, coursewareOrgId)
      .then((info) => {
        if (cancelled) return;
        setAITeacher(info);
        setTeacherUnavailable(false);
        setAITeacherError(null);
        setAvatarLoadFailed(false);
        if (!selectedTtsId && info.ai_teacher_tts_id) {
          setSelectedTtsId(info.ai_teacher_tts_id);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setAITeacher(null);
        setTeacherUnavailable(true);
        setAvatarLoadFailed(false);
        setAITeacherError(t("coursewareEditor.narration.staleTeacherUnlinked"));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingTeacher(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    aiTeacherIdForLoad,
    coursewareOrgId,
    existingNarrationForModal,
    isOrphanNarrationBinding,
    selectedTtsId,
    t,
  ]);

  // Load TTS catalog (must wait for the courseware organization ID, like loading the AI teacher; never fall back to the login org)
  useEffect(() => {
    let cancelled = false;
    if (!coursewareOrgId?.trim()) {
      return () => {
        cancelled = true;
      };
    }
    setIsLoadingTts(true);
    const loadCatalog = async () => {
      // The style catalog and the voice catalog are fetched in parallel: neither blocks the other (each has its own cancelled guard)
      setTtsStyleCatalogSettled(false);
      const stylePromise = ttsApi
        .getTtsStyles(coursewareOrgId)
        .catch(() => null);
      const active = await ttsApi.getAllTTS({ tts_status: TTSStatus.Active }, coursewareOrgId);
      if (cancelled) return [];
      const styleCatalog = await stylePromise;
      if (cancelled) return [];
      setTtsStyleCatalog(styleCatalog);
      setTtsStyleCatalogSettled(true);
      // When an existing narration / AI teacher saved an old hidden (inactive) voice (FishAudio / MiniMax),
      // it would silently switch to another voice once gone from the options, so only the voice with that ID is added.
      // A hidden voice the user chose explicitly is added too (so refetches such as switching narrators don't remove it).
      const boundIds = [
        userPickedTtsIdRef.current,
        persistedNarrationTtsId,
        aiTeacher?.ai_teacher_tts_id,
      ].filter(
        (id): id is string => Boolean(id) && !active.some((voice) => voice.tts_id === id),
      );
      if (boundIds.length === 0) return active;
      // Failures aren't swallowed but treated as a catalog load failure: continuing with active only would
      // miss the bound voice and silently replace it with another, changing the voice on regeneration.
      const inactive = await ttsApi.getAllTTS(
        { tts_status: TTSStatus.Inactive },
        coursewareOrgId,
      );
      return [...active, ...inactive.filter((voice) => boundIds.includes(voice.tts_id))];
    };
    loadCatalog()
      .then((list) => {
        if (cancelled) return;
        setTtsCatalog(list);
        // Priority: the user's explicit choice > the narration's saved value > the AI teacher's binding > the current automatic choice.
        // Even when teacher info arrives after the catalog, an automatic fallback that came in first
        // must not overwrite the bound voice (including hidden old voices).
        const preferredVoice = pickPreferredVoice(list, {
          userPickedTtsId: userPickedTtsIdRef.current,
          userPickedLanguage: userPickedLanguageRef.current,
          persistedTtsId: persistedNarrationTtsId,
          teacherTtsId: aiTeacher?.ai_teacher_tts_id,
          currentTtsId: selectedTtsId,
        });
        if (preferredVoice) {
          // Voices without a language (common among old voices) stay "not set". Pushing them to Chinese with `|| "zh"`
          // would get them replaced by the first Chinese voice in the language sync, losing the bound voice.
          setSelectedLanguage(normalizeTtsLanguage(preferredVoice.tts_language));
          setSelectedTtsId(preferredVoice.tts_id);
        }
        if (list.length === 0) {
          setAudioError(t("coursewareEditor.narration.ttsCatalogEmpty"));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTtsCatalog([]);
          setAudioError(t("coursewareEditor.narration.ttsCatalogLoadFailed"));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingTts(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiTeacher?.ai_teacher_tts_id, coursewareOrgId, persistedNarrationTtsId]);

  // After the voice catalog changes: if the current language isn't in the list, prefer falling back to Chinese
  useEffect(() => {
    if (availableLanguages.length === 0) return;
    if (availableLanguages.includes(selectedLanguage)) return;
    setSelectedLanguage(
      availableLanguages.includes("zh")
        ? "zh"
        : (availableLanguages[0] ?? UNKNOWN_TTS_LANGUAGE),
    );
  }, [availableLanguages, selectedLanguage]);

  // After switching language: if the current voice isn't in the filtered result, fall back to that language's first voice
  useEffect(() => {
    if (voicesForLanguage.length === 0) return;
    if (voicesForLanguage.some((v) => v.tts_id === selectedTtsId)) return;
    setSelectedTtsId(voicesForLanguage[0].tts_id);
  }, [selectedTtsId, voicesForLanguage]);

  const narratorDisplayLabel = useMemo((): string => {
    if (isOrphanNarrationBinding) return t("coursewareEditor.narration.noNarrator");
    if (isLoadingTeacher) return t("coursewareEditor.common.loading");
    if (aiTeacher?.ai_teacher_name?.trim()) return aiTeacher.ai_teacher_name.trim();
    if (!aiTeacherIdForLoad?.trim()) return t("coursewareEditor.narration.noNarrator");
    if (teacherUnavailable || !aiTeacher) return t("coursewareEditor.narration.noNarrator");
    return t("coursewareEditor.narration.noNarrator");
  }, [
    aiTeacher,
    aiTeacherIdForLoad,
    isLoadingTeacher,
    isOrphanNarrationBinding,
    teacherUnavailable,
    t,
  ]);

  const handleOpenNarratorPick = useCallback((): void => {
    onSwitchNarrator({
      sourceVtuberElementId: selectedVtuber?.element_id ?? boundNarrationVtuberId ?? "",
      narrationElementId: initialNarrationElementId ?? null,
    });
  }, [
    boundNarrationVtuberId,
    initialNarrationElementId,
    onSwitchNarrator,
    selectedVtuber?.element_id,
  ]);

  const stopPlayback = (): void => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.playbackRate = 1;
    }
    setActiveSegmentIndex(null);
    setIsAudioPlaying(false);
  };

  // A voice change only suggests regenerating; existing audio is kept and confirming the save isn't blocked
  useEffect(() => {
    if (isLoadingTts) return;
    if (!selectedTtsId) return;
    if (!voiceHydratedRef.current) {
      voiceHydratedRef.current = true;
      prevSelectedTtsIdRef.current = selectedTtsId;
      return;
    }
    if (prevSelectedTtsIdRef.current === selectedTtsId) return;
    prevSelectedTtsIdRef.current = selectedTtsId;
    stopPlayback();
    setAudioError(t("coursewareEditor.narration.voiceChangedRegenHint"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingTts, selectedTtsId, t]);


  // After rebinding the narrator, text and audio are kept; it only suggests regenerating the speech
  useEffect(() => {
    const nextTeacherId = existingNarrationForModal?.ai_teacher_id?.trim() ?? "";
    if (prevBoundTeacherIdRef.current === null) {
      prevBoundTeacherIdRef.current = nextTeacherId;
      return;
    }
    if (prevBoundTeacherIdRef.current === nextTeacherId) return;
    const previousTeacherId = prevBoundTeacherIdRef.current;
    prevBoundTeacherIdRef.current = nextTeacherId;
    // The first binding doesn't count as a change; the hint shows only when switching from an existing teacher to another
    if (!previousTeacherId || !nextTeacherId) return;
    stopPlayback();
    setAudioError(t("coursewareEditor.narration.narratorChangedRegenHint"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingNarrationForModal?.ai_teacher_id, t]);

  const updateDraft = (index: number, patch: Partial<SegmentDraft>): void => {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  };

  const updateDraftById = (id: string, patch: Partial<SegmentDraft>): void => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  };

  const handleAddSegment = (): void => {
    const id = genId("seg");
    pendingFocusDraftIdRef.current = id;
    setDrafts((prev) => [
      ...prev,
      {
        id,
        text: "",
        status: "pending",
        segment: null,
        speechRate: prev[prev.length - 1]?.speechRate ?? 1,
      },
    ]);
  };

  /** Insert a new empty paragraph after the given one */
  const handleInsertSegmentAfter = (index: number): void => {
    const id = genId("seg");
    pendingFocusDraftIdRef.current = id;
    setDrafts((prev) => {
      const speechRate =
        prev[index]?.speechRate ?? prev[prev.length - 1]?.speechRate ?? 1;
      const next = [...prev];
      next.splice(index + 1, 0, {
        id,
        text: "",
        status: "pending",
        segment: null,
        speechRate,
      });
      return next;
    });
    // After inserting, later indexes all shift by +1
    setActiveSegmentIndex((prev) =>
      prev !== null && prev > index ? prev + 1 : prev,
    );
    setRecordingIndex((prev) =>
      prev !== null && prev > index ? prev + 1 : prev,
    );
  };

  const handleDeleteSegment = (index: number): void => {
    if (activeSegmentIndex === index) stopPlayback();
    if (recordingIndex === index) void stopRecording(true);
    setDrafts((prev) => {
      if (prev.length <= 1) {
        return [
          {
            id: genId("seg"),
            text: "",
            status: "pending",
            segment: null,
            speechRate: 1,
          },
        ];
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  /** Reorder narration paragraphs by dragging; to is the final drop index (inserted at that position) */
  const handleReorderSegment = (from: number, to: number): void => {
    if (from === to || from < 0 || to < 0) return;
    // Reordering is forbidden while recording, so the MediaRecorder callback doesn't write back by an old index
    if (recordingIndex != null) return;
    stopPlayback();
    setDrafts((prev) => {
      if (from >= prev.length || to > prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      // After from is removed, indexes originally after to shift back by 1, landing at the position of the "indicator line"
      const insertAt = from < to ? to - 1 : to;
      if (insertAt === from) return prev;
      next.splice(insertAt, 0, item);
      return next;
    });
    setActiveSegmentIndex((prev) => {
      if (prev === null) return null;
      if (prev === from) {
        return from < to ? to - 1 : to;
      }
      if (from < to) {
        if (prev > from && prev < to) return prev - 1;
      } else if (prev >= to && prev < from) {
        return prev + 1;
      }
      return prev;
    });
  };

  /**
   * From the pointer position within the card, compute the target index "insert before this index".
   * Upper half: insert before the current segment; lower half: insert after it.
   */
  const resolveSegmentDropInsertIndex = (
    index: number,
    clientY: number,
    target: EventTarget | null,
  ): number => {
    const el = target instanceof HTMLElement ? target.closest("li") : null;
    if (!el) return index;
    const rect = el.getBoundingClientRect();
    const insertAfter = clientY > rect.top + rect.height / 2;
    return insertAfter ? index + 1 : index;
  };

  const canDragReorderSegments =
    !isBatchGenerating && recordingIndex == null && drafts.length > 1;

  const stopSegmentEdgeAutoScroll = useCallback((): void => {
    if (segmentEdgeScrollRafRef.current !== null) {
      cancelAnimationFrame(segmentEdgeScrollRafRef.current);
      segmentEdgeScrollRafRef.current = null;
    }
  }, []);

  const syncSegmentEdgeAutoScroll = useCallback((): void => {
    if (segmentEdgeScrollRafRef.current !== null) return;
    const tick = (): void => {
      if (segmentDragFromRef.current < 0) {
        segmentEdgeScrollRafRef.current = null;
        return;
      }
      const frame = segmentListScrollRef.current;
      if (!frame) {
        segmentEdgeScrollRafRef.current = null;
        return;
      }
      const delta = segmentEdgeScrollDeltaY(segmentDragClientYRef.current, frame);
      if (delta === 0) {
        segmentEdgeScrollRafRef.current = null;
        return;
      }
      const prevTop = frame.scrollTop;
      frame.scrollTop += delta;
      // Stop when already at the top/bottom; otherwise keep scrolling
      if (frame.scrollTop === prevTop) {
        segmentEdgeScrollRafRef.current = null;
        return;
      }
      segmentEdgeScrollRafRef.current = requestAnimationFrame(tick);
    };
    segmentEdgeScrollRafRef.current = requestAnimationFrame(tick);
  }, []);

  // While dragging, track the pointer with document dragover and auto-scroll the list near the top/bottom edges
  useEffect(() => {
    if (segmentDrag.from < 0) {
      stopSegmentEdgeAutoScroll();
      return;
    }
    const onDragOver = (e: DragEvent): void => {
      segmentDragClientYRef.current = e.clientY;
      syncSegmentEdgeAutoScroll();
    };
    const onDragEnd = (): void => {
      stopSegmentEdgeAutoScroll();
    };
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("dragend", onDragEnd);
    document.addEventListener("drop", onDragEnd);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("dragend", onDragEnd);
      document.removeEventListener("drop", onDragEnd);
      stopSegmentEdgeAutoScroll();
    };
  }, [segmentDrag.from, stopSegmentEdgeAutoScroll, syncSegmentEdgeAutoScroll]);

  // Whether the voice can be used for synthesis: the catalog fetch (including adding hidden bound voices) has finished,
  // and the selected ID exists in that catalog. Synthesizing with the ID of an old automatic choice while fetching or after a failed fetch
  // would save it with a different voice.
  const voiceReady = !isLoadingTts && ttsCatalog.some((voice) => voice.tts_id === selectedTtsId);

  const regenerateSegment = async (draftId: string): Promise<boolean> => {
    const index = draftsRef.current.findIndex((d) => d.id === draftId);
    const draft = index >= 0 ? draftsRef.current[index] : undefined;
    if (!draft) return false;
    const teacherId = aiTeacher?.ai_teacher_id?.trim();
    if (!teacherId) {
      setAudioError(t("coursewareEditor.narration.teacherNotReady"));
      return false;
    }
    const text = draft.text.trim();
    if (!text) {
      setAudioError(t("coursewareEditor.narration.fillScriptFirst"));
      return false;
    }
    if (!selectedTtsId) {
      setAudioError(t("coursewareEditor.narration.noTtsId"));
      return false;
    }
    if (!voiceReady) {
      setAudioError(t("coursewareEditor.narration.voiceNotReady"));
      return false;
    }
    if (activeSegmentIndex === index) stopPlayback();
    const speechRate = draft.speechRate;
    const generationEpoch = generationEpochRef.current;
    updateDraftById(draftId, { status: "generating", error: undefined });
    try {
      const generated = await generateNarrationAudioSegment({
        coursewareId,
        line: text,
        ttsId: selectedTtsId,
        ttsStyle:
          effectiveStyleKey ||
          (styleDirtyRef.current ? defaultStyleKey : undefined),
        teacherId,
        speechRate,
        gapMs: index === 0 ? 0 : NARRATION_DEFAULT_GAP_MS,
      });
      // Rows may be deleted or their text/speed changed during the request: recheck by id and drop stale results
      if (generationEpoch !== generationEpochRef.current) return false;
      const current = draftsRef.current.find((d) => d.id === draftId);
      if (!current) return false;
      if (current.text.trim() !== text || current.speechRate !== speechRate) {
        updateDraftById(draftId, {
          status: current.segment ? "success" : "pending",
        });
        return false;
      }
      if (!selectedVtuber) return false;
      const existing = committedNarrationRef.current;
      // Merge only this result with committed audio, never with other draft edits.
      const segments = [...(existing?.segments ?? [])];
      const isNewSegment = current.savedIndex === undefined;
      const currentIndex = draftsRef.current.findIndex((d) => d.id === draftId);
      const nextSavedIndex = draftsRef.current.slice(currentIndex + 1)
        .find((d) => d.savedIndex !== undefined)?.savedIndex;
      const savedIndex = current.savedIndex ?? nextSavedIndex ?? segments.length;
      if (isNewSegment) segments.splice(savedIndex, 0, generated);
      else segments[savedIndex] = generated;
      const next = buildNarrationElement({
        vtuber: selectedVtuber,
        aiTeacher,
        existing,
        slide,
        segments,
        ttsId: selectedTtsId,
        styleKey:
          effectiveStyleKey ||
          (styleDirtyRef.current ? defaultStyleKey : undefined),
        speechRate,
        narrationName: (name) => t("coursewareEditor.meta.narrationElementName", { name }),
      });
      pendingFallbackDraftIdsRef.current.delete(draftId);
      // Audio may cover only part of an imported text-only narration. Keep its
      // committed text until every restored paragraph has a saved segment.
      if (existing && pendingFallbackDraftIdsRef.current.size > 0) {
        next.script = existing.script;
        next.transcript = existing.transcript;
      }
      committedNarrationRef.current = next;
      savedSegmentsRef.current = next.segments;
      const nextDrafts = draftsRef.current.map((d) => d.id === draftId ? {
        ...d, text, status: "success" as const, segment: generated, savedIndex, error: undefined,
      } : isNewSegment && d.savedIndex !== undefined && d.savedIndex >= savedIndex
        ? { ...d, savedIndex: d.savedIndex + 1 }
        : d);
      // Batch generation can continue before React renders the previous result.
      draftsRef.current = nextDrafts;
      setDrafts(nextDrafts);
      onSegmentSave(next);
      return true;
    } catch (err) {
      if (generationEpoch !== generationEpochRef.current) return false;
      updateDraftById(draftId, {
        status: "failed",
        segment: null,
        error: err instanceof Error ? err.message : t("coursewareEditor.toast.narrationFailed"),
      });
      return false;
    }
  };

  const handleRegenerateAll = async (): Promise<void> => {
    if (!aiTeacher?.ai_teacher_id) {
      setAudioError(t("coursewareEditor.narration.teacherNotReady"));
      return;
    }
    setIsBatchGenerating(true);
    setAudioError(null);
    stopPlayback();
    let failed = 0;
    // Recorded segments don't take part in batch TTS regeneration, so the user's microphone recordings aren't overwritten by synthesized audio
    const targetIds = draftsRef.current
      .filter((d) => d.text.trim() && d.segment?.source !== "recording")
      .map((d) => d.id);
    for (const draftId of targetIds) {
      if (!draftsRef.current.some((d) => d.id === draftId)) continue;
      const ok = await regenerateSegment(draftId);
      if (!ok) failed += 1;
    }
    if (failed > 0) {
      setAudioError(t("coursewareEditor.narration.segmentsPartialFail", { failed }));
    }
    setIsBatchGenerating(false);
  };

  const resolvePlayableUrl = async (audioUrl: string): Promise<string> => {
    const cached = playableUrlByAudioUrlRef.current[audioUrl];
    if (cached) return cached;
    try {
      const signed = await coursewareAssetsApi.batchPresignUrls(coursewareId, [audioUrl]);
      const playable = signed[audioUrl] ?? audioUrl;
      playableUrlByAudioUrlRef.current[audioUrl] = playable;
      return playable;
    } catch {
      return audioUrl;
    }
  };

  const playSegment = (index: number): void => {
    const draft = drafts[index];
    const seg = draft?.segment;
    if (!seg?.audio_url) return;
    const audio = audioRef.current;
    if (!audio) return;
    void (async () => {
      const playable = await resolvePlayableUrl(seg.audio_url);
      if (audioRef.current !== audio) return;
      audio.src = playable;
      // TTS audio is generated at speech_rate and recordings are at their original speed: previews always play at 1x to avoid changing the speed twice
      audio.playbackRate = 1;
      setActiveSegmentIndex(index);
      try {
        await audio.play();
      } catch {
        setActiveSegmentIndex(null);
        setIsAudioPlaying(false);
      }
    })();
  };

  const toggleSegmentPlayback = (index: number): void => {
    if (activeSegmentIndex === index && isAudioPlaying) {
      stopPlayback();
      return;
    }
    playSegment(index);
  };

  const stopMediaStream = (): void => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    mediaChunksRef.current = [];
  };

  const stopRecording = async (discard = false): Promise<void> => {
    const recorder = mediaRecorderRef.current;
    const index = recordingIndex;
    // Rows may be deleted/reordered during upload: pin the draft id first and always write back by id
    const draftId = index != null ? (draftsRef.current[index]?.id ?? null) : null;
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        recorder.stop();
      });
    }
    const chunks = mediaChunksRef.current;
    const startedAt = recordStartedAtRef.current;
    const mimeType = chunks[0]?.type || recorder?.mimeType || "audio/webm";
    stopMediaStream();
    setRecordingIndex(null);
    if (discard || index == null || draftId == null || chunks.length === 0) {
      if (draftId != null) {
        const current = draftsRef.current.find((d) => d.id === draftId);
        if (current) {
          updateDraftById(draftId, { status: current.segment ? "success" : "pending" });
        }
      }
      return;
    }
    const durationSec = Math.max(0.2, (Date.now() - startedAt) / 1000);
    let blob = new Blob(chunks, { type: mimeType });
    const ext = recordingFileExtension(mimeType);
    if (ext === "webm") {
      blob = await fixRecordedWebmBlob(blob, durationSec);
    }
    updateDraftById(draftId, { status: "generating" });
    try {
      const file = new File([blob], `narration-record-${Date.now()}.${ext}`, {
        type: blob.type || mimeType,
      });
      const { asset } = await coursewareAssetsApi.uploadAsset(coursewareId, file, { language });
      const url = asset.url || "";
      if (!url.trim()) {
        throw new Error(t("coursewareEditor.narration.recordFailed"));
      }
      const signed = await coursewareAssetsApi.batchPresignUrls(coursewareId, [url]);
      const playable = signed[url] ?? url;
      playableUrlByAudioUrlRef.current[stripCoursewareAssetSignatureFromUrl(url)] = playable;
      let durationMs = Math.round(durationSec * 1000);
      const measured = await measureNarrationAudioDurationMs(playable);
      if (measured > 0) durationMs = measured;
      const current = draftsRef.current.find((d) => d.id === draftId);
      if (!current) return;
      const segment: NarrationSegment = {
        text: current.text,
        audio_url: stripCoursewareAssetSignatureFromUrl(url),
        duration_ms: Math.max(200, durationMs),
        gap_ms: index === 0 ? 0 : NARRATION_DEFAULT_GAP_MS,
        speech_rate: 1,
        source: "recording",
      };
      updateDraftById(draftId, {
        status: "success",
        segment,
        speechRate: 1,
        error: undefined,
        speedPanelOpen: false,
      });
    } catch (err) {
      updateDraftById(draftId, {
        status: "failed",
        error: err instanceof Error ? err.message : t("coursewareEditor.narration.recordFailed"),
      });
    }
  };

  const startRecording = async (index: number): Promise<void> => {
    if (recordingIndex != null) {
      await stopRecording(false);
    }
    stopPlayback();
    setAudioError(null);
    if (typeof MediaRecorder === "undefined") {
      setAudioError(t("coursewareEditor.narration.recordUnsupported"));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mimeType = pickRecordingMimeType();
      let recorder: MediaRecorder;
      try {
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
      } catch {
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        setAudioError(t("coursewareEditor.narration.recordUnsupported"));
        return;
      }
      mediaChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) mediaChunksRef.current.push(event.data);
      };
      mediaRecorderRef.current = recorder;
      recordStartedAtRef.current = Date.now();
      setRecordingIndex(index);
      updateDraft(index, { status: "recording", error: undefined, speedPanelOpen: false });
      recorder.start(200);
    } catch {
      setAudioError(t("coursewareEditor.narration.micDenied"));
      stopMediaStream();
      setRecordingIndex(null);
    }
  };

  useEffect(
    () => () => {
      stopPlayback();
      stopMediaStream();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const confirmedSegments = drafts
    .map((d) => d.segment)
    .filter((seg): seg is NarrationSegment => !!seg && !!seg.audio_url);

  const canSaveWithStaleTeacherOnly =
    teacherUnavailable &&
    !aiTeacher &&
    !!(
      existingNarrationForModal?.ai_teacher_id?.trim() ||
      narrationTeacherIdFromSlide?.trim() ||
      aiTeacherIdFromVtuber?.trim()
    );

  const canConfirm =
    confirmedSegments.length > 0 &&
    drafts.every((d) => {
      const isEmptyPlaceholder = !d.text.trim() && !d.segment;
      if (isEmptyPlaceholder) return true;
      return d.status === "success" && !!d.segment;
    }) &&
    !!selectedVtuber &&
    (!!aiTeacher || canSaveWithStaleTeacherOnly);

  const hasAssociatedAiTeacher =
    !!aiTeacher || !!aiTeacherIdForLoad || (teacherUnavailable && !!narrationTeacherIdFromSlide);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 dark:bg-slate-950/80 p-6">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <AudioLines className="h-4 w-4 text-violet-700 dark:text-violet-300" />
            {t("coursewareEditor.narration.modalTitle")}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200"
            aria-label={t("coursewareEditor.common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={segmentListScrollRef} className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
          {/* Narrator + voice */}
          <section className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-800/30 p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
              <span>{t("coursewareEditor.narration.currentNarrator")}</span>
              {isLoadingTeacher || isLoadingTts ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
              ) : null}
            </div>

            {vtubers.length === 0 && !aiTeacher ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {t("coursewareEditor.narration.pickNarratorRequired")}
                </p>
                <button
                  type="button"
                  className="self-start rounded border border-blue-400 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800 hover:bg-blue-100 dark:border-blue-500/50 dark:bg-blue-500/15 dark:text-blue-200"
                  onClick={handleOpenNarratorPick}
                >
                  {t("coursewareEditor.confirm.vtuberPickModalTitle")}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3 text-sm text-slate-900 dark:text-slate-100">
                {aiTeacher?.ai_teacher_avatar_url && !avatarLoadFailed ? (
                  <img
                    src={aiTeacher.ai_teacher_avatar_url}
                    alt={aiTeacher.ai_teacher_name}
                    className="h-8 w-8 rounded-full object-cover"
                    onError={() => setAvatarLoadFailed(true)}
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700">
                    <User className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                  </div>
                )}
                <div className="min-w-0 flex-1 truncate text-md font-bold">{narratorDisplayLabel}</div>
                {hasAssociatedAiTeacher ? (
                  <button
                    type="button"
                    className="rounded border border-blue-300 p-1.5 text-blue-700 hover:bg-blue-50 dark:border-blue-500/50 dark:text-blue-300 dark:hover:bg-blue-500/10"
                    onClick={handleOpenNarratorPick}
                    title={t("coursewareEditor.narration.switchNarrator")}
                    aria-label={t("coursewareEditor.narration.switchNarrator")}
                  >
                    <Shuffle className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            )}

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-[11px] text-slate-500">
                {t("coursewareEditor.narration.languageLabel")}
                <select
                  value={selectedLanguage}
                  // Selection is paused during a catalog refetch: an explicit choice made while fetching conflicts with the
                  // re-selection at completion (e.g. it slips out of the hidden voice additions), so it isn't committed until completion.
                  disabled={isLoadingTts}
                  onChange={(e) => {
                    // Switching language invalidates an explicit choice in another language (the first voice is chosen automatically).
                    // The language intent is kept, so an in-progress catalog refetch doesn't go back to the original language.
                    userPickedTtsIdRef.current = null;
                    userPickedLanguageRef.current = e.target.value;
                    setSelectedLanguage(e.target.value);
                  }}
                  className="rounded bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none ring-1 ring-slate-300 dark:ring-slate-700"
                >
                  {availableLanguages.map((lang) => (
                    <option key={lang || "__unknown__"} value={lang}>
                      {ttsLanguageLabel(
                        lang,
                        t("coursewareEditor.narration.languageUnknown"),
                        t,
                      )}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-slate-500">
                {t("coursewareEditor.narration.voiceLabel")}
                <select
                  value={selectedTtsId}
                  disabled={isLoadingTts}
                  onChange={(e) => {
                    userPickedTtsIdRef.current = e.target.value;
                    setSelectedTtsId(e.target.value);
                  }}
                  className="rounded bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none ring-1 ring-slate-300 dark:ring-slate-700"
                >
                  {voicesForLanguage.map((voice) => (
                    <option key={voice.tts_id} value={voice.tts_id}>
                      {voice.tts_name}
                    </option>
                  ))}
                </select>
              </label>
              {showTtsStyleSelect && (
                <>
                <label className="flex flex-col gap-1 text-[11px] text-slate-500">
                  {t("coursewareEditor.narration.styleLabel")}
                  <select
                    value={styleSelectValue}
                    onChange={(e) => {
                      setStyleSource("explicit");
                      styleDirtyRef.current = true;
                      if (e.target.value === CUSTOM_STYLE_VALUE) {
                        setCustomStyleMode(true);
                        setCustomStyleText("");
                        warnStyleChange(customStyleText);
                      } else {
                        setCustomStyleMode(false);
                        setCustomStyleText("");
                        setSelectedStyleKey(e.target.value);
                        warnStyleChange(e.target.value);
                      }
                    }}
                    className="rounded bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none ring-1 ring-slate-300 dark:ring-slate-700"
                  >
                    <option value="">
                      {stylePickerTexts.default}
                    </option>
                    <optgroup label={stylePickerTexts.recommended}>
                      {recommendedStyleOptions.map((style) => (
                        <option key={style.style_key} value={style.style_key}>
                          {style.label}
                        </option>
                      ))}
                    </optgroup>
                    <option value={CUSTOM_STYLE_VALUE}>
                      {stylePickerTexts.custom}
                    </option>
                  </select>
                </label>
                {showCustomStyleInput && (
                  <label className="flex flex-col gap-1 text-[11px] text-transparent select-none">
                    {"·"}
                    <input
                      value={customStyleText}
                      maxLength={200}
                      onChange={(e) => {
                        setStyleSource("explicit");
                        styleDirtyRef.current = true;
                        setCustomStyleText(e.target.value);
                        warnStyleChange(e.target.value);
                      }}
                      placeholder={t("coursewareEditor.narration.styleCustomPlaceholder")}
                      className="rounded bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 outline-none ring-1 ring-slate-300 dark:ring-slate-700"
                    />
                  </label>
                )}
                </>
              )}
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-[11px] text-slate-500">
                {t("coursewareEditor.common.narrationSubtitles")}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={subtitleVisible}
                aria-label={t("coursewareEditor.common.narrationSubtitles")}
                onClick={() => setSubtitleVisible((prev) => !prev)}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  subtitleVisible
                    ? "bg-blue-500"
                    : "bg-slate-300 dark:bg-slate-600"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                    subtitleVisible ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>

            {aiTeacherError ? (
              <div className="mt-2 rounded border border-amber-300/50 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-200">
                {aiTeacherError}
              </div>
            ) : null}
          </section>

          {/* Segments */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {t("coursewareEditor.narration.scriptSectionTitle")}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAddSegment}
                  className="flex items-center gap-1 rounded bg-blue-500/20 px-2.5 py-1 text-[11px] text-blue-800 hover:bg-blue-500/30 dark:text-blue-200"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("coursewareEditor.narration.addSegment")}
                </button>
                <span
                  className="inline-flex"
                  title={pronunciationDictDisabledReason}
                >
                  <button
                    type="button"
                    disabled={!supportsPronunciationDict}
                    onClick={() => setPronDictOpen(true)}
                    className={`flex items-center gap-1 rounded px-2.5 py-1 text-[11px] ${
                      supportsPronunciationDict
                        ? "bg-blue-500/20 text-blue-800 hover:bg-blue-500/30 dark:text-blue-200"
                        : "cursor-not-allowed bg-slate-100 text-slate-400 dark:bg-slate-800"
                    }`}
                  >
                    <BookType className="h-3.5 w-3.5" />
                    {t("coursewareEditor.narration.pronDict.title")}
                  </button>
                </span>
                <button
                  type="button"
                  disabled={isBatchGenerating || !aiTeacher || !voiceReady}
                  onClick={() => void handleRegenerateAll()}
                  className={`flex items-center gap-1 rounded px-2.5 py-1 text-[11px] ${
                    isBatchGenerating || !aiTeacher || !voiceReady
                      ? "cursor-not-allowed bg-slate-100 text-slate-400 dark:bg-slate-800"
                      : "bg-blue-500/20 text-blue-800 hover:bg-blue-500/30 dark:text-blue-200"
                  }`}
                >
                  {isBatchGenerating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <AudioLines className="h-3.5 w-3.5" />
                  )}
                  {t("coursewareEditor.narration.generateAudioRegenerateAll")}
                </button>
                <div className="text-[11px] text-slate-400">
                  {t("coursewareEditor.narration.segmentSummary", {
                    count: drafts.length,
                    duration: (totalAudioMs / 1000).toFixed(1),
                  })}
                </div>
              </div>
            </div>

            {audioError ? (
              <div className="rounded border border-rose-300/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-700 dark:text-rose-300">
                {audioError}
              </div>
            ) : null}

            <ul className="flex flex-col gap-3">
              {drafts.map((draft, index) => {
                const canPlay = !!draft.segment?.audio_url;
                const isActive = activeSegmentIndex === index && isAudioPlaying;
                const isRecording = recordingIndex === index;
                const isRecordingSource = draft.segment?.source === "recording";
                const isDragging = segmentDrag.from === index;
                // hoverTo = insert before this index (may equal drafts.length, meaning insert at the end)
                const showDropLineBefore =
                  segmentDrag.from >= 0 &&
                  segmentDrag.hoverTo === index &&
                  segmentDrag.from !== index &&
                  segmentDrag.from + 1 !== index;
                const showDropLineAfter =
                  segmentDrag.from >= 0 &&
                  segmentDrag.hoverTo === index + 1 &&
                  segmentDrag.from !== index &&
                  segmentDrag.from !== index + 1;
                return (
                  <li
                    key={draft.id}
                    onDragOver={(e) => {
                      if (!canDragReorderSegments) return;
                      if (segmentDrag.from < 0) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      const insertBefore = resolveSegmentDropInsertIndex(
                        index,
                        e.clientY,
                        e.currentTarget,
                      );
                      if (segmentDrag.hoverTo !== insertBefore) {
                        setSegmentDrag((d) => ({ ...d, hoverTo: insertBefore }));
                      }
                    }}
                    onDrop={(e) => {
                      if (!canDragReorderSegments) {
                        stopSegmentEdgeAutoScroll();
                        setSegmentDrag({ from: -1, hoverTo: null });
                        return;
                      }
                      e.preventDefault();
                      const from = Number(e.dataTransfer.getData("text/plain"));
                      const insertBefore = resolveSegmentDropInsertIndex(
                        index,
                        e.clientY,
                        e.currentTarget,
                      );
                      if (
                        Number.isFinite(from) &&
                        from !== insertBefore &&
                        from + 1 !== insertBefore
                      ) {
                        handleReorderSegment(from, insertBefore);
                      }
                      stopSegmentEdgeAutoScroll();
                      setSegmentDrag({ from: -1, hoverTo: null });
                    }}
                    onDragLeave={() => {
                      if (
                        segmentDrag.hoverTo === index ||
                        segmentDrag.hoverTo === index + 1
                      ) {
                        setSegmentDrag((d) => ({ ...d, hoverTo: null }));
                      }
                    }}
                    className={`relative rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3 ${
                      isDragging ? "opacity-40" : ""
                    }`}
                  >
                    {showDropLineBefore ? (
                      <span className="pointer-events-none absolute inset-x-2 -top-px h-0.5 rounded bg-blue-500 dark:bg-blue-400" />
                    ) : null}
                    {showDropLineAfter ? (
                      <span className="pointer-events-none absolute inset-x-2 -bottom-px h-0.5 rounded bg-blue-500 dark:bg-blue-400" />
                    ) : null}
                    <div className="flex items-start gap-2">
                      <span
                        draggable={canDragReorderSegments}
                        onDragStart={(e) => {
                          if (!canDragReorderSegments) {
                            e.preventDefault();
                            return;
                          }
                          e.dataTransfer.setData("text/plain", String(index));
                          e.dataTransfer.effectAllowed = "move";
                          segmentDragClientYRef.current = e.clientY;
                          setSegmentDrag({ from: index, hoverTo: index });
                        }}
                        onDragEnd={() => {
                          stopSegmentEdgeAutoScroll();
                          setSegmentDrag({ from: -1, hoverTo: null });
                        }}
                        className={`mt-1.5 flex shrink-0 items-center rounded p-1 ${
                          canDragReorderSegments
                            ? "cursor-grab text-slate-400 hover:bg-slate-200 hover:text-slate-700 active:cursor-grabbing dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                            : "cursor-not-allowed text-slate-300 dark:text-slate-600"
                        }`}
                        title={
                          canDragReorderSegments
                            ? t("coursewareEditor.narration.dragReorderSegment")
                            : recordingIndex != null
                              ? t("coursewareEditor.narration.dragReorderDisabledRecording")
                              : t("coursewareEditor.narration.dragReorderSegment")
                        }
                        aria-label={t("coursewareEditor.narration.dragReorderSegment")}
                      >
                        <GripVertical className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                    <textarea
                      ref={(el) => {
                        segmentTextareaRefs.current[draft.id] = el;
                        if (el) fitSegmentTextareaHeight(el);
                      }}
                      value={draft.text}
                      onChange={(e) => {
                        fitSegmentTextareaHeight(e.target);
                        updateDraft(index, {
                          text: e.target.value,
                          status:
                            draft.status === "success" && draft.segment
                              ? "pending"
                              : draft.status === "recording"
                                ? "recording"
                                : "pending",
                          segment:
                            draft.status === "success" ? null : draft.segment,
                        });
                      }}
                      rows={1}
                      placeholder={t("coursewareEditor.narration.segmentPlaceholder")}
                      className="w-full resize-none overflow-hidden rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-sm leading-5 text-slate-900 dark:text-slate-100 outline-none focus:border-blue-500"
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={!canPlay || draft.status === "generating"}
                          onClick={() => toggleSegmentPlayback(index)}
                          className="rounded p-1.5 text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700 disabled:opacity-40"
                          title={t("coursewareEditor.narration.playSegment")}
                        >
                          {isActive ? (
                            <Pause className="h-4 w-4" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={
                            isBatchGenerating ||
                            draft.status === "generating" ||
                            isRecording ||
                            !draft.text.trim() ||
                            !aiTeacher ||
                            !voiceReady
                          }
                          onClick={() => void regenerateSegment(draft.id)}
                          className="rounded p-1.5 text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700 disabled:opacity-40"
                          title={
                            isRecordingSource
                              ? t("coursewareEditor.narration.regenerateTtsFromRecording")
                              : t("coursewareEditor.narration.regenerateTts")
                          }
                        >
                          {draft.status === "generating" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RotateCw className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={isRecordingSource || isRecording}
                          onClick={() =>
                            updateDraft(index, { speedPanelOpen: !draft.speedPanelOpen })
                          }
                          className="rounded p-1.5 text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700 disabled:opacity-40"
                          title={
                            isRecordingSource
                              ? t("coursewareEditor.narration.speedDisabledForRecording")
                              : t("coursewareEditor.narration.speedLabel")
                          }
                        >
                          <Gauge className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          disabled={isBatchGenerating || draft.status === "generating"}
                          onClick={() =>
                            isRecording
                              ? void stopRecording(false)
                              : void startRecording(index)
                          }
                          className={`rounded p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 ${
                            isRecording
                              ? "text-rose-600 dark:text-rose-300"
                              : "text-slate-600 dark:text-slate-300"
                          }`}
                          title={
                            isRecording
                              ? t("coursewareEditor.narration.stopRecord")
                              : t("coursewareEditor.narration.startRecord")
                          }
                        >
                          {isRecording ? (
                            <Square className="h-4 w-4" />
                          ) : (
                            <Mic className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={isBatchGenerating || isRecording}
                          onClick={() => handleInsertSegmentAfter(index)}
                          className="rounded p-1.5 text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700 disabled:opacity-40"
                          title={t("coursewareEditor.narration.insertSegmentAfter")}
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          disabled={isBatchGenerating || isRecording}
                          onClick={() => handleDeleteSegment(index)}
                          className="rounded p-1.5 text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10 disabled:opacity-40"
                          title={t("coursewareEditor.narration.deleteSegment")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        {draft.segment
                          ? formatDurationSec(draft.segment.duration_ms, t)
                          : draft.status === "recording"
                            ? t("coursewareEditor.narration.recording")
                            : draft.status === "generating"
                              ? t("coursewareEditor.common.loading")
                              : t("coursewareEditor.narration.durationSeconds", {
                                  seconds: "0.0",
                                })}
                      </span>
                    </div>
                    {draft.speedPanelOpen && !isRecordingSource ? (
                      <div className="mt-2 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2">
                        <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                          <span>{t("coursewareEditor.narration.speedLabel")}</span>
                          <span>{draft.speechRate.toFixed(2)}x</span>
                        </div>
                        <input
                          type="range"
                          min={SPEED_MIN}
                          max={SPEED_MAX}
                          step={SPEED_STEP}
                          value={draft.speechRate}
                          onChange={(e) =>
                            updateDraft(index, {
                              speechRate: Number(e.target.value),
                              status: draft.segment ? "pending" : draft.status,
                              segment: null,
                            })
                          }
                          className="w-full"
                        />
                        <div className="mt-0.5 flex justify-between text-[10px] text-slate-400">
                          <span>{t("coursewareEditor.narration.speedSlow")}</span>
                          <span>{t("coursewareEditor.narration.speedNormal")}</span>
                          <span>{t("coursewareEditor.narration.speedFast")}</span>
                        </div>
                      </div>
                    ) : null}
                    {draft.error ? (
                      <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-300">
                        {draft.error}
                      </div>
                    ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            <button
              type="button"
              onClick={handleAddSegment}
              className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 px-3 py-3 text-xs text-slate-500 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-300"
            >
              <Plus className="h-4 w-4" />
              {t("coursewareEditor.narration.addSegment")}
            </button>
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {t("coursewareEditor.common.cancel")}
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => {
              if (!canConfirm || !selectedVtuber) return;
              const existing = findNarrationForModalPrefill(
                slide,
                initialNarrationElementId,
                selectedVtuber,
              );
              const next = buildNarrationElement({
                vtuber: selectedVtuber,
                aiTeacher,
                existing,
                slide,
                segments: confirmedSegments,
                ttsId: selectedTtsId,
                styleKey: effectiveStyleKey,
                speechRate: drafts[0]?.speechRate ?? aiTeacher?.ai_teacher_tts_speed ?? 1,
                unlinkStaleTeacher: teacherUnavailable && !aiTeacher,
                subtitleVisible,
                narrationName: (name) =>
                  t("coursewareEditor.meta.narrationElementName", { name }),
              });
              if (!next.ai_teacher_id.trim()) {
                setAudioError(t("coursewareEditor.narration.teacherNotReady"));
                return;
              }
              onConfirm(next);
            }}
            className={`rounded px-3 py-1.5 text-xs ${
              canConfirm
                ? "bg-blue-500 text-white hover:bg-blue-600"
                : "cursor-not-allowed bg-slate-200 dark:bg-slate-700 text-slate-400"
            }`}
          >
            {t("coursewareEditor.narration.confirmSave")}
          </button>
        </div>

        <audio
          ref={audioRef}
          hidden
          onPlay={() => setIsAudioPlaying(true)}
          onPause={() => setIsAudioPlaying(false)}
          onEnded={() => {
            setActiveSegmentIndex(null);
            setIsAudioPlaying(false);
          }}
        />
      </div>

      <NarrationPronunciationDictModal
        open={pronDictOpen}
        orgId={coursewareOrgId}
        defaultLanguage={selectedLanguage === "ja" ? "ja" : "zh"}
        allowedLanguages={isJaOnlyDictProvider ? ["ja"] : ["zh", "ja"]}
        coursewareId={coursewareId}
        aiTeacherId={aiTeacher?.ai_teacher_id ?? aiTeacherIdForLoad}
        ttsId={selectedTtsId || ""}
        onClose={() => setPronDictOpen(false)}
      />
    </div>
  );
}

export default NarrationModal;
