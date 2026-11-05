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
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
  type SetStateAction,
  type WheelEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  AtSign,
  ArrowUp,
  Bot,
  ChevronDown,
  Eraser,
  FileText,
  History,
  Loader2,
  OctagonPause,
  PenTool,
  PencilLine,
  Upload,
  LayoutTemplate,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import type { EditorThemeMode } from "../../lib/courseware-editor-theme.ts";
import { useI18nNew } from "../../hooks/useI18nNew.tsx";
import type { TranslationKey, SupportedLanguage } from "../../lib/i18n/index.ts";
import {
  EDITOR_AGENT_DEFAULT_SESSION_TITLE_KEY,
  isPlaceholderAgentSessionTitle,
  type EditorAiPanelMode,
} from "../../lib/editorAgentSessions.ts";
import { COURSEWARE_ASSET_ACCEPTED_EXTENSIONS, type CoursewareAssetItem } from "../../api/courseware.ts";
import coursewareAssetsApi from "../../api/courseware_assets.ts";
import { isCoursewareImageAsset } from "./CoursewareAssetLibraryPicker.tsx";
import {
  assistantPanelBubbleHasVisibleBody,
  CoursewareAiAssistantMessageBody,
} from "../courseware-ai-assistant/CoursewareAiAssistantMessageBody.tsx";
import {
  applyAssetMentionSelection,
  detectActiveAssetMention,
  filterAssetsForMentionQuery,
  formatAssetMentionDisplayToken,
  hasBracketAssetMentionTokens,
  getAlreadyMentionedAssetIdsInText,
  parseMentionedAssetsFromText,
  splitMentionSegmentsForDisplay,
} from "../../lib/courseware/ai-asset-mentions.ts";
import {
  fileWithSanitizedAssetName,
  sanitizeCoursewareAssetFileName,
} from "../../lib/courseware/sanitize-asset-filename.ts";
import {
  applyDesignTemplateMentionSelection,
  formatDesignTemplateMentionDisplayToken,
  hasBracketDesignTemplateMentionTokens,
  parseReferencedDesignTemplatesFromText,
  type ReferencedDesignTemplateItem,
} from "../../lib/courseware/ai-design-template-mentions.ts";
import {
  applyContentTemplateMentionSelection,
  formatContentTemplateMentionDisplayToken,
  hasBracketContentTemplateMentionTokens,
  parseReferencedContentTemplatesFromText,
  type ReferencedContentTemplateItem,
} from "../../lib/courseware/ai-content-template-mentions.ts";
import {
  readResourceMentionRecents,
  readTemplateMentionRecents,
  recordAssetMentionRecent,
  recordContentTemplateMentionRecent,
  recordCoursewareMentionRecent,
  recordDesignTemplateMentionRecent,
  type AiMentionRecentEntry,
} from "../../lib/courseware/ai-mention-recents.ts";
import {
  applyCoursewareMentionSelection,
  formatCoursewareMentionDisplayToken,
  mergeMentionLibrariesForDisplay,
  hasBracketCoursewareMentionTokens,
  parseReferencedCoursewareFromText,
  toReferencedCoursewareItem,
  type ReferencedCoursewareItem,
} from "../../lib/courseware/ai-courseware-mentions.ts";
import { invalidateCoursewareAssetsListCache } from "../../api/courseware_assets.ts";
import {
  buildChatInputWithManualMarks,
  buildManualMarkSession,
  formatAiPanelInputForDisplay,
  MANUAL_MARK_TOKEN_RE,
  manualMarkRegionsEqual,
  stripManualMarksFromChatInputText,
  hasAiPanelBracketTokens,
  resolveAiPanelMentionSource,
  splitAiPanelRichTextSegments,
  type AiPanelMentionSource,
  syncManualMarkRegionsFromChatInput,
  type AiPanelRichTextSegment,
  type CoursewareManualMarkPending,
  type CoursewareManualMarkRegion,
  type CoursewareManualMarkSession,
} from "../../lib/courseware/ai-manual-marks.ts";
import {
  COURSEWARE_AGENT_CHAT_MODEL_OPTIONS,
  readStoredCoursewareAgentChatModelId,
  resolveCoursewareAgentChatModel,
  writeStoredCoursewareAgentChatModelId,
  type CoursewareAgentChatModelId,
  type CoursewareAgentChatModelOption,
} from "../../lib/courseware/agent-chat-models.ts";
import {
  applyCoursewareAgentChatUiEvents,
  coursewareAiAssistantBlocksToPlainText,
  type CoursewareAgentChatUiEvent,
  type CoursewareAgentSelectedElement,
  type CoursewareAiAssistantBlock,
} from "../../api/courseware_agent.ts";
import {
  AI_CHAT_SCROLL_TOP_REVEAL_PX,
  getAiChatListWindowSlice,
  splitChatMessagesIntoRounds,
} from "../../lib/courseware/ai-chat-message-window.ts";
import { DeletePageConfirmBubble } from "./DeletePageConfirmBubble.tsx";
import { CoursewareManualMarkInputBubble } from "./CoursewareManualMarkInputBubble.tsx";
import {
  AiPanelHighlightComposer,
  type AiPanelComposerHandle,
} from "./AiPanelHighlightComposer.tsx";
import { CoursewareLibraryPickerModal } from "./CoursewareLibraryPickerModal.tsx";
import { DesignTemplatePickerModal } from "./DesignTemplatePickerModal.tsx";
import { ExtractDesignTemplateModal, CoursewareExtractableAssetPickerModal } from "./ExtractDesignTemplateModal.tsx";
import { ContentTemplatePickerModal } from "./ContentTemplatePickerModal.tsx";
import { ExtractContentTemplateModal } from "./ExtractContentTemplateModal.tsx";
import { AiPanelResourceBubble, AiPanelTemplateLibraryBubble } from "./AiPanelMentionBubbles.tsx";
import MarkdownRenderer from "../MarkdownRenderer.tsx";

import {
  buildPlanDraftHandoffMessage,
  extractPlanDesignBriefMarkdown,
  extractPlanDraftDisplayTitle,
  extractPlanDraftFromMessage,
} from "../../lib/courseware/plan-draft-handoff.ts";

export { buildPlanDraftHandoffMessage } from "../../lib/courseware/plan-draft-handoff.ts";

const COURSEWARE_REFS_SESSION_KEY_PREFIX = "courseware-editor-ai-courseware-refs:";
const DESIGN_TEMPLATE_REFS_SESSION_KEY_PREFIX = "courseware-editor-ai-design-template-refs:";
const CONTENT_TEMPLATE_REFS_SESSION_KEY_PREFIX = "courseware-editor-ai-content-template-refs:";

/** The parent can turn model/tool execution results into one readable note to show */
export type CoursewareAiActivityItem = { id: string; label: string };

/** Update the assistant bubble while streaming (called by the parent when wiring the Agent SSE) */
export type CoursewareAiSubmitHandles = {
  setAssistantContent: (text: string) => void;
  appendAssistantContent: (delta: string) => void;
  applyAssistantUiEvents: (events: CoursewareAgentChatUiEvent[]) => void;
};

export type CoursewareAiChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Structured blocks; when present they take priority over regex parsing of content */
  blocks?: CoursewareAiAssistantBlock[];
};

/** Agent conversation list item (assembled by the Island, displayed by the panel) */
export type CoursewareAgentSessionView = {
  id: string;
  title: string;
  isActive: boolean;
  messageCount: number;
  updatedAt: number;
};

function agentSessionLocale(language: SupportedLanguage): string {
  if (language === "zh") return "zh-CN";
  if (language === "ja") return "ja-JP";
  return "en-US";
}

function formatAgentSessionUpdatedAt(ts: number, language: SupportedLanguage): string {
  const d = new Date(ts);
  const now = new Date();
  const locale = agentSessionLocale(language);
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  if (d.toDateString() === now.toDateString()) return time;
  return d.toLocaleString(locale, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const CHAT_SCROLL_BOTTOM_THRESHOLD_PX = 80;
const SMOOTH_SCROLL_EASING = 0.24;

type SmoothScrollRunner = { raf: number };

/** Placeholder text of an empty conversation: a greeting by local hour */
function getCoursewareAiEmptyGreetingLine(
  t: (key: TranslationKey, variables?: Record<string, string | number>) => string,
): string {
  const hour = new Date().getHours();
  let key: TranslationKey;
  if (hour < 6) key = "coursewareEditor.aiPanel.greeting.dawn";
  else if (hour < 11) key = "coursewareEditor.aiPanel.greeting.morning";
  else if (hour < 13) key = "coursewareEditor.aiPanel.greeting.noon";
  else if (hour < 18) key = "coursewareEditor.aiPanel.greeting.afternoon";
  else key = "coursewareEditor.aiPanel.greeting.evening";
  return t(key);
}

function prefersReducedScrollMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function cancelSmoothScroll(state: SmoothScrollRunner, programmaticRef?: { current: boolean }): void {
  if (state.raf !== 0) {
    cancelAnimationFrame(state.raf);
    state.raf = 0;
  }
  if (programmaticRef) programmaticRef.current = false;
}

/** Exponentially eased stick-to-bottom; can be called repeatedly while streaming, and a running loop keeps chasing the latest bottom */
function smoothScrollTowardBottom(
  el: HTMLElement,
  state: SmoothScrollRunner,
  options?: { easing?: number; epsilon?: number; programmaticRef?: { current: boolean } },
): void {
  if (prefersReducedScrollMotion()) {
    cancelSmoothScroll(state, options?.programmaticRef);
    el.scrollTop = el.scrollHeight;
    return;
  }

  if (state.raf !== 0) return;

  const easing = options?.easing ?? SMOOTH_SCROLL_EASING;
  const epsilon = options?.epsilon ?? 0.75;
  const prog = options?.programmaticRef;

  const step = (): void => {
    if (prog) prog.current = true;
    const target = Math.max(0, el.scrollHeight - el.clientHeight);
    const gap = target - el.scrollTop;
    if (Math.abs(gap) <= epsilon) {
      el.scrollTop = target;
      state.raf = 0;
      if (prog) prog.current = false;
      return;
    }
    el.scrollTop += gap * easing;
    state.raf = requestAnimationFrame(step);
  };

  state.raf = requestAnimationFrame(step);
}

function isChatScrollNearBottom(scrollEl: HTMLElement, threshold = CHAT_SCROLL_BOTTOM_THRESHOLD_PX): boolean {
  return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight <= threshold;
}

function flushChatScrollToBottom(
  scrollEl: HTMLElement,
  anim: SmoothScrollRunner,
  programmaticRef?: { current: boolean },
): void {
  cancelSmoothScroll(anim, programmaticRef);
  scrollEl.scrollTop = scrollEl.scrollHeight;
}

/** After sending, the DOM / controlled parent may update a beat late, so stick to the bottom instantly over several frames */
function scheduleFlushChatScrollToBottom(
  getScrollEl: () => HTMLElement | null,
  anim: SmoothScrollRunner,
  programmaticRef?: { current: boolean },
): void {
  const tick = (): void => {
    const el = getScrollEl();
    if (el) flushChatScrollToBottom(el, anim, programmaticRef);
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

/** A single agent session reached its tool/turn limit (e.g. Claude's "Reached maximum number of turns") */
function isAgentMaxConversationTurnsLimitError(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  return (
    lower.includes("maximum number of turns") ||
    lower.includes("max conversation turns") ||
    /reached (?:the )?max(?:imum)? (?:number of )?turns?/.test(lower) ||
    (t.includes("对话") && t.includes("轮") && (t.includes("上限") || t.includes("达到最大") || t.includes("已达")))
  );
}

function assistantPlainTextForTurnsCheck(
  content: string,
  blocks: readonly CoursewareAiAssistantBlock[] | undefined,
): string {
  if (blocks?.length) return coursewareAiAssistantBlocksToPlainText(blocks);
  return content;
}

export type CoursewareEditorAiPanelProps = {
  coursewareId: string | null;
  /** Course id from the editor URL's section context (the "current course" tab of the courseware library) */
  sectionCourseId?: string | null;
  /** Organization id from the courseware or URL context (the "other courses" tab of the courseware library) */
  orgId?: string | null;
  themeMode: EditorThemeMode;
  className?: string;
  selectedSlideIndex: number;
  totalSlides: number;
  /** Elements currently selected on the canvas (multi-select supported); written into the prompt context when sent to the agent */
  selectedCanvasElements?: readonly CoursewareAgentSelectedElement[];
  /** element_id of the current page's slide */
  currentSlideId?: string | null;
  getCurrentSlideJson: () => string;
  onAddSlide: () => void;
  onDeleteCurrentSlide: () => void;
  /**
   * Callback when the user sends: includes the current page context and the serialized current page data, so one channel serves both "Q&A" and "editing the courseware".
   * The parent wires the Agent API and persists the conversation fields; when `chatMessages` + `onChatMessagesChange` are passed too, the parent persists the sidebar conversation list (recommended).
   */
  onSubmitMessage?: (
    args: {
      text: string;
      slideJson: string;
      pageIndex: number;
      totalPages: number;
      currentSlideId?: string | null;
      selectedElements: readonly CoursewareAgentSelectedElement[];
      referencedAssets: CoursewareAssetItem[];
      referencedCourseware: ReferencedCoursewareItem[];
      referencedDesignTemplates: ReferencedDesignTemplateItem[];
      referencedContentTemplates: ReferencedContentTemplateItem[];
      /** Regions the user marked by hand (coordinates in the element model's logical pixels); merged into the Agent editorContext */
      manualMarkSession?: CoursewareManualMarkSession | null;
      /** Created by the panel and passed in; the parent issues the request with its `signal`, and the panel calls `abort()` when the user clicks "stop" */
      abortController: AbortController;
      /** Agent LLM model (see `COURSEWARE_AGENT_CHAT_MODEL_OPTIONS`) */
      agentModel: string;
      /** Current panel mode: `agent` (edit the courseware) or `plan` (courseware design planning) */
      mode: EditorAiPanelMode;
    },
    handles: CoursewareAiSubmitHandles,
  ) => void | Promise<void>;
  /** Current panel mode: `agent` or `plan` (managed and persisted by the Island) */
  panelMode?: EditorAiPanelMode;
  /** Switch between Agent / Plan mode */
  onPanelModeChange?: (mode: EditorAiPanelMode) => void;
  /** Plan mode "start building": hand the latest design draft to the Agent (the Island switches mode + creates a conversation + triggers the automatic send) */
  onStartMakingWithDraft?: (draft: string) => void;
  /** Handoff token: the Island writes draft + token after switching to Agent mode and creating a conversation; the panel sends once automatically */
  pendingDraftHandoff?: { token: number; draft: string } | null;
  /** Callback after the draft is sent automatically, so the Island clears pendingDraftHandoff */
  onDraftHandoffConsumed?: () => void;
  /** When passed by the parent, a summary of recent actions shows above the conversation area (optional) */
  activityItems?: readonly CoursewareAiActivityItem[];
  /** Passed when the parent controls the "assistant is replying" state, merged with the internal sending state */
  isAssistantBusy?: boolean;
  /** The parent is fetching history from the server */
  isHistoryLoading?: boolean;
  /** Passed together with `onChatMessagesChange` for controlled mode, so the parent can write localStorage etc. and restore after a refresh */
  chatMessages?: CoursewareAiChatMessage[];
  onChatMessagesChange?: (messages: CoursewareAiChatMessage[] | ((prev: CoursewareAiChatMessage[]) => CoursewareAiChatMessage[])) => void;
  /** Clear the current conversation's messages; without it the "reset" button isn't shown */
  onClearHistory?: () => void | Promise<void>;
  /** Current Agent conversation title (the default "new conversation" is passed by the Island) */
  sessionTitle?: string;
  /** Agent conversation list of this courseware (local multi-conversation; the server has no list API yet) */
  agentSessions?: readonly CoursewareAgentSessionView[];
  onAgentSessionSelect?: (sessionId: string) => void;
  onAgentSessionCreate?: () => void;
  /** Callback when an Agent streaming request ends (not stopped by the user), for desktop notifications etc. */
  onAssistantStreamEnd?: (reason: "completed" | "aborted") => void;
  /** true while an Agent send/stream/recovery subscription is in progress, letting the editor decide whether leaving needs no confirmation */
  onAgentWorkingChange?: (working: boolean) => void;
  /**
   * When a new Agent turn starts with elements selected at send time: freeze those element_ids until the turn ends;
   * passing an empty array unfreezes.
   */
  onAgentChatFrozenElementIdsChange?: (elementIds: readonly string[]) => void;
  /** Inline manual marking mode on the canvas */
  manualMarkModeActive?: boolean;
  onManualMarkModeToggle?: () => void;
  /** Called after sending or when the parent needs to reset the canvas marks */
  onClearManualMarks?: () => void;
  manualMarkRegions?: readonly CoursewareManualMarkRegion[];
  onManualMarkRegionsChange?: (regions: CoursewareManualMarkRegion[]) => void;
  pendingManualMark?: CoursewareManualMarkPending | null;
  onConfirmPendingManualMark?: (description: string) => void;
  onCancelPendingManualMark?: () => void;
  /** Current playhead (ms), for the mark coordinate context in editorContext */
  manualMarkPlayheadMs?: number;
  /** Agent `AskUserQuestion` option submission (paired with the stream in progress) */
  onSubmitAgentUserQuestion?: (args: {
    requestId: string;
    answers: Record<string, string>;
  }) => void | Promise<void>;
  /** Current page slide_id */
  manualMarkSlideId?: string | null;
  /** Assets uploaded to the asset library / canvas, merged into the resource list for @ mentions (subscription registered by the editor root) */
  uploadedAssetsRegistry?: {
    register: (handler: (assets: CoursewareAssetItem[]) => void) => () => void;
  };
  /**
   * After a refresh, if a local unfinished `chatStreamSessionId` remains, the Island passes it after loading the conversation;
   * the panel enters the "recovering stream" state and calls `onRecoverAgentStream` (GET `/chat/stream` only).
   */
  agentStreamRecovery?: {
    chatStreamSessionId: string;
    livePreviewSessionId?: string;
    from?: string;
  } | null;
  onRecoverAgentStream?: (
    args: {
      chatStreamSessionId: string;
      livePreviewSessionId?: string;
      from?: string;
      abortController: AbortController;
    },
    handles: CoursewareAiSubmitHandles,
  ) => void | Promise<void>;
  /** Called by the panel when the recovery subscription ends or is abandoned, so the Island can clear `agentStreamRecovery` */
  onAgentStreamRecoverySettled?: () => void;
};

const AiPanelChatMessageRow = memo(function AiPanelChatMessageRow({
  message,
  isLastInFullList,
  assistantStreamInFlight,
  busy,
  libraryAssets,
  onSubmitAgentUserQuestion,
  onContinueMaxTurns,
  onClearHistory,
  showStartMaking = false,
  onStartMaking,
  onOpenDraft,
}: {
  message: CoursewareAiChatMessage;
  isLastInFullList: boolean;
  assistantStreamInFlight: boolean;
  busy: boolean;
  libraryAssets: readonly CoursewareAssetItem[];
  onSubmitAgentUserQuestion?: (args: {
    requestId: string;
    answers: Record<string, string>;
  }) => void | Promise<void>;
  onContinueMaxTurns: () => void;
  onClearHistory?: () => void | Promise<void>;
  /** Plan mode: show the "start building" button at the bottom of this assistant message (the design draft) */
  showStartMaking?: boolean;
  onStartMaking?: () => void;
  /** When the user message is a handoff draft, clicking the card shows the draft markdown in a modal */
  onOpenDraft?: (draft: string) => void;
}) {
  const { t } = useI18nNew();
  if (message.role === "assistant" && !assistantPanelBubbleHasVisibleBody(message.content, message.blocks)) {
    return null;
  }

  const assistantPlain = assistantPlainTextForTurnsCheck(message.content, message.blocks);
  const showMaxTurnsContinue =
    message.role === "assistant" &&
    isLastInFullList &&
    !busy &&
    isAgentMaxConversationTurnsLimitError(assistantPlain);

  const draftHandoff = message.role === "user" ? extractPlanDraftFromMessage(message.content) : null;

  return (
    <li
      className={`courseware-editor-ai-msg-item flex w-full min-w-0 ${
        message.role === "user" ? "justify-end" : "justify-start"
      }`}
    >
      {message.role === "user" ? (
        draftHandoff ? (
          <PlanDraftHandoffCard draft={draftHandoff} onOpen={onOpenDraft} />
        ) : (
          <AiPanelMessageBubble
            role={message.role}
            content={message.content}
            blocks={message.blocks}
            libraryAssets={libraryAssets}
            isLive={assistantStreamInFlight}
          />
        )
      ) : (
        <div className="flex w-full min-w-0 flex-col gap-1.5">
          <AiPanelMessageBubble
            role={message.role}
            content={message.content}
            blocks={message.blocks}
            libraryAssets={libraryAssets}
            isLive={assistantStreamInFlight}
            onSubmitAgentUserQuestion={onSubmitAgentUserQuestion}
            onResetAgentContext={onClearHistory}
            showStartMaking={showStartMaking}
            onStartMaking={onStartMaking}
            startMakingDisabled={busy}
          />
          {showMaxTurnsContinue ? (
            <button
              type="button"
              disabled={busy}
              onClick={onContinueMaxTurns}
              className="self-start rounded-lg border border-slate-400 dark:border-slate-600/90 bg-slate-100/90 dark:bg-slate-800/60 px-3 py-1.5 text-[11px] font-medium text-slate-800 dark:text-slate-200 shadow-sm transition hover:border-violet-400/55 dark:hover:border-violet-500/50 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("coursewareEditor.aiPanel.continueWork")}
            </button>
          ) : null}
        </div>
      )}
    </li>
  );
});

/** Plan → Agent handoff: render the user message as a clickable "design draft" card instead of the whole text. */
const PlanDraftHandoffCard = memo(function PlanDraftHandoffCard({
  draft,
  onOpen,
}: {
  draft: string;
  onOpen?: (draft: string) => void;
}) {
  const { t } = useI18nNew();
  const brief = useMemo(() => extractPlanDesignBriefMarkdown(draft), [draft]);
  const title =
    extractPlanDraftDisplayTitle(brief) || t("coursewareEditor.aiPanel.plan.draftCardTitle");
  return (
    <button
      type="button"
      onClick={() => onOpen?.(brief)}
      className="group flex max-w-[92%] items-start gap-2.5 rounded-2xl border border-violet-400/60 bg-violet-600/90 px-3 py-2.5 text-left text-white shadow-sm transition hover:bg-violet-600"
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15">
        <FileText className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 py-0.5">
        <span className="block text-[10px] font-medium uppercase tracking-wide text-white/70">
          {t("coursewareEditor.aiPanel.plan.draftCardBadge")}
        </span>
        <span className="line-clamp-2 text-[12px] font-semibold leading-snug wrap-anywhere">
          {title}
        </span>
      </span>
    </button>
  );
});

/** Design draft markdown detail dialog */
const PlanDraftModal = memo(function PlanDraftModal({
  draft,
  onClose,
}: {
  draft: string;
  onClose: () => void;
}) {
  const { t } = useI18nNew();
  const brief = useMemo(() => extractPlanDesignBriefMarkdown(draft), [draft]);
  const modalTitle =
    extractPlanDraftDisplayTitle(brief) || t("coursewareEditor.aiPanel.plan.draftModalTitle");
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-80 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700/80">
          <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <FileText className="h-4 w-4 text-violet-600 dark:text-violet-300" aria-hidden />
            <span className="text-sm font-semibold">{modalTitle}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("coursewareEditor.aiPanel.plan.draftModalClose")}
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <MarkdownRenderer content={brief} className="text-[13px] leading-relaxed" />
        </div>
      </div>
    </div>,
    document.body,
  );
});


const AiPanelMessageBubble = memo(function AiPanelMessageBubble({
  role,
  content,
  blocks,
  libraryAssets = [],
  isLive = false,
  onSubmitAgentUserQuestion,
  onResetAgentContext,
  showStartMaking = false,
  onStartMaking,
  startMakingDisabled = false,
}: {
  role: "user" | "assistant";
  content: string;
  blocks?: CoursewareAiAssistantBlock[];
  libraryAssets?: readonly CoursewareAssetItem[];
  /** The assistant streaming request is still in progress in this panel (for the action title shimmer etc.) */
  isLive?: boolean;
  onSubmitAgentUserQuestion?: (args: {
    requestId: string;
    answers: Record<string, string>;
  }) => void | Promise<void>;
  onResetAgentContext?: () => void | Promise<void>;
  /** Plan mode: show the "start building" button at the bottom of the assistant bubble */
  showStartMaking?: boolean;
  onStartMaking?: () => void;
  startMakingDisabled?: boolean;
}) {
  const { t } = useI18nNew();
  const [startMakingConfirming, setStartMakingConfirming] = useState(false);
  useEffect(() => {
    if (!showStartMaking) setStartMakingConfirming(false);
  }, [showStartMaking]);
  return (
    <div
      className={`min-w-0 rounded-2xl px-3 py-2 text-[12px] leading-relaxed ${
        role === "user"
          ? "max-w-[92%] bg-violet-600/85 text-white shadow-sm"
          : "w-full border border-slate-300 dark:border-slate-700/80 bg-white dark:bg-slate-800/70 text-slate-100"
      }`}
    >
      {role === "assistant" ? (
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-violet-700 dark:text-violet-200">
          <Bot className="h-3 w-3 shrink-0" aria-hidden />
          {t("coursewareEditor.aiPanel.assistantName")}
        </div>
      ) : null}
      {role === "assistant" ? (
        <CoursewareAiAssistantMessageBody
          content={content}
          blocks={blocks}
          isLive={isLive}
          onSubmitAgentUserQuestion={onSubmitAgentUserQuestion}
          onResetAgentContext={onResetAgentContext}
        />
      ) : (
        <p className="wrap-anywhere whitespace-pre-wrap">
          <AiPanelInputRichText
            text={content}
            variant="user-bubble"
            libraryAssets={libraryAssets}
          />
        </p>
      )}
      {role === "assistant" && showStartMaking && onStartMaking ? (
        <div className="mt-2 flex flex-col items-end gap-1.5 border-t border-slate-200 pt-2 dark:border-slate-700/70">
          {startMakingConfirming ? (
            <div className="w-full rounded-lg border border-blue-400/45 bg-blue-500/10 px-2.5 py-2 dark:border-blue-500/45 dark:bg-blue-500/10">
              <div className="mb-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                {t("coursewareEditor.aiPanel.plan.confirmQuestion")}
              </div>
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setStartMakingConfirming(false)}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {t("coursewareEditor.aiPanel.plan.confirmCancel")}
                </button>
                <button
                  type="button"
                  disabled={startMakingDisabled}
                  onClick={() => {
                    setStartMakingConfirming(false);
                    onStartMaking();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-bold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <PenTool className="h-3 w-3" aria-hidden />
                  {t("coursewareEditor.aiPanel.plan.confirmOk")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={startMakingDisabled}
              onClick={() => setStartMakingConfirming(true)}
              title={t("coursewareEditor.aiPanel.plan.startMakingHint")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-400/50 bg-blue-500/10 px-2.5 py-1 text-[11px] font-bold text-blue-700 transition hover:border-blue-500/60 hover:bg-blue-500/15 dark:border-blue-500/50 dark:bg-blue-500/15 dark:text-blue-300 dark:hover:bg-blue-500/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <PenTool className="h-3 w-3" aria-hidden />
              {t("coursewareEditor.aiPanel.plan.startMaking")}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
});

const ATTACH_ACCEPT = COURSEWARE_ASSET_ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(",");

function attachmentFileExtension(file: File): string {
  const n = file.name;
  const dot = n.lastIndexOf(".");
  const fromName = dot >= 0 ? n.slice(dot + 1).toLowerCase() : "";
  if (fromName && isAttachmentExtensionAccepted(fromName)) return fromName;
  return mimeTypeToAttachmentExtension(file.type);
}

function mimeTypeToAttachmentExtension(mime: string): string {
  const base = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
    "image/svg+xml": "svg",
    "image/tiff": "tiff",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/aac": "aac",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/x-wav": "wav",
    "audio/ogg": "ogg",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "text/markdown": "md",
    "text/html": "html",
  };
  const ext = map[base] ?? "";
  return ext && isAttachmentExtensionAccepted(ext) ? ext : "";
}

function isAttachmentExtensionAccepted(ext: string): boolean {
  return (COURSEWARE_ASSET_ACCEPTED_EXTENSIONS as readonly string[]).includes(ext);
}

function fileForAttachmentUpload(file: File, ext: string): File {
  const n = file.name.trim();
  if (n && n.includes(".") && attachmentFileExtension(file) === ext) {
    return fileWithSanitizedAssetName(file);
  }
  const safeExt = ext.toLowerCase();
  const base = n && n.includes(".") ? n.slice(0, n.lastIndexOf(".")) : n || "pasted";
  const nextName = sanitizeCoursewareAssetFileName(`${base}.${safeExt}`);
  return new File([file], nextName, { type: file.type, lastModified: file.lastModified });
}

function getFilesFromDataTransfer(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  const direct = Array.from(dt.files);
  if (direct.length > 0) return direct;
  const fromItems: File[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind === "file") {
      const f = item.getAsFile();
      if (f) fromItems.push(f);
    }
  }
  return fromItems;
}

function dataTransferHasFiles(dt: DataTransfer | null | undefined): boolean {
  if (Array.from(dt?.types ?? []).includes("Files")) return true;
  return getFilesFromDataTransfer(dt).length > 0;
}

const MENTION_CHIP_CLASS_BY_SOURCE: Record<
  AiPanelMentionSource,
  Record<"input" | "user-bubble", string>
> = {
  /** Asset library file; the input variant forbids padding/font size changes, otherwise character widths drift from the textarea */
  asset: {
    input: "rounded-sm bg-violet-500/35 text-inherit",
    "user-bubble": "rounded-md bg-white/25 px-1 py-px font-semibold text-white",
  },
  /** Reference courseware */
  courseware: {
    input: "rounded-sm bg-sky-500/35 text-inherit",
    "user-bubble": "rounded-md bg-sky-300/30 px-1 py-px font-semibold text-sky-50",
  },
  /** Design template */
  design_template: {
    input: "rounded-sm bg-amber-500/35 text-inherit",
    "user-bubble": "rounded-md bg-amber-300/30 px-1 py-px font-semibold text-amber-50",
  },
  /** Content template */
  content_template: {
    input: "rounded-sm bg-emerald-500/35 text-inherit",
    "user-bubble": "rounded-md bg-emerald-300/30 px-1 py-px font-semibold text-emerald-50",
  },
};

const MANUAL_MARK_CHIP_CLASS = {
  input: "inline rounded-sm bg-rose-500/30 text-inherit",
  "user-bubble": "inline rounded-md bg-rose-500/35 px-1 py-px font-semibold text-rose-50",
} as const;

const AiPanelInputRichText = memo(function AiPanelInputRichText({
  text,
  variant,
  libraryAssets = [],
}: {
  text: string;
  variant: "input" | "user-bubble";
  libraryAssets?: readonly CoursewareAssetItem[];
}) {
  const { t } = useI18nNew();
  const libraryById = useMemo(
    () => new Map(libraryAssets.map((item) => [item.id, item])),
    [libraryAssets],
  );
  const segments = useMemo(() => {
    if (hasAiPanelBracketTokens(text)) {
      return splitAiPanelRichTextSegments(text);
    }
    return splitMentionSegmentsForDisplay(text, libraryAssets).map(
      (seg): AiPanelRichTextSegment => {
        if (seg.kind === "text") return { kind: "text", value: seg.value };
        const libraryItem = libraryById.get(seg.id);
        return {
          kind: "assetMention",
          name: seg.name,
          id: seg.id,
          raw: seg.raw,
          mentionSource: libraryItem
            ? resolveAiPanelMentionSource(libraryItem)
            : "asset",
        };
      },
    );
  }, [libraryAssets, libraryById, text]);
  return (
    <>
      {segments.map((seg: AiPanelRichTextSegment, index) => {
        if (seg.kind === "text") {
          return <span key={`t-${index}`}>{seg.value}</span>;
        }
        if (seg.kind === "manualMark") {
          // The input must render the same characters as the textarea value; i18n text is only for the bubble display
          const label =
            variant === "input"
              ? seg.raw || `标记${seg.index}:${seg.description}`
              : t("coursewareEditor.aiPanel.markChip", {
                  index: seg.index,
                  description: seg.description,
                });
          return (
            <span key={`mk-${index}`} className={MANUAL_MARK_CHIP_CLASS[variant]}>
              {label}
            </span>
          );
        }
        return (
          <span
            key={`m-${index}`}
            className={MENTION_CHIP_CLASS_BY_SOURCE[seg.mentionSource][variant]}
          >
            {variant === "input" ? seg.raw || `@${seg.name}` : `@${seg.name}`}
          </span>
        );
      })}
    </>
  );
});

const MENTION_IMAGE_PREVIEW_GAP_PX = 8;
const MENTION_IMAGE_PREVIEW_VIEWPORT_PAD = 8;
const MENTION_IMAGE_PREVIEW_EST_HEIGHT_PX = 200;

type MentionImagePreviewCoords = {
  top: number;
  left: number;
  transform: string;
};

function computeMentionImagePreviewCoords(anchorRect: DOMRect): MentionImagePreviewCoords {
  const estW = 200;
  const pad = MENTION_IMAGE_PREVIEW_VIEWPORT_PAD;
  const gap = MENTION_IMAGE_PREVIEW_GAP_PX;
  const preferRight = anchorRect.right + gap + estW <= window.innerWidth - pad;
  const top = Math.min(
    window.innerHeight - pad - MENTION_IMAGE_PREVIEW_EST_HEIGHT_PX / 2,
    Math.max(pad + MENTION_IMAGE_PREVIEW_EST_HEIGHT_PX / 2, anchorRect.top + anchorRect.height / 2),
  );
  if (preferRight) {
    return { top, left: anchorRect.right + gap, transform: "translateY(-50%)" };
  }
  return {
    top,
    left: anchorRect.left - gap,
    transform: "translate(-100%, -50%)",
  };
}

/** @ resource list: image items show a preview beside them on hover / keyboard highlight (a portal so the list's overflow doesn't clip it) */
const MentionImagePreviewBubble = memo(function MentionImagePreviewBubble({
  asset,
  coords,
  themeMode,
}: {
  asset: CoursewareAssetItem;
  coords: MentionImagePreviewCoords;
  themeMode: EditorThemeMode;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      data-courseware-editor-theme={themeMode}
      role="presentation"
      className="pointer-events-none fixed z-10000 w-[min(200px,calc(100vw-16px))] rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-1.5 shadow-2xl"
      style={{ top: coords.top, left: coords.left, transform: coords.transform }}
    >
      <img
        src={asset.url}
        alt=""
        className="mx-auto block max-h-40 w-auto max-w-full rounded object-contain"
        draggable={false}
        loading="lazy"
      />
      <p className="mt-1 truncate px-0.5 text-center text-[10px] text-slate-600 dark:text-slate-400">
        {asset.name}
      </p>
    </div>,
    document.body,
  );
});

const AiPanelModelSelector = memo(function AiPanelModelSelector({
  themeMode,
  value,
  disabled,
  onChange,
}: {
  themeMode: EditorThemeMode;
  value: CoursewareAgentChatModelOption;
  disabled?: boolean;
  onChange: (id: CoursewareAgentChatModelId) => void;
}) {
  const { t } = useI18nNew();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const updateMenuPos = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setMenuPos({
      top: rect.top - 6,
      left: rect.left,
    });
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    updateMenuPos();
    setOpen(true);
  }, [disabled, updateMenuPos]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    setMenuPos(null);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPos();
    const onReposition = () => updateMenuPos();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, updateMenuPos]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeMenu, open]);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        className="group inline-flex max-w-[min(100%,200px)] items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={t("coursewareEditor.aiPanel.footer.modelAria")}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="truncate font-medium text-slate-700 transition-colors group-hover:text-slate-900 dark:text-slate-200 dark:group-hover:text-white">
          {value.label}
        </span>
        {value.subtitle ? (
          <span className="truncate text-slate-400 transition-colors group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300">
            {value.subtitle}
          </span>
        ) : null}
        <ChevronDown
          className={`ml-0.5 h-3 w-3 shrink-0 text-slate-400 transition group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300 ${open ? "rotate-180" : ""}`}
          strokeWidth={2.25}
          aria-hidden
        />
      </button>
      {open && menuPos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              data-courseware-editor-theme={themeMode}
              role="listbox"
              aria-label={t("coursewareEditor.aiPanel.footer.modelListAria")}
              className="fixed z-9999 min-w-[168px] max-w-[min(92vw,240px)] overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 py-1 shadow-2xl"
              style={{
                top: Math.max(8, menuPos.top),
                left: Math.max(8, Math.min(menuPos.left, window.innerWidth - 248)),
                transform: "translateY(-100%)",
              }}
            >
              {COURSEWARE_AGENT_CHAT_MODEL_OPTIONS.filter((option) => !option.hidden).map((option) => {
                const selected = option.id === value.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      onChange(option.id);
                      closeMenu();
                    }}
                    className={`group/opt flex w-full items-center gap-1 px-3 py-2 text-left text-xs transition ${
                      selected
                        ? "bg-violet-500/10 text-slate-900 dark:text-slate-100"
                        : "text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                    }`}
                  >
                    <span className="font-medium">{option.label}</span>
                    {option.subtitle ? (
                      <span
                        className={`text-slate-400 transition-colors dark:text-slate-500 ${
                          selected
                            ? ""
                            : "group-hover/opt:text-slate-600 dark:group-hover/opt:text-slate-300"
                        }`}
                      >
                        {option.subtitle}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
});

const FOOTER_ICON_TOOLTIP_GAP_PX = 6;
const FOOTER_ICON_TOOLTIP_VIEWPORT_PAD = 8;

/** Bottom toolbar icons: show a description above the button on hover / keyboard focus (a portal so the sidebar's overflow doesn't clip it) */
const AiPanelFooterIconTooltip = memo(function AiPanelFooterIconTooltip({
  label,
  themeMode,
  children,
}: {
  label: string;
  themeMode: EditorThemeMode;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const updateCoords = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    let left = rect.left + rect.width / 2;
    const tooltip = tooltipRef.current;
    if (tooltip) {
      const halfW = tooltip.offsetWidth / 2;
      left = Math.min(
        window.innerWidth - FOOTER_ICON_TOOLTIP_VIEWPORT_PAD - halfW,
        Math.max(FOOTER_ICON_TOOLTIP_VIEWPORT_PAD + halfW, left),
      );
    }
    setCoords({
      top: rect.top - FOOTER_ICON_TOOLTIP_GAP_PX,
      left,
    });
  }, []);

  const openTooltip = useCallback(() => {
    const anchor = anchorRef.current;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      setCoords({
        top: rect.top - FOOTER_ICON_TOOLTIP_GAP_PX,
        left: rect.left + rect.width / 2,
      });
    }
    setOpen(true);
  }, []);

  const closeTooltip = useCallback(() => {
    setOpen(false);
    setCoords(null);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateCoords();
    const onReposition = () => updateCoords();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, updateCoords, label]);

  return (
    <span
      ref={anchorRef}
      className="relative inline-flex shrink-0"
      onMouseEnter={openTooltip}
      onMouseLeave={closeTooltip}
      onFocusCapture={openTooltip}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          closeTooltip();
        }
      }}
    >
      {children}
      {open && coords && typeof document !== "undefined"
        ? createPortal(
            <span
              ref={tooltipRef}
              role="tooltip"
              data-courseware-editor-theme={themeMode}
              className="pointer-events-none fixed z-9999 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-slate-400 dark:border-slate-600/90 bg-white/95 dark:bg-slate-900/95 px-2 py-1 text-[10px] font-medium text-slate-900 dark:text-slate-100 shadow-md shadow-slate-900/10 dark:shadow-black/25"
              style={{ top: coords.top, left: coords.left }}
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
});

export function CoursewareEditorAiPanel({
  coursewareId,
  sectionCourseId = null,
  orgId = null,
  themeMode,
  className = "",
  selectedSlideIndex,
  totalSlides,
  selectedCanvasElements = [],
  currentSlideId = null,
  getCurrentSlideJson,
  onAddSlide,
  onDeleteCurrentSlide,
  onSubmitMessage,
  onAssistantStreamEnd,
  onAgentWorkingChange,
  onAgentChatFrozenElementIdsChange,
  activityItems,
  isAssistantBusy = false,
  isHistoryLoading = false,
  chatMessages: chatMessagesProp,
  onChatMessagesChange,
  onClearHistory,
  sessionTitle,
  agentSessions = [],
  onAgentSessionSelect,
  onAgentSessionCreate,
  onSubmitAgentUserQuestion,
  agentStreamRecovery = null,
  onRecoverAgentStream,
  onAgentStreamRecoverySettled,
  manualMarkModeActive = false,
  onManualMarkModeToggle,
  onClearManualMarks,
  manualMarkRegions = [],
  onManualMarkRegionsChange,
  pendingManualMark = null,
  onConfirmPendingManualMark,
  onCancelPendingManualMark,
  manualMarkPlayheadMs = 0,
  manualMarkSlideId = null,
  uploadedAssetsRegistry,
  panelMode = "agent",
  onPanelModeChange,
  onStartMakingWithDraft,
  pendingDraftHandoff = null,
  onDraftHandoffConsumed,
}: CoursewareEditorAiPanelProps) {
  const { t, language } = useI18nNew();
  const isPlanMode = panelMode === "plan";
  const [chatInput, setChatInput] = useState("");
  const [isClearing, setIsClearing] = useState(false);
  const [agentModelId, setAgentModelId] = useState<CoursewareAgentChatModelId>(() =>
    readStoredCoursewareAgentChatModelId(),
  );
  const selectedAgentModel = useMemo(
    () => resolveCoursewareAgentChatModel(agentModelId),
    [agentModelId],
  );
  const agentModelRef = useRef(selectedAgentModel.apiModel);
  agentModelRef.current = selectedAgentModel.apiModel;
  const panelModeRef = useRef(panelMode);
  panelModeRef.current = panelMode;
  const consumedHandoffTokenRef = useRef(0);
  /** Markdown content of the handoff draft detail dialog (null means closed) */
  const [draftModalContent, setDraftModalContent] = useState<string | null>(null);
  const [internalMessages, setInternalMessages] = useState<CoursewareAiChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isAttaching, setIsAttaching] = useState(false);
  const [isFileDragOverAgent, setIsFileDragOverAgent] = useState(false);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const historyMenuWrapRef = useRef<HTMLDivElement>(null);
  const [libraryAssets, setLibraryAssets] = useState<CoursewareAssetItem[]>([]);
  const [, setLibraryLoading] = useState(false);
  const [mentionHighlight, setMentionHighlight] = useState(0);
  const [mentionMenuPos, setMentionMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [mentionPreviewAssetId, setMentionPreviewAssetId] = useState<string | null>(null);
  const [mentionPreviewCoords, setMentionPreviewCoords] = useState<MentionImagePreviewCoords | null>(
    null,
  );
  const [coursewareLibraryPickerOpen, setCoursewareLibraryPickerOpen] = useState(false);
  const [designTemplatePickerOpen, setDesignTemplatePickerOpen] = useState(false);
  const [extractDesignTemplateOpen, setExtractDesignTemplateOpen] = useState(false);
  const [designTemplateListRefreshKey, setDesignTemplateListRefreshKey] = useState(0);
  const [focusDesignTemplateId, setFocusDesignTemplateId] = useState<string | null>(null);
  const [coursewareRefs, setCoursewareRefs] = useState<ReferencedCoursewareItem[]>([]);
  const [designTemplateRefs, setDesignTemplateRefs] = useState<ReferencedDesignTemplateItem[]>([]);
  const [contentTemplateRefs, setContentTemplateRefs] = useState<ReferencedContentTemplateItem[]>([]);
  const [contentTemplatePickerOpen, setContentTemplatePickerOpen] = useState(false);
  const [extractContentTemplateOpen, setExtractContentTemplateOpen] = useState(false);
  const [contentTemplateListRefreshKey, setContentTemplateListRefreshKey] = useState(0);
  const [focusContentTemplateId, setFocusContentTemplateId] = useState<string | null>(null);
  const [templateLibraryBubbleOpen, setTemplateLibraryBubbleOpen] = useState(false);
  const [templateLibraryAnchor, setTemplateLibraryAnchor] = useState<DOMRect | null>(null);
  const [resourceAssetPickerOpen, setResourceAssetPickerOpen] = useState(false);
  const [resourceBubbleSearch, setResourceBubbleSearch] = useState("");
  const [resourceRecentsTick, setResourceRecentsTick] = useState(0);
  const [caretPos, setCaretPos] = useState(0);
  /** idle: not requested; connecting: sent, no visible first character from the assistant yet; streaming: first character received. Both connecting and streaming can be aborted */
  const [streamPhase, setStreamPhase] = useState<"idle" | "connecting" | "streaming">("idle");
  const [deleteConfirmRect, setDeleteConfirmRect] = useState<DOMRect | null>(null);
  const [emptyGreetingLine, setEmptyGreetingLine] = useState(() =>
    getCoursewareAiEmptyGreetingLine(t),
  );
  /** When false only the latest few turns render; scrolling to the top or clicking the hint expands earlier turns */
  const [olderRoundsRevealed, setOlderRoundsRevealed] = useState(false);
  const pendingManualMarkSessionRef = useRef<CoursewareManualMarkSession | null>(null);
  const manualMarkSyncSkipRef = useRef(false);
  const manualMarkRegionsFromInputSkipRef = useRef(false);
  const manualMarkRegionsRef = useRef(manualMarkRegions);
  manualMarkRegionsRef.current = manualMarkRegions;

  const controlled = chatMessagesProp !== undefined && onChatMessagesChange !== undefined;
  const messages = controlled ? chatMessagesProp : internalMessages;

  const chatRounds = useMemo(() => splitChatMessagesIntoRounds(messages), [messages]);
  const chatListWindow = useMemo(
    () =>
      getAiChatListWindowSlice({
        messages,
        rounds: chatRounds,
        olderRoundsRevealed,
      }),
    [chatRounds, messages, olderRoundsRevealed],
  );
  const { visibleMessages, visibleStartIndex, hiddenRoundCount, hiddenMessageCount } = chatListWindow;

  const coursewareIdRef = useRef(coursewareId);
  coursewareIdRef.current = coursewareId;
  /** Incremented when the courseware switches or the stream is aborted, ignoring stale SSE / finally callbacks */
  const streamEpochRef = useRef(0);
  const prevCoursewareIdForStreamRef = useRef(coursewareId);
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const chatScrollAnimRef = useRef<SmoothScrollRunner>({ raf: 0 });
  /** true after the user scrolls up away from the bottom: no more automatic sticking until they scroll back near the bottom */
  const userPinnedAwayFromBottomRef = useRef(false);
  /** Just sent a message: the next stick-to-bottom scrolls instantly and ignores the fake "left the bottom" caused by the input box collapsing */
  const pendingSendScrollRef = useRef(false);
  /** A programmatic stick-to-bottom animation of the discussion area is running, so scroll isn't mistaken for the user scrolling up */
  const chatScrollProgrammaticRef = useRef(false);
  const lastChatScrollTopRef = useRef(0);
  const textareaRef = useRef<AiPanelComposerHandle | null>(null);
  const textareaWrapRef = useRef<HTMLDivElement | null>(null);
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const userAbortedStreamRef = useRef(false);
  const isSendingRef = useRef(isSending);
  const agentStreamRecoveryStartedRef = useRef<string | null>(null);
  const streamPhaseRef = useRef(streamPhase);
  const streamIdleWaitersRef = useRef<Array<() => void>>([]);
  isSendingRef.current = isSending;
  streamPhaseRef.current = streamPhase;
  const scrollChatToBottomIfFollowingRef = useRef<() => void>(() => {});
  const libraryAssetsRef = useRef<CoursewareAssetItem[]>([]);
  const coursewareRefsRef = useRef<ReferencedCoursewareItem[]>([]);
  const designTemplateRefsRef = useRef<ReferencedDesignTemplateItem[]>([]);
  const contentTemplateRefsRef = useRef<ReferencedContentTemplateItem[]>([]);
  const coursewarePickerMentionStartRef = useRef<number | null>(null);
  const designTemplatePickerMentionStartRef = useRef<number | null>(null);
  const contentTemplatePickerMentionStartRef = useRef<number | null>(null);
  const resourcePickerMentionStartRef = useRef<number | null>(null);
  const templateLibraryBtnRef = useRef<HTMLButtonElement | null>(null);
  const pendingCaretRef = useRef<number | null>(null);
  /** IME composition in progress; Enter should confirm the composition first and not send (on WebKit compositionend may come after keydown) */
  const isInputComposingRef = useRef(false);
  libraryAssetsRef.current = libraryAssets;
  coursewareRefsRef.current = coursewareRefs;
  designTemplateRefsRef.current = designTemplateRefs;
  contentTemplateRefsRef.current = contentTemplateRefs;

  const setMessages = useCallback(
    (update: SetStateAction<CoursewareAiChatMessage[]>) => {
      if (controlled) {
        // The functional update must be handed to the parent as-is, otherwise the same stale chatMessagesProp of one frame would be used repeatedly and streamed appends would overwrite each other into nothing
        onChatMessagesChange(update);
      } else {
        setInternalMessages(update);
      }
    },
    [controlled, onChatMessagesChange],
  );

  const applyAgentChatElementFreeze = useCallback(() => {
    const ids = selectedCanvasElements.map((el) => el.element_id).filter(Boolean);
    onAgentChatFrozenElementIdsChange?.(ids.length > 0 ? ids : []);
  }, [onAgentChatFrozenElementIdsChange, selectedCanvasElements]);

  const clearAgentChatElementFreeze = useCallback(() => {
    onAgentChatFrozenElementIdsChange?.([]);
  }, [onAgentChatFrozenElementIdsChange]);

  const handleSubmitAgentUserQuestion = useCallback(
    async (args: { requestId: string; answers: Record<string, string> }) => {
      if (!onSubmitAgentUserQuestion) return;
      await onSubmitAgentUserQuestion(args);
      setMessages((prev) =>
        prev.map((m) => {
          if (!m.blocks?.length) return m;
          let touched = false;
          const blocks = m.blocks.map((b) => {
            if (b.type !== "user_question" || b.requestId !== args.requestId) return b;
            touched = true;
            return { ...b, answered: true };
          });
          return touched ? { ...m, blocks } : m;
        }),
      );
    },
    [onSubmitAgentUserQuestion, setMessages],
  );

  const activeMention = useMemo(
    () => detectActiveAssetMention(chatInput, caretPos),
    [caretPos, chatInput],
  );

  const alreadyMentionedIds = useMemo(() => {
    const excludeSpan = activeMention ? { start: activeMention.start, end: caretPos } : undefined;
    return getAlreadyMentionedAssetIdsInText(chatInput, libraryAssets, excludeSpan);
  }, [activeMention, caretPos, chatInput, libraryAssets]);

  const mentionDisplayLibrary = useMemo(
    () =>
      mergeMentionLibrariesForDisplay(
        libraryAssets,
        coursewareRefs,
        designTemplateRefs,
        contentTemplateRefs,
      ),
    [contentTemplateRefs, coursewareRefs, designTemplateRefs, libraryAssets],
  );

  const mentionCandidates = useMemo(() => {
    if (!activeMention) return [];
    return filterAssetsForMentionQuery(libraryAssets, activeMention.query).filter(
      (asset) => !alreadyMentionedIds.has(asset.id),
    );
  }, [activeMention, alreadyMentionedIds, libraryAssets]);

  const mentionOpen = activeMention !== null;

  const olderRoundsRevealedRef = useRef(olderRoundsRevealed);
  const hiddenRoundCountRef = useRef(hiddenRoundCount);
  olderRoundsRevealedRef.current = olderRoundsRevealed;
  hiddenRoundCountRef.current = hiddenRoundCount;

  const revealOlderChatRounds = useCallback((): boolean => {
    if (olderRoundsRevealedRef.current || hiddenRoundCountRef.current === 0) return false;
    const el = logScrollRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;
    olderRoundsRevealedRef.current = true;
    setOlderRoundsRevealed(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const scrollEl = logScrollRef.current;
        if (!scrollEl) return;
        scrollEl.scrollTop += scrollEl.scrollHeight - prevScrollHeight;
      });
    });
    return true;
  }, []);

  const handleLogScroll = useCallback((): void => {
    const el = logScrollRef.current;
    if (!el) return;
    if (
      !olderRoundsRevealedRef.current &&
      hiddenRoundCountRef.current > 0 &&
      el.scrollTop <= AI_CHAT_SCROLL_TOP_REVEAL_PX
    ) {
      revealOlderChatRounds();
    }
    if (pendingSendScrollRef.current) {
      lastChatScrollTopRef.current = el.scrollTop;
      return;
    }
    if (chatScrollProgrammaticRef.current) {
      if (isChatScrollNearBottom(el)) {
        userPinnedAwayFromBottomRef.current = false;
      } else if (el.scrollTop < lastChatScrollTopRef.current - 1) {
        userPinnedAwayFromBottomRef.current = true;
        cancelSmoothScroll(chatScrollAnimRef.current, chatScrollProgrammaticRef);
      }
      lastChatScrollTopRef.current = el.scrollTop;
      return;
    }
    if (isChatScrollNearBottom(el)) {
      userPinnedAwayFromBottomRef.current = false;
    } else {
      userPinnedAwayFromBottomRef.current = true;
      cancelSmoothScroll(chatScrollAnimRef.current, chatScrollProgrammaticRef);
    }
    lastChatScrollTopRef.current = el.scrollTop;
  }, [revealOlderChatRounds]);

  const handleLogWheel = useCallback(
    (e: WheelEvent<HTMLDivElement>): void => {
      const el = logScrollRef.current;
      if (
        e.deltaY < 0 &&
        el &&
        el.scrollTop <= 0 &&
        !olderRoundsRevealedRef.current &&
        hiddenRoundCountRef.current > 0
      ) {
        revealOlderChatRounds();
        return;
      }
      if (e.deltaY < 0) {
        userPinnedAwayFromBottomRef.current = true;
        cancelSmoothScroll(chatScrollAnimRef.current, chatScrollProgrammaticRef);
      }
    },
    [revealOlderChatRounds],
  );

  useEffect(() => {
    setOlderRoundsRevealed(false);
    olderRoundsRevealedRef.current = false;
  }, [coursewareId]);

  useEffect(() => {
    if (messages.length > 0) return;
    setOlderRoundsRevealed(false);
    olderRoundsRevealedRef.current = false;
  }, [messages.length]);

  useEffect(() => {
    if (prevCoursewareIdForStreamRef.current === coursewareId) return;
    prevCoursewareIdForStreamRef.current = coursewareId;
    streamEpochRef.current += 1;
    if (abortRef.current) {
      userAbortedStreamRef.current = true;
      abortRef.current.abort();
      abortRef.current = null;
    }
    startTransition(() => {
      setStreamPhase("idle");
      setIsSending(false);
    });
    clearAgentChatElementFreeze();
    const waiters = streamIdleWaitersRef.current.splice(0);
    for (const w of waiters) w();
  }, [clearAgentChatElementFreeze, coursewareId]);

  useEffect(() => {
    const cwId = coursewareId?.trim();
    if (!cwId) {
      setLibraryAssets([]);
      return;
    }
    invalidateCoursewareAssetsListCache();
    let cancelled = false;
    void (async (): Promise<void> => {
      setLibraryLoading(true);
      try {
        const response = await coursewareAssetsApi.listAssets({
          courseware_id: cwId,
          page_number: 1,
          page_size: 100,
          order: "desc",
        });
        if (!cancelled) setLibraryAssets(response.data);
      } catch (err) {
        if (!cancelled) {
          toast.error(
            err instanceof Error ? err.message : t("coursewareEditor.resources.loadFailed"),
          );
          setLibraryAssets([]);
        }
      } finally {
        if (!cancelled) setLibraryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [coursewareId]);

  useEffect(() => {
    const cwId = coursewareId?.trim();
    if (!cwId || typeof sessionStorage === "undefined") {
      setCoursewareRefs([]);
      return;
    }
    try {
      const raw = sessionStorage.getItem(`${COURSEWARE_REFS_SESSION_KEY_PREFIX}${cwId}`);
      if (!raw) {
        setCoursewareRefs([]);
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        setCoursewareRefs([]);
        return;
      }
      const restored = parsed.filter(
        (item): item is ReferencedCoursewareItem =>
          Boolean(
            item &&
              typeof item === "object" &&
              typeof (item as ReferencedCoursewareItem).key === "string" &&
              typeof (item as ReferencedCoursewareItem).title === "string" &&
              typeof (item as ReferencedCoursewareItem).jsonUrl === "string",
          ),
      );
      setCoursewareRefs(restored);
    } catch {
      setCoursewareRefs([]);
    }
  }, [coursewareId]);

  useEffect(() => {
    const cwId = coursewareId?.trim();
    if (!cwId || typeof sessionStorage === "undefined") return;
    try {
      if (coursewareRefs.length === 0) {
        sessionStorage.removeItem(`${COURSEWARE_REFS_SESSION_KEY_PREFIX}${cwId}`);
        return;
      }
      sessionStorage.setItem(
        `${COURSEWARE_REFS_SESSION_KEY_PREFIX}${cwId}`,
        JSON.stringify(coursewareRefs),
      );
    } catch {
      // quota / private mode
    }
  }, [coursewareId, coursewareRefs]);

  useEffect(() => {
    const cwId = coursewareId?.trim();
    if (!cwId || typeof sessionStorage === "undefined") {
      setDesignTemplateRefs([]);
      return;
    }
    try {
      const raw = sessionStorage.getItem(`${DESIGN_TEMPLATE_REFS_SESSION_KEY_PREFIX}${cwId}`);
      if (!raw) {
        setDesignTemplateRefs([]);
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        setDesignTemplateRefs([]);
        return;
      }
      const restored = parsed.filter(
        (item): item is ReferencedDesignTemplateItem =>
          Boolean(
            item &&
              typeof item === "object" &&
              typeof (item as ReferencedDesignTemplateItem).id === "string" &&
              typeof (item as ReferencedDesignTemplateItem).name === "string",
          ),
      );
      setDesignTemplateRefs(restored);
    } catch {
      setDesignTemplateRefs([]);
    }
  }, [coursewareId]);

  useEffect(() => {
    const cwId = coursewareId?.trim();
    if (!cwId || typeof sessionStorage === "undefined") return;
    try {
      if (designTemplateRefs.length === 0) {
        sessionStorage.removeItem(`${DESIGN_TEMPLATE_REFS_SESSION_KEY_PREFIX}${cwId}`);
        return;
      }
      sessionStorage.setItem(
        `${DESIGN_TEMPLATE_REFS_SESSION_KEY_PREFIX}${cwId}`,
        JSON.stringify(designTemplateRefs),
      );
    } catch {
      // quota / private mode
    }
  }, [coursewareId, designTemplateRefs]);

  useEffect(() => {
    const cwId = coursewareId?.trim();
    if (!cwId || typeof sessionStorage === "undefined") {
      setContentTemplateRefs([]);
      return;
    }
    try {
      const raw = sessionStorage.getItem(`${CONTENT_TEMPLATE_REFS_SESSION_KEY_PREFIX}${cwId}`);
      if (!raw) {
        setContentTemplateRefs([]);
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        setContentTemplateRefs([]);
        return;
      }
      const restored = parsed.filter(
        (item): item is ReferencedContentTemplateItem =>
          Boolean(
            item &&
              typeof item === "object" &&
              typeof (item as ReferencedContentTemplateItem).id === "string" &&
              typeof (item as ReferencedContentTemplateItem).name === "string",
          ),
      );
      setContentTemplateRefs(restored);
    } catch {
      setContentTemplateRefs([]);
    }
  }, [coursewareId]);

  useEffect(() => {
    const cwId = coursewareId?.trim();
    if (!cwId || typeof sessionStorage === "undefined") return;
    try {
      if (contentTemplateRefs.length === 0) {
        sessionStorage.removeItem(`${CONTENT_TEMPLATE_REFS_SESSION_KEY_PREFIX}${cwId}`);
        return;
      }
      sessionStorage.setItem(
        `${CONTENT_TEMPLATE_REFS_SESSION_KEY_PREFIX}${cwId}`,
        JSON.stringify(contentTemplateRefs),
      );
    } catch {
      // quota / private mode
    }
  }, [coursewareId, contentTemplateRefs]);

  const mergeUploadedLibraryAssets = useCallback((uploaded: CoursewareAssetItem[]) => {
    if (uploaded.length === 0) return;
    setLibraryAssets((prev) => {
      let next = prev;
      for (const asset of uploaded) {
        next = [asset, ...next.filter((a) => a.id !== asset.id)];
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!uploadedAssetsRegistry) return;
    return uploadedAssetsRegistry.register(mergeUploadedLibraryAssets);
  }, [mergeUploadedLibraryAssets, uploadedAssetsRegistry]);

  useLayoutEffect(() => {
    if (!mentionOpen || !activeMention) {
      setMentionMenuPos(null);
      return;
    }
    const updatePos = (): void => {
      const el = textareaRef.current;
      if (!el) return;
      setMentionMenuPos(el.getCaretClientRect(activeMention.start + 1));
    };
    updatePos();
    const scrollEl = textareaRef.current?.getScrollElement();
    scrollEl?.addEventListener("scroll", updatePos, { passive: true });
    window.addEventListener("resize", updatePos, { passive: true });
    return () => {
      scrollEl?.removeEventListener("scroll", updatePos);
      window.removeEventListener("resize", updatePos);
    };
  }, [mentionOpen, activeMention, chatInput]);

  useEffect(() => {
    setMentionHighlight(0);
  }, [activeMention?.start, activeMention?.query]);

  useEffect(() => {
    setMentionHighlight((i) =>
      mentionCandidates.length === 0 ? 0 : Math.min(i, mentionCandidates.length - 1),
    );
  }, [mentionCandidates.length]);

  const mentionPreviewAsset = useMemo(
    () => mentionCandidates.find((a) => a.id === mentionPreviewAssetId) ?? null,
    [mentionCandidates, mentionPreviewAssetId],
  );

  const syncMentionPreviewCoords = useCallback(() => {
    if (!mentionPreviewAssetId) return;
    const el = document.querySelector(
      `[data-mention-option-id="${CSS.escape(mentionPreviewAssetId)}"]`,
    );
    if (!(el instanceof HTMLElement)) return;
    setMentionPreviewCoords(computeMentionImagePreviewCoords(el.getBoundingClientRect()));
  }, [mentionPreviewAssetId]);

  useEffect(() => {
    if (!mentionOpen) {
      setMentionPreviewAssetId(null);
      setMentionPreviewCoords(null);
    }
  }, [mentionOpen]);

  useLayoutEffect(() => {
    if (!mentionOpen) return;
    const asset = mentionCandidates[mentionHighlight];
    if (!asset || !isCoursewareImageAsset(asset)) {
      setMentionPreviewAssetId(null);
      setMentionPreviewCoords(null);
      return;
    }
    setMentionPreviewAssetId(asset.id);
  }, [mentionOpen, mentionHighlight, mentionCandidates]);

  useLayoutEffect(() => {
    if (!mentionPreviewAssetId || !mentionOpen) {
      setMentionPreviewCoords(null);
      return;
    }
    syncMentionPreviewCoords();
    const onReposition = () => syncMentionPreviewCoords();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [mentionOpen, mentionPreviewAssetId, syncMentionPreviewCoords, mentionCandidates.length]);

  const canDelete = totalSlides > 1;
  const busy = isAssistantBusy || isSending || isClearing || isAttaching || isHistoryLoading;
  const sendBlocked = isClearing || isAttaching || isHistoryLoading;
  const canAbortStream = streamPhase === "connecting" || streamPhase === "streaming";
  const hasActiveChatStream =
    canAbortStream || isSending || abortRef.current != null;
  const sessionSwitchBlocked = hasActiveChatStream || isAssistantBusy;

  useEffect(() => {
    onAgentWorkingChange?.(hasActiveChatStream);
  }, [hasActiveChatStream, onAgentWorkingChange]);

  const notifyStreamIdle = useCallback(() => {
    const waiters = streamIdleWaitersRef.current.splice(0);
    for (const w of waiters) w();
  }, []);

  const waitForStreamIdle = useCallback((): Promise<void> => {
    if (!isSendingRef.current && streamPhaseRef.current === "idle") {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        const idx = streamIdleWaitersRef.current.indexOf(finish);
        if (idx >= 0) streamIdleWaitersRef.current.splice(idx, 1);
        resolve();
      };
      streamIdleWaitersRef.current.push(finish);
      const timeoutId = window.setTimeout(finish, 60_000);
    });
  }, []);

  const interruptActiveStream = useCallback(async (): Promise<void> => {
    if (!abortRef.current && !isSendingRef.current && streamPhaseRef.current === "idle") {
      return;
    }
    streamEpochRef.current += 1;
    userAbortedStreamRef.current = true;
    abortRef.current?.abort();
    await waitForStreamIdle();
    abortRef.current = null;
    setStreamPhase("idle");
    setIsSending(false);
  }, [waitForStreamIdle]);
  const fileDropAllowed = !!coursewareId?.trim();
  const pageHint = t("coursewareEditor.aiPanel.pageHint", {
    page: selectedSlideIndex + 1,
    total: totalSlides,
  });
  const resolvedSessionTitle = useMemo(() => {
    if (isPlaceholderAgentSessionTitle(sessionTitle)) {
      return t(EDITOR_AGENT_DEFAULT_SESSION_TITLE_KEY);
    }
    return sessionTitle?.trim() || t(EDITOR_AGENT_DEFAULT_SESSION_TITLE_KEY);
  }, [sessionTitle, t]);
  const selectedCanvasCount = selectedCanvasElements.length;

  /** Plan mode: the design brief markdown extracted from the latest assistant message (without the question/confirmation dialogue). */
  const latestAssistantDraft = useMemo(() => {
    if (!isPlanMode) return "";
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (!m || m.role !== "assistant") continue;
      if (!assistantPanelBubbleHasVisibleBody(m.content, m.blocks)) continue;
      const raw = assistantPlainTextForTurnsCheck(m.content, m.blocks).trim();
      const brief = extractPlanDesignBriefMarkdown(raw);
      if (brief.length >= 80) return brief;
    }
    return "";
  }, [isPlanMode, messages]);

  const handleStartMakingClick = useCallback(() => {
    const draft = latestAssistantDraft.trim();
    if (!draft) {
      toast.error(t("coursewareEditor.aiPanel.plan.startMakingEmpty"));
      return;
    }
    onStartMakingWithDraft?.(draft);
  }, [latestAssistantDraft, onStartMakingWithDraft, t]);

  const sortedAgentSessions = useMemo(() => {
    const list = [...agentSessions];
    list.sort((a, b) => {
      // Keep showing in reverse time order; the current conversation is only marked by a highlight/badge without changing the order.
      const byUpdatedAt = b.updatedAt - a.updatedAt;
      if (byUpdatedAt !== 0) return byUpdatedAt;
      // Tie-break on equal times for stability: by id descending
      return b.id.localeCompare(a.id);
    });
    return list;
  }, [agentSessions]);

  const formatSessionMeta = useCallback(
    (session: CoursewareAgentSessionView): string => {
      if (session.isActive) {
        return t("coursewareEditor.aiPanel.currentConversationMeta", {
          count: session.messageCount,
        });
      }
      const time = formatAgentSessionUpdatedAt(session.updatedAt, language);
      return t("coursewareEditor.aiPanel.sessionMetaInactive", {
        time,
        count: session.messageCount,
      });
    },
    [language, t],
  );

  const notifySessionSwitchBlocked = useCallback(() => {
    toast.error(t("coursewareEditor.aiPanel.sessionSwitchBlocked"));
  }, [t]);

  const handleAgentSessionSelect = useCallback(
    (sessionId: string) => {
      if (sessionSwitchBlocked) {
        notifySessionSwitchBlocked();
        return;
      }
      onAgentSessionSelect?.(sessionId);
    },
    [notifySessionSwitchBlocked, onAgentSessionSelect, sessionSwitchBlocked],
  );

  const handleAgentSessionCreate = useCallback(() => {
    if (sessionSwitchBlocked) {
      notifySessionSwitchBlocked();
      return;
    }
    onAgentSessionCreate?.();
  }, [notifySessionSwitchBlocked, onAgentSessionCreate, sessionSwitchBlocked]);

  useEffect(() => {
    if (!historyMenuOpen) return;
    const onDocPointer = (event: MouseEvent) => {
      const wrap = historyMenuWrapRef.current;
      if (wrap && !wrap.contains(event.target as Node)) {
        setHistoryMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHistoryMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [historyMenuOpen]);

  useEffect(() => {
    if (messages.length === 0) {
      userPinnedAwayFromBottomRef.current = false;
    }
  }, [messages.length]);

  /** Shown only for an empty conversation; refreshed on a timer so it stays accurate across times of day */
  useEffect(() => {
    if (messages.length !== 0) return;
    const refresh = () => setEmptyGreetingLine(getCoursewareAiEmptyGreetingLine(t));
    refresh();
    const id = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(id);
  }, [messages.length, t]);

  /** Text and count changes (including streamed appends); avoids using the `messages` reference as the only dependency, which would miss scrolls when the controlled parent misbehaves */
  const chatScrollKey = useMemo(() => {
    const parts: string[] = [`${busy ? 1 : 0}`];
    for (const m of messages) {
      let blockSig = "";
      if (m.blocks?.length) {
        for (const b of m.blocks) {
          if (b.type === "prose") blockSig += `p${b.text.length}`;
          else if (b.type === "todos") {
            blockSig += `t${b.items.length}`;
            for (const item of b.items) blockSig += `${item.status[0]}${item.content.length}`;
          } else if (b.type === "tool") {
            blockSig += `o${b.title.length}${b.output?.length ?? 0}`;
          } else if (b.type === "insufficient_org_credits") {
            blockSig += "co";
          } else if (b.type === "insufficient_personal_credits") {
            blockSig += "cp";
          } else if (b.type === "agent_context_reset_required") {
            blockSig += "cr";
          } else if (b.type === "user_question") {
            blockSig += `q${b.questions.length}${b.answered ? 1 : 0}`;
          }
        }
      }
      parts.push(`${m.id}\u0001${m.content.length}\u0001${blockSig}`);
    }
    return parts.join("\u0002");
  }, [busy, messages]);

  scrollChatToBottomIfFollowingRef.current = (): void => {
    const scrollEl = logScrollRef.current;
    if (!scrollEl) return;
    if (pendingSendScrollRef.current) {
      flushChatScrollToBottom(scrollEl, chatScrollAnimRef.current, chatScrollProgrammaticRef);
      if (isChatScrollNearBottom(scrollEl, 4)) {
        pendingSendScrollRef.current = false;
      }
      return;
    }
    if (userPinnedAwayFromBottomRef.current) return;
    smoothScrollTowardBottom(scrollEl, chatScrollAnimRef.current, {
      programmaticRef: chatScrollProgrammaticRef,
    });
  };

  /**
   * Stick to the bottom when streaming and late Markdown layout arrive.
   * No ResizeObserver: `scrollTop` changes the scrollbar gutter → the content width changes → relayout changes the height again → the observer callback oscillates,
   * and in extreme cases, interleaved with React updates, it triggers "Maximum update depth exceeded" and SSE looks stuck.
   * The MutationObserver mounts only once; don't disconnect it repeatedly with chatScrollKey, or frequent streamed DOM changes would fight the rAF stick-to-bottom.
   */
  useLayoutEffect(() => {
    const scrollEl = logScrollRef.current;
    if (!scrollEl || typeof MutationObserver === "undefined") return;

    let raf = 0;
    const scheduleScroll = (): void => {
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        scrollChatToBottomIfFollowingRef.current();
      });
    };

    const mo = new MutationObserver(scheduleScroll);
    mo.observe(scrollEl, { childList: true, subtree: true, characterData: true });
    return () => {
      mo.disconnect();
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, []);

  useLayoutEffect(() => {
    scrollChatToBottomIfFollowingRef.current();
    if (pendingSendScrollRef.current) {
      scheduleFlushChatScrollToBottom(
        () => logScrollRef.current,
        chatScrollAnimRef.current,
        chatScrollProgrammaticRef,
      );
    }
    return () => cancelSmoothScroll(chatScrollAnimRef.current, chatScrollProgrammaticRef);
  }, [chatScrollKey]);

  useLayoutEffect(() => {
    if (manualMarkSyncSkipRef.current) {
      manualMarkSyncSkipRef.current = false;
      return;
    }
    let next = chatInput;
    // Resources / coursewares / design templates are all normalized to a short `@name`, for easy reading and parsing
    if (
      hasBracketAssetMentionTokens(next) ||
      hasBracketCoursewareMentionTokens(next) ||
      hasBracketDesignTemplateMentionTokens(next) ||
      hasBracketContentTemplateMentionTokens(next) ||
      MANUAL_MARK_TOKEN_RE.test(next)
    ) {
      next = formatAiPanelInputForDisplay(next);
    }
    if (next !== chatInput) {
      manualMarkSyncSkipRef.current = true;
      setChatInput(next);
    }
  }, [chatInput]);

  useLayoutEffect(() => {
    if (pendingCaretRef.current === null) return;
    const pos = pendingCaretRef.current;
    pendingCaretRef.current = null;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(pos, pos);
    setCaretPos(pos);
  }, [chatInput]);

  const resourceRecentEntries = useMemo(() => {
    void resourceRecentsTick;
    return readResourceMentionRecents(coursewareId);
  }, [coursewareId, resourceRecentsTick]);

  const templateRecentEntries = useMemo(() => {
    void resourceRecentsTick;
    return readTemplateMentionRecents(orgId);
  }, [orgId, resourceRecentsTick]);

  useEffect(() => {
    if (activeMention) {
      setResourceBubbleSearch(activeMention.query);
      return;
    }
    setResourceBubbleSearch("");
  }, [activeMention?.query, activeMention?.start]);

  const closeActiveResourceMention = useCallback(() => {
    const el = textareaRef.current;
    if (!el || !activeMention) {
      setResourceBubbleSearch("");
      return;
    }
    const cursor = el.getSelection().start;
    const next = `${chatInput.slice(0, activeMention.start)}${chatInput.slice(cursor)}`;
    pendingCaretRef.current = activeMention.start;
    setChatInput(next);
    setResourceBubbleSearch("");
  }, [activeMention, chatInput]);

  const updateResourceBubbleSearch = useCallback(
    (query: string) => {
      setResourceBubbleSearch(query);
      if (!activeMention) return;
      const next = `${chatInput.slice(0, activeMention.start + 1)}${query}${chatInput.slice(
        activeMention.start + 1 + activeMention.query.length,
      )}`;
      const nextCaret = activeMention.start + 1 + query.length;
      pendingCaretRef.current = nextCaret;
      setChatInput(next);
      setCaretPos(nextCaret);
    },
    [activeMention, chatInput],
  );

  const insertAssetMention = useCallback(
    (asset: CoursewareAssetItem, mentionStart?: number | null) => {
      const el = textareaRef.current;
      const start =
        typeof mentionStart === "number"
          ? mentionStart
          : activeMention?.start ?? resourcePickerMentionStartRef.current;
      resourcePickerMentionStartRef.current = null;
      if (el && start != null) {
        const cursor = el.getSelection().start;
        const { text, cursor: nextCursor } = applyAssetMentionSelection(
          chatInput,
          start,
          cursor,
          asset,
        );
        pendingCaretRef.current = nextCursor;
        setChatInput(text);
      } else if (el) {
        const caret = el.getSelection().start;
        const end = el.getSelection().end;
        const token = formatAssetMentionDisplayToken(asset);
        const next = `${chatInput.slice(0, caret)}${token}${chatInput.slice(end)}`;
        pendingCaretRef.current = caret + token.length;
        setChatInput(next);
      }
      recordAssetMentionRecent(coursewareId, asset);
      setResourceRecentsTick((n) => n + 1);
    },
    [activeMention, chatInput, coursewareId],
  );

  const selectMentionAsset = useCallback(
    (asset: CoursewareAssetItem) => {
      insertAssetMention(asset, activeMention?.start);
    },
    [activeMention?.start, insertAssetMention],
  );

  const openCoursewareLibraryPicker = useCallback((mentionStart?: number) => {
    coursewarePickerMentionStartRef.current =
      typeof mentionStart === "number"
        ? mentionStart
        : activeMention?.start ?? null;
    setCoursewareLibraryPickerOpen(true);
  }, [activeMention?.start]);

  const openDesignTemplatePicker = useCallback((mentionStart?: number) => {
    designTemplatePickerMentionStartRef.current =
      typeof mentionStart === "number" ? mentionStart : null;
    setDesignTemplatePickerOpen(true);
  }, []);

  const selectReferencedCourseware = useCallback(
    (item: ReferencedCoursewareItem) => {
      setCoursewareRefs((prev) => {
        if (prev.some((cw) => cw.key === item.key)) return prev;
        return [...prev, item];
      });
      const el = textareaRef.current;
      const mentionStart = coursewarePickerMentionStartRef.current;
      coursewarePickerMentionStartRef.current = null;
      if (el && mentionStart != null) {
        const cursor = el.getSelection().start;
        const { text, cursor: nextCursor } = applyCoursewareMentionSelection(
          chatInput,
          mentionStart,
          cursor,
          item,
        );
        pendingCaretRef.current = nextCursor;
        setChatInput(text);
        recordCoursewareMentionRecent(coursewareId, item);
        setResourceRecentsTick((n) => n + 1);
        return;
      }
      if (el) {
        const start = el.getSelection().start;
        const end = el.getSelection().end;
        const token = formatCoursewareMentionDisplayToken(item);
        const next = `${chatInput.slice(0, start)}${token}${chatInput.slice(end)}`;
        pendingCaretRef.current = start + token.length;
        setChatInput(next);
      }
      recordCoursewareMentionRecent(coursewareId, item);
      setResourceRecentsTick((n) => n + 1);
    },
    [chatInput, coursewareId],
  );

  const selectReferencedDesignTemplate = useCallback(
    (item: ReferencedDesignTemplateItem) => {
      setDesignTemplateRefs((prev) => {
        if (prev.some((row) => row.id === item.id)) return prev;
        return [...prev, item];
      });
      const el = textareaRef.current;
      const mentionStart = designTemplatePickerMentionStartRef.current;
      designTemplatePickerMentionStartRef.current = null;
      if (el && mentionStart != null) {
        const cursor = el.getSelection().start;
        const { text, cursor: nextCursor } = applyDesignTemplateMentionSelection(
          chatInput,
          mentionStart,
          cursor,
          item,
        );
        pendingCaretRef.current = nextCursor;
        setChatInput(text);
        recordDesignTemplateMentionRecent(orgId, item);
        setResourceRecentsTick((n) => n + 1);
        return;
      }
      if (el) {
        const start = el.getSelection().start;
        const end = el.getSelection().end;
        const token = formatDesignTemplateMentionDisplayToken(item);
        const next = `${chatInput.slice(0, start)}${token}${chatInput.slice(end)}`;
        pendingCaretRef.current = start + token.length;
        setChatInput(next);
      }
      recordDesignTemplateMentionRecent(orgId, item);
      setResourceRecentsTick((n) => n + 1);
    },
    [chatInput, orgId],
  );

  const openContentTemplatePicker = useCallback((mentionStart?: number) => {
    contentTemplatePickerMentionStartRef.current =
      typeof mentionStart === "number" ? mentionStart : null;
    setContentTemplatePickerOpen(true);
  }, []);

  const selectReferencedContentTemplate = useCallback(
    (item: ReferencedContentTemplateItem) => {
      setContentTemplateRefs((prev) => {
        if (prev.some((row) => row.id === item.id)) return prev;
        return [...prev, item];
      });
      const el = textareaRef.current;
      const mentionStart = contentTemplatePickerMentionStartRef.current;
      contentTemplatePickerMentionStartRef.current = null;
      if (el && mentionStart != null) {
        const cursor = el.getSelection().start;
        const { text, cursor: nextCursor } = applyContentTemplateMentionSelection(
          chatInput,
          mentionStart,
          cursor,
          item,
        );
        pendingCaretRef.current = nextCursor;
        setChatInput(text);
        recordContentTemplateMentionRecent(orgId, item);
        setResourceRecentsTick((n) => n + 1);
        return;
      }
      if (el) {
        const start = el.getSelection().start;
        const end = el.getSelection().end;
        const token = formatContentTemplateMentionDisplayToken(item);
        const next = `${chatInput.slice(0, start)}${token}${chatInput.slice(end)}`;
        pendingCaretRef.current = start + token.length;
        setChatInput(next);
      }
      recordContentTemplateMentionRecent(orgId, item);
      setResourceRecentsTick((n) => n + 1);
    },
    [chatInput, orgId],
  );

  const pickResourceRecentEntry = useCallback(
    (entry: AiMentionRecentEntry) => {
      if (entry.kind === "courseware") {
        if (activeMention) {
          coursewarePickerMentionStartRef.current = activeMention.start;
        }
        const key = entry.key ?? entry.id;
        const existing = coursewareRefs.find((cw) => cw.key === key || cw.id === entry.id);
        selectReferencedCourseware(
          existing ??
            toReferencedCoursewareItem({
              id: entry.id,
              key,
              title: entry.name,
            }),
        );
        return;
      }
      if (entry.kind !== "asset") return;
      const fromLibrary = libraryAssets.find((a) => a.id === entry.id);
      const asset: CoursewareAssetItem =
        fromLibrary ??
        ({
          id: entry.id,
          name: entry.name,
          extension: (entry.extension ?? "png") as CoursewareAssetItem["extension"],
          url: "",
          mimeType: "",
          size: 0,
          createdAt: "",
        } as CoursewareAssetItem);
      insertAssetMention(asset);
    },
    [activeMention, coursewareRefs, insertAssetMention, libraryAssets, selectReferencedCourseware],
  );

  const pickTemplateRecentEntry = useCallback(
    (entry: AiMentionRecentEntry) => {
      if (entry.kind === "design_template") {
        selectReferencedDesignTemplate({ id: entry.id, name: entry.name });
        setTemplateLibraryBubbleOpen(false);
        return;
      }
      if (entry.kind === "content_template") {
        selectReferencedContentTemplate({ id: entry.id, name: entry.name });
        setTemplateLibraryBubbleOpen(false);
      }
    },
    [selectReferencedContentTemplate, selectReferencedDesignTemplate],
  );

  const openTemplateLibraryBubble = useCallback(() => {
    const rect = templateLibraryBtnRef.current?.getBoundingClientRect() ?? null;
    setTemplateLibraryAnchor(rect);
    setTemplateLibraryBubbleOpen((open) => !open);
  }, []);

  // Sync to the canvas only when chatInput changes; don't put manualMarkRegions in deps — after confirming a new mark, regions
  // update first while chatInput isn't written yet, and syncing back with the old input then would delete the mark just added.
  useEffect(() => {
    if (!onManualMarkRegionsChange) return;
    if (manualMarkSyncSkipRef.current) {
      manualMarkSyncSkipRef.current = false;
      return;
    }
    const regions = manualMarkRegionsRef.current;
    const next = syncManualMarkRegionsFromChatInput(chatInput, regions);
    if (manualMarkRegionsEqual(next, regions)) return;
    manualMarkRegionsFromInputSkipRef.current = true;
    onManualMarkRegionsChange(next);
  }, [chatInput, onManualMarkRegionsChange]);

  useEffect(() => {
    if (!onManualMarkModeToggle) return;
    pendingManualMarkSessionRef.current = buildManualMarkSession(
      selectedSlideIndex,
      manualMarkSlideId,
      manualMarkPlayheadMs,
      manualMarkRegions,
    );
    if (manualMarkRegionsFromInputSkipRef.current) {
      manualMarkRegionsFromInputSkipRef.current = false;
      return;
    }
    if (manualMarkRegions.length === 0) {
      manualMarkSyncSkipRef.current = true;
      setChatInput((prev) => {
        const stripped = stripManualMarksFromChatInputText(prev);
        return stripped === prev ? prev : stripped;
      });
      return;
    }
    if (!manualMarkModeActive) return;
    manualMarkSyncSkipRef.current = true;
    setChatInput((prev) => buildChatInputWithManualMarks(prev, manualMarkRegions));
  }, [
    manualMarkModeActive,
    manualMarkRegions,
    manualMarkPlayheadMs,
    manualMarkSlideId,
    onManualMarkModeToggle,
    selectedSlideIndex,
  ]);

  const insertAtTrigger = useCallback(() => {
    setTemplateLibraryBubbleOpen(false);
    const el = textareaRef.current;
    if (!el) return;
    const start = el.getSelection().start;
    const end = el.getSelection().end;
    const next = `${chatInput.slice(0, start)}@${chatInput.slice(end)}`;
    const cursor = start + 1;
    pendingCaretRef.current = cursor;
    setChatInput(next);
  }, [chatInput]);

  useEffect(() => {
    if (mentionOpen) setTemplateLibraryBubbleOpen(false);
  }, [mentionOpen]);

  const submitUserChatText = useCallback(
    async (rawText: string): Promise<void> => {
      const text = rawText.trim();
      if (!text || sendBlocked || isSendingRef.current || abortRef.current) return;
      const streamEpoch = streamEpochRef.current;
      const submitCoursewareId = coursewareIdRef.current;
      const streamStillActive = (): boolean =>
        streamEpochRef.current === streamEpoch && coursewareIdRef.current === submitCoursewareId;

      applyAgentChatElementFreeze();
      userPinnedAwayFromBottomRef.current = false;
      pendingSendScrollRef.current = true;
      const referencedAssets = parseMentionedAssetsFromText(text, libraryAssetsRef.current);
      const referencedCourseware = parseReferencedCoursewareFromText(
        text,
        coursewareRefsRef.current,
      );
      const referencedDesignTemplates = parseReferencedDesignTemplatesFromText(
        text,
        designTemplateRefsRef.current,
      );
      const referencedContentTemplates = parseReferencedContentTemplatesFromText(
        text,
        contentTemplateRefsRef.current,
      );
      const manualMarkSession =
        buildManualMarkSession(
          selectedSlideIndex,
          manualMarkSlideId,
          manualMarkPlayheadMs,
          manualMarkRegions,
        ) ?? pendingManualMarkSessionRef.current;
      const displayText = formatAiPanelInputForDisplay(text);
      const userId = `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      if (!streamStillActive()) return;
      setMessages((prev) => [...prev, { id: userId, role: "user", content: displayText }]);
      setIsSending(true);
      setStreamPhase("connecting");
      userAbortedStreamRef.current = false;
      const abortController = new AbortController();
      abortRef.current = abortController;
      const assistantId = `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setMessages((prev) => [...prev, { id: assistantId, role: "assistant", content: "", blocks: [] }]);
      scheduleFlushChatScrollToBottom(
        () => logScrollRef.current,
        chatScrollAnimRef.current,
        chatScrollProgrammaticRef,
      );
      const bumpPhaseIfVisible = (s: string): void => {
        if (!streamStillActive() || !/\S/.test(s)) return;
        // Don't call setStreamPhase synchronously inside the setMessages updater: in controlled mode the updater runs inside the Island's setState and would trigger a cross-component update warning
        startTransition(() => {
          if (!streamStillActive()) return;
          setStreamPhase((p) => (p === "connecting" ? "streaming" : p));
        });
      };
      const setAssistantContent = (content: string): void => {
        if (!streamStillActive()) return;
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content } : m)));
        bumpPhaseIfVisible(content);
      };
      const appendAssistantContent = (delta: string): void => {
        if (!streamStillActive()) return;
        setMessages((prev) => {
          let merged = "";
          const next = prev.map((m) => {
            if (m.id !== assistantId) return m;
            merged = `${m.content}${delta}`;
            return { ...m, content: merged };
          });
          if (merged) queueMicrotask(() => bumpPhaseIfVisible(merged));
          return next;
        });
      };
      const applyAssistantUiEvents = (events: CoursewareAgentChatUiEvent[]): void => {
        if (!events.length || !streamStillActive()) return;
        setMessages((prev) => {
          let contentForPhase = "";
          const next = prev.map((m) => {
            if (m.id !== assistantId) return m;
            const blocks = applyCoursewareAgentChatUiEvents(m.blocks ?? [], events);
            contentForPhase = coursewareAiAssistantBlocksToPlainText(blocks);
            return { ...m, blocks, content: contentForPhase };
          });
          if (contentForPhase) queueMicrotask(() => bumpPhaseIfVisible(contentForPhase));
          return next;
        });
      };
      try {
        const slideJson = getCurrentSlideJson();
        await onSubmitMessage?.(
          {
            text,
            slideJson,
            pageIndex: selectedSlideIndex,
            totalPages: totalSlides,
            currentSlideId,
            selectedElements: selectedCanvasElements,
            referencedAssets,
            referencedCourseware,
            referencedDesignTemplates,
            referencedContentTemplates,
            manualMarkSession,
            abortController,
            agentModel: agentModelRef.current,
            mode: panelModeRef.current,
          },
          { setAssistantContent, appendAssistantContent, applyAssistantUiEvents },
        );
      } finally {
        if (streamStillActive()) {
          onAssistantStreamEnd?.(userAbortedStreamRef.current ? "aborted" : "completed");
          if (abortRef.current === abortController) {
            abortRef.current = null;
          }
          setStreamPhase("idle");
          setIsSending(false);
        }
        clearAgentChatElementFreeze();
        notifyStreamIdle();
      }
    },
    [
      applyAgentChatElementFreeze,
      clearAgentChatElementFreeze,
      getCurrentSlideJson,
      notifyStreamIdle,
      sendBlocked,
      manualMarkPlayheadMs,
      manualMarkRegions,
      manualMarkSlideId,
      onAssistantStreamEnd,
      onSubmitMessage,
      currentSlideId,
      selectedCanvasElements,
      selectedSlideIndex,
      totalSlides,
      setMessages,
    ],
  );

  useEffect(() => {
    const recovery = agentStreamRecovery;
    if (!recovery?.chatStreamSessionId?.trim() || !onRecoverAgentStream || isHistoryLoading) {
      return;
    }
    const streamId = recovery.chatStreamSessionId.trim();
    if (agentStreamRecoveryStartedRef.current === streamId) {
      return;
    }
    if (isSendingRef.current || abortRef.current) {
      return;
    }
    agentStreamRecoveryStartedRef.current = streamId;

    const streamEpoch = (streamEpochRef.current += 1);
    const recoverCoursewareId = coursewareIdRef.current;
    const streamStillActive = (): boolean =>
      streamEpochRef.current === streamEpoch && coursewareIdRef.current === recoverCoursewareId;

    applyAgentChatElementFreeze();
    userPinnedAwayFromBottomRef.current = false;
    pendingSendScrollRef.current = true;
    setIsSending(true);
    setStreamPhase("connecting");
    userAbortedStreamRef.current = false;
    const abortController = new AbortController();
    abortRef.current = abortController;

    let assistantId = `a_recover_${Date.now()}`;
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant") {
        assistantId = last.id;
        return prev;
      }
      return [...prev, { id: assistantId, role: "assistant", content: "", blocks: [] }];
    });
    scheduleFlushChatScrollToBottom(
      () => logScrollRef.current,
      chatScrollAnimRef.current,
      chatScrollProgrammaticRef,
    );

    const bumpPhaseIfVisible = (s: string): void => {
      if (!streamStillActive() || !/\S/.test(s)) return;
      startTransition(() => {
        if (!streamStillActive()) return;
        setStreamPhase((p) => (p === "connecting" ? "streaming" : p));
      });
    };
    const setAssistantContent = (content: string): void => {
      if (!streamStillActive()) return;
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content } : m)));
      bumpPhaseIfVisible(content);
    };
    const appendAssistantContent = (delta: string): void => {
      if (!streamStillActive()) return;
      setMessages((prev) => {
        let merged = "";
        const next = prev.map((m) => {
          if (m.id !== assistantId) return m;
          merged = `${m.content}${delta}`;
          return { ...m, content: merged };
        });
        if (merged) queueMicrotask(() => bumpPhaseIfVisible(merged));
        return next;
      });
    };
    const applyAssistantUiEvents = (events: CoursewareAgentChatUiEvent[]): void => {
      if (!events.length || !streamStillActive()) return;
      setMessages((prev) => {
        let contentForPhase = "";
        const next = prev.map((m) => {
          if (m.id !== assistantId) return m;
          const blocks = applyCoursewareAgentChatUiEvents(m.blocks ?? [], events);
          contentForPhase = coursewareAiAssistantBlocksToPlainText(blocks);
          return { ...m, blocks, content: contentForPhase };
        });
        if (contentForPhase) queueMicrotask(() => bumpPhaseIfVisible(contentForPhase));
        return next;
      });
    };

    void (async () => {
      try {
        await onRecoverAgentStream(
          {
            chatStreamSessionId: streamId,
            livePreviewSessionId: recovery.livePreviewSessionId,
            from: recovery.from,
            abortController,
          },
          { setAssistantContent, appendAssistantContent, applyAssistantUiEvents },
        );
      } finally {
        if (agentStreamRecoveryStartedRef.current === streamId) {
          agentStreamRecoveryStartedRef.current = null;
        }
        if (streamStillActive()) {
          onAssistantStreamEnd?.(userAbortedStreamRef.current ? "aborted" : "completed");
          if (abortRef.current === abortController) {
            abortRef.current = null;
          }
          setStreamPhase("idle");
          setIsSending(false);
        }
        clearAgentChatElementFreeze();
        notifyStreamIdle();
        onAgentStreamRecoverySettled?.();
      }
    })();

    return () => {
      abortController.abort();
    };
  }, [
    agentStreamRecovery,
    applyAgentChatElementFreeze,
    clearAgentChatElementFreeze,
    isHistoryLoading,
    notifyStreamIdle,
    onAgentStreamRecoverySettled,
    onAssistantStreamEnd,
    onRecoverAgentStream,
    setMessages,
  ]);

  const handleSend = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || sendBlocked) return;
    if (hasActiveChatStream) {
      await interruptActiveStream();
    } else if (isAssistantBusy) {
      return;
    }
    userPinnedAwayFromBottomRef.current = false;
    pendingSendScrollRef.current = true;
    manualMarkSyncSkipRef.current = true;
    pendingManualMarkSessionRef.current = null;
    setChatInput("");
    onClearManualMarks?.();
    await submitUserChatText(text);
  }, [
    chatInput,
    hasActiveChatStream,
    interruptActiveStream,
    isAssistantBusy,
    onClearManualMarks,
    sendBlocked,
    submitUserChatText,
  ]);

  // Plan → Agent handoff: after switching to Agent mode, send the draft automatically in the current conversation.
  useEffect(() => {
    const handoff = pendingDraftHandoff;
    if (!handoff || panelMode !== "agent") return;
    if (handoff.token === consumedHandoffTokenRef.current) return;
    const draft = handoff.draft.trim();
    if (!draft) {
      consumedHandoffTokenRef.current = handoff.token;
      onDraftHandoffConsumed?.();
      return;
    }
    // Wait until the panel can send (history loaded / the previous stream ended) before sending automatically.
    if (sendBlocked || isSending || abortRef.current) return;
    consumedHandoffTokenRef.current = handoff.token;
    const message = buildPlanDraftHandoffMessage(
      t("coursewareEditor.aiPanel.plan.handoffInstruction"),
      draft,
    );
    setChatInput("");
    void submitUserChatText(message);
    onDraftHandoffConsumed?.();
  }, [
    pendingDraftHandoff,
    panelMode,
    sendBlocked,
    isSending,
    submitUserChatText,
    onDraftHandoffConsumed,
    t,
  ]);

  const applyAssetMentionAfterUpload = useCallback(
    (asset: CoursewareAssetItem) => {
      setLibraryAssets((prev) => [asset, ...prev.filter((a) => a.id !== asset.id)]);
      const el = textareaRef.current;
      if (el && activeMention) {
        const cursor = el.getSelection().start;
        const { text, cursor: nextCursor } = applyAssetMentionSelection(
          chatInput,
          activeMention.start,
          cursor,
          asset,
        );
        pendingCaretRef.current = nextCursor;
        setChatInput(text);
      } else {
        const token = formatAssetMentionDisplayToken(asset);
        setChatInput((prev) => {
          const t = prev.trim();
          const next = t ? `${t} ${token}` : token;
          pendingCaretRef.current = next.length;
          return next;
        });
      }
    },
    [activeMention, chatInput],
  );

  const uploadAttachmentFile = useCallback(
    async (file: File): Promise<void> => {
      if (!coursewareId?.trim()) {
        toast.error(t("coursewareEditor.aiPanel.toast.missingCoursewareIdAttach"));
        return;
      }
      const ext = attachmentFileExtension(file);
      if (!ext || !isAttachmentExtensionAccepted(ext)) {
        toast.error(t("coursewareEditor.aiPanel.toast.unsupportedAttachType"));
        return;
      }
      setIsAttaching(true);
      try {
        const uploadFile = fileForAttachmentUpload(file, ext);
        const { asset } = await coursewareAssetsApi.uploadAsset(coursewareId, uploadFile, {
          language,
        });
        toast.success(t("coursewareEditor.toast.uploadSuccessSingle", { name: asset.name }));
        applyAssetMentionAfterUpload(asset);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t("coursewareEditor.toast.uploadFailed"),
        );
      } finally {
        setIsAttaching(false);
      }
    },
    [applyAssetMentionAfterUpload, coursewareId, t],
  );

  const handleClearHistoryClick = useCallback(async () => {
    if (!onClearHistory || isClearing || busy) return;
    if (!window.confirm(t("coursewareEditor.aiPanel.clearHistoryConfirm"))) {
      return;
    }
    if (abortRef.current) {
      userAbortedStreamRef.current = true;
      abortRef.current.abort();
    }
    setIsClearing(true);
    try {
      await onClearHistory();
      if (!controlled) {
        setInternalMessages([]);
      }
    } finally {
      setIsClearing(false);
    }
  }, [busy, controlled, isClearing, onClearHistory, t]);

  const handleAgentModelChange = useCallback((id: CoursewareAgentChatModelId) => {
    setAgentModelId(id);
    writeStoredCoursewareAgentChatModelId(id);
  }, []);

  const handleAttachmentChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      await uploadAttachmentFile(file);
    },
    [uploadAttachmentFile],
  );

  /** Only the bottom input area (this node's subtree) responds to drag and drop; the bubble phase avoids wrongly covering the whole conversation area */
  const handleAgentFileDropZoneDragEnter = useCallback(
    (e: DragEvent<HTMLDivElement>): void => {
      if (!dataTransferHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = !coursewareId?.trim() ? "none" : "copy";
      setIsFileDragOverAgent(true);
    },
    [coursewareId],
  );

  const handleAgentFileDropZoneDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>): void => {
      if (!dataTransferHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = !coursewareId?.trim() ? "none" : "copy";
    },
    [coursewareId],
  );

  const handleAgentFileDropZoneDragLeave = useCallback((e: DragEvent<HTMLDivElement>): void => {
    const rel = e.relatedTarget as Node | null;
    if (rel && e.currentTarget.contains(rel)) return;
    setIsFileDragOverAgent(false);
  }, []);

  const handleAgentFileDropZoneDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>): Promise<void> => {
      if (!dataTransferHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      setIsFileDragOverAgent(false);
      const files = getFilesFromDataTransfer(e.dataTransfer);
      for (const file of files) {
        await uploadAttachmentFile(file);
      }
    },
    [uploadAttachmentFile],
  );

  const handleTextareaPaste = useCallback(
    (e: ClipboardEvent<HTMLDivElement>): void => {
      const files = getFilesFromDataTransfer(e.clipboardData);
      if (files.length === 0) return;
      e.preventDefault();
      void (async () => {
        for (const file of files) {
          await uploadAttachmentFile(file);
        }
      })();
    },
    [uploadAttachmentFile],
  );

  return (
    <div
      data-hotkey-scope="ai-chat"
      className={`courseware-editor-ai-panel relative flex h-full min-h-0 flex-col bg-white dark:bg-slate-950/30 transition-shadow duration-150 ${className} ${
        isFileDragOverAgent && fileDropAllowed
          ? "ring-2 ring-inset ring-violet-500/50"
          : isFileDragOverAgent
            ? "ring-2 ring-inset ring-slate-400/50 dark:ring-slate-600/45"
            : ""
      }`}
      onDragEnter={handleAgentFileDropZoneDragEnter}
      onDragOver={handleAgentFileDropZoneDragOver}
      onDragLeave={handleAgentFileDropZoneDragLeave}
      onDrop={(e) => void handleAgentFileDropZoneDrop(e)}
    >

      <div className="courseware-editor-ai-panel-head shrink-0 border-b border-slate-200 bg-white px-3.5 py-2.5 dark:border-slate-800/90 dark:bg-slate-900/70">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            {onPanelModeChange ? (
              <div
                role="tablist"
                aria-label={t("coursewareEditor.aiPanel.mode.agent")}
                className="inline-flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800/70"
              >
                {(["plan", "agent"] as const).map((m) => {
                  const active = panelMode === m;
                  const label =
                    m === "agent"
                      ? t("coursewareEditor.aiPanel.mode.agent")
                      : t("coursewareEditor.aiPanel.mode.plan");
                  const hint =
                    m === "agent"
                      ? t("coursewareEditor.aiPanel.mode.agentHint")
                      : t("coursewareEditor.aiPanel.mode.planHint");
                  return (
                    <button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      title={hint}
                      disabled={sessionSwitchBlocked && !active}
                      onClick={() => {
                        if (active) return;
                        if (sessionSwitchBlocked) {
                          notifySessionSwitchBlocked();
                          return;
                        }
                        onPanelModeChange(m);
                      }}
                      className={`inline-flex h-6 items-center gap-1 rounded-[7px] px-2.5 text-xs font-bold transition ${
                        active
                          ? "bg-white text-blue-600 shadow-sm dark:bg-slate-900 dark:text-blue-300"
                          : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                      }`}
                    >
                      {m === "plan" ? (
                        <PenTool className="h-3 w-3" aria-hidden />
                      ) : (
                        <Bot className="h-3 w-3" aria-hidden />
                      )}
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div
                className="truncate text-sm font-extrabold text-slate-900 dark:text-slate-50"
                title={resolvedSessionTitle}
              >
                {resolvedSessionTitle}
              </div>
            )}
          </div>
          <div className="relative shrink-0" ref={historyMenuWrapRef}>
            <button
              type="button"
              className={`inline-flex h-[30px] items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-bold transition ${
                historyMenuOpen
                  ? "border-blue-500 bg-slate-800 text-blue-50 dark:border-blue-500 dark:bg-slate-800"
                  : "border-slate-300 bg-slate-50 text-slate-600 hover:border-slate-400 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800"
              }`}
              onClick={() => setHistoryMenuOpen((open) => !open)}
              aria-expanded={historyMenuOpen}
              aria-haspopup="menu"
            >
              <History className="h-3.5 w-3.5" aria-hidden />
              {t("coursewareEditor.aiPanel.history")}
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </button>
            {historyMenuOpen ? (
              <div
                role="menu"
                className="absolute right-0 top-full z-[68] mt-2 w-[min(310px,calc(100vw-32px))] overflow-hidden rounded-xl border border-slate-700 bg-[#0b1220] shadow-[0_18px_38px_rgba(0,0,0,0.38)]"
              >
                <div className="grid gap-0.5 border-b border-slate-800 bg-[#101827] px-3 py-2.5">
                  <div className="text-[13px] font-extrabold leading-tight text-slate-50">
                    {t("coursewareEditor.aiPanel.historyTitle")}
                  </div>
                  <div className="text-[11px] font-semibold leading-snug text-slate-400">
                    {sessionSwitchBlocked
                      ? t("coursewareEditor.aiPanel.sessionSwitchBlockedHint")
                      : isPlanMode
                        ? t("coursewareEditor.aiPanel.plan.historySubtitle")
                        : t("coursewareEditor.aiPanel.historySubtitle")}
                  </div>
                </div>
                <div className="grid gap-0.5 p-1.5">
                  {sortedAgentSessions.map((session) => {
                    const sessionItemDisabled = !session.isActive && sessionSwitchBlocked;
                    return (
                    <button
                      key={session.id}
                      type="button"
                      role="menuitem"
                      aria-selected={session.isActive}
                      aria-disabled={sessionItemDisabled}
                      disabled={sessionItemDisabled}
                      title={
                        sessionItemDisabled
                          ? t("coursewareEditor.aiPanel.sessionSwitchBlocked")
                          : undefined
                      }
                      className={`flex w-full items-start gap-2 rounded-[9px] px-2 py-2 text-left transition ${
                        session.isActive
                          ? "bg-slate-900/90"
                          : sessionItemDisabled
                            ? "cursor-not-allowed opacity-50"
                            : "bg-transparent hover:bg-slate-900/70 focus-visible:bg-slate-900/70"
                      }`}
                      onClick={() => {
                        if (session.isActive) {
                          setHistoryMenuOpen(false);
                          return;
                        }
                        if (sessionSwitchBlocked) {
                          notifySessionSwitchBlocked();
                          return;
                        }
                        handleAgentSessionSelect(session.id);
                        setHistoryMenuOpen(false);
                      }}
                    >
                      <span
                        className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] ${
                          session.isActive
                            ? "bg-blue-600/20 text-blue-300"
                            : "bg-blue-600/15 text-blue-300"
                        }`}
                        aria-hidden
                      >
                        {session.isActive ? (
                          <PencilLine className="h-3.5 w-3.5" />
                        ) : (
                          <History className="h-3.5 w-3.5" />
                        )}
                      </span>
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-xs font-extrabold text-slate-100">
                            {session.title}
                          </span>
                          {session.isActive ? (
                            <span className="shrink-0 rounded-full border border-blue-400/45 bg-blue-600/15 px-1.5 py-0.5 text-[10px] font-extrabold leading-none text-blue-200">
                              {t("coursewareEditor.aiPanel.currentBadge")}
                            </span>
                          ) : null}
                        </span>
                        <span className="text-[11px] font-semibold leading-tight text-slate-400">
                          {formatSessionMeta(session)}
                        </span>
                      </span>
                    </button>
                    );
                  })}
                </div>
                {onAgentSessionCreate ? (
                  <div className="border-t border-slate-800 px-2 py-2">
                    <button
                      type="button"
                      className="h-7 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-[11px] font-bold text-slate-200 transition hover:border-blue-500 hover:bg-slate-800 hover:text-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={sessionSwitchBlocked}
                      title={
                        sessionSwitchBlocked
                          ? t("coursewareEditor.aiPanel.sessionSwitchBlocked")
                          : undefined
                      }
                      onClick={() => {
                        handleAgentSessionCreate();
                        if (!sessionSwitchBlocked) setHistoryMenuOpen(false);
                      }}
                    >
                      {t("coursewareEditor.aiPanel.createSession")}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <DeletePageConfirmBubble
        open={deleteConfirmRect !== null}
        anchorRect={deleteConfirmRect}
        themeMode={themeMode}
        onCancel={() => setDeleteConfirmRect(null)}
        onConfirm={() => {
          onDeleteCurrentSlide();
          setDeleteConfirmRect(null);
        }}
      />

      {activityItems && activityItems.length > 0 ? (
        <div className="courseware-editor-ai-activity shrink-0 border-b border-slate-200 dark:border-slate-800/80 px-3.5 py-2">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-700 dark:text-slate-300">
            {t("coursewareEditor.aiPanel.activityTitle")}
          </p>
          <ul className="max-h-20 space-y-1 overflow-y-auto text-[11px] text-slate-400 dark:text-slate-500">
            {activityItems.map((item) => (
              <li key={item.id} className="flex gap-1.5 leading-snug">
                <span className="shrink-0 text-slate-700 dark:text-slate-300">·</span>
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div
        ref={logScrollRef}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3.5 py-3 [scrollbar-gutter:stable]"
        role="log"
        aria-label={t("coursewareEditor.aiPanel.chatLogAria")}
        aria-relevant="additions"
        onScroll={handleLogScroll}
        onWheel={handleLogWheel}
      >
        <div className={messages.length === 0 ? "min-w-0 h-full" : "min-w-0"}>
          {messages.length === 0 ? (
            <div className="courseware-editor-ai-empty flex h-full flex-col items-center justify-center gap-3 rounded-xl bg-white/65 dark:bg-slate-900/20 px-4 py-8 text-center">
              {isHistoryLoading ? (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-slate-400 dark:text-slate-500" aria-hidden />
                  <p className="text-sm text-slate-400 dark:text-slate-500">
                    {t("coursewareEditor.aiPanel.loadingHistory")}
                  </p>
                </>
              ) : isPlanMode ? (
                <>
                  <div className="flex h-20 w-20 items-center justify-center rounded-2xl text-blue-500 dark:text-blue-300">
                    <PenTool className="h-10 w-10" aria-hidden />
                  </div>
                  <div className="max-w-[260px] space-y-1.5">
                    <p className="text-md font-semibold text-slate-600 dark:text-slate-300">
                      {t("coursewareEditor.aiPanel.plan.greetingTitle")}
                    </p>
                    <p className="text-xs font-medium leading-relaxed text-slate-400 dark:text-slate-500">
                      {t("coursewareEditor.aiPanel.plan.greetingSubtitle")}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="">
                    <img src="/AINOBI-Agent.svg" alt="Assistant" className="h-46 w-46" />
                  </div>
                  <div className="max-w-[240px] -mt-5">
                    <p className="text-md font-medium text-slate-400 dark:text-slate-500">{emptyGreetingLine}</p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <ul className="space-y-3">
              {!olderRoundsRevealed && hiddenRoundCount > 0 ? (
                <li className="flex min-w-0 justify-center">
                  <button
                    type="button"
                    onClick={revealOlderChatRounds}
                    className="w-full rounded-xl border border-dashed border-slate-400 dark:border-slate-600/80 bg-white dark:bg-slate-900/50 px-3 py-2.5 text-center text-[11px] leading-snug text-slate-400 dark:text-slate-500 transition hover:border-violet-400/50 dark:hover:border-violet-500/40 hover:bg-slate-100/90 dark:hover:bg-slate-800/60 hover:text-slate-800 dark:hover:text-slate-200"
                  >
                    {t("coursewareEditor.aiPanel.hiddenRounds", {
                      rounds: hiddenRoundCount,
                      messages: hiddenMessageCount,
                    })}
                    <span className="mt-0.5 block text-[10px] text-slate-400 dark:text-slate-500">
                      {t("coursewareEditor.aiPanel.revealOlderHint")}
                    </span>
                  </button>
                </li>
              ) : null}
              {visibleMessages.map((m, localIndex) => {
                const index = visibleStartIndex + localIndex;
                const isLast = index === messages.length - 1;
                /** Only while the local SSE is in progress; don't use the broad busy, or the shimmer would trigger through isAssistantBusy etc. after the stream ended */
                const assistantStreamInFlight =
                  m.role === "assistant" &&
                  isLast &&
                  (isSending || streamPhase === "connecting" || streamPhase === "streaming");
                return (
                  <AiPanelChatMessageRow
                    key={m.id}
                    message={m}
                    isLastInFullList={isLast}
                    assistantStreamInFlight={assistantStreamInFlight}
                    busy={busy}
                    libraryAssets={mentionDisplayLibrary}
                    onSubmitAgentUserQuestion={handleSubmitAgentUserQuestion}
                    onContinueMaxTurns={() =>
                      void submitUserChatText(t("coursewareEditor.aiPanel.continueCommand"))
                    }
                    onClearHistory={onClearHistory ? handleClearHistoryClick : undefined}
                    showStartMaking={
                      isPlanMode &&
                      !!onStartMakingWithDraft &&
                      m.role === "assistant" &&
                      isLast &&
                      !assistantStreamInFlight &&
                      !!latestAssistantDraft
                    }
                    onStartMaking={handleStartMakingClick}
                    onOpenDraft={setDraftModalContent}
                  />
                );
              })}
              {busy ? (
                <li className="flex min-w-0 justify-start">
                  <div className="courseware-editor-ai-busy flex items-center gap-2 rounded-2xl border border-slate-300 dark:border-slate-700/80 bg-slate-100 dark:bg-slate-800/50 px-3 py-2 text-[11px] text-slate-400 dark:text-slate-500 mb-5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    {t("coursewareEditor.aiPanel.processing")}
                  </div>
                </li>
              ) : null}
            </ul>
          )}
        </div>
      </div>

      <div className="courseware-editor-ai-panel-footer shrink-0 overflow-visible border-t border-slate-200 dark:border-slate-800/90 bg-white dark:bg-slate-900/50 p-3">
        <div className="flex flex-col gap-2">
          {pendingManualMark && onConfirmPendingManualMark && onCancelPendingManualMark ? (
            <CoursewareManualMarkInputBubble
              key={pendingManualMark.markId}
              markIndex={manualMarkRegions.length + 1}
              onCancel={onCancelPendingManualMark}
              onConfirm={onConfirmPendingManualMark}
            />
          ) : null}
          <div
            ref={textareaWrapRef}
            className="relative rounded-xl border border-slate-300 dark:border-slate-700/90 focus-within:border-violet-500/40 focus-within:ring-1 focus-within:ring-violet-500/25"
          >
            <AiPanelHighlightComposer
              ref={textareaRef}
              value={chatInput}
              onChange={setChatInput}
              onCaretChange={setCaretPos}
              libraryAssets={mentionDisplayLibrary}
              placeholder={
                isPlanMode ? (
                  t("coursewareEditor.aiPanel.plan.inputPlaceholder")
                ) : (
                  <>
                    {t("coursewareEditor.aiPanel.input.contextOnPage")}
                    <span className="mx-1 font-bold text-gray-500">
                      {t("coursewareEditor.aiPanel.input.pageNumber", {
                        page: selectedSlideIndex + 1,
                      })}
                    </span>
                    {selectedCanvasCount > 0 ? (
                      <>
                        {t("coursewareEditor.aiPanel.input.selectedSeparator")}
                        <span className="mx-1 font-bold text-violet-400/90">
                          {t("coursewareEditor.aiPanel.input.selectedCount", {
                            count: selectedCanvasCount,
                          })}
                        </span>
                      </>
                    ) : null}
                    {t("coursewareEditor.aiPanel.input.promptSuffix")}
                  </>
                )
              }
              onCompositionStart={() => {
                isInputComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                requestAnimationFrame(() => {
                  isInputComposingRef.current = false;
                });
              }}
              onKeyDown={(e) => {
                const inputComposing = e.nativeEvent.isComposing || isInputComposingRef.current;
                if (mentionOpen && mentionCandidates.length > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setMentionHighlight((i) => (i + 1) % mentionCandidates.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setMentionHighlight(
                      (i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length,
                    );
                    return;
                  }
                  if ((e.key === "Enter" || e.key === "Tab") && !inputComposing) {
                    e.preventDefault();
                    const asset = mentionCandidates[mentionHighlight];
                    if (asset) selectMentionAsset(asset);
                    return;
                  }
                }
                if (e.key === "Escape" && mentionOpen) {
                  e.preventDefault();
                  closeActiveResourceMention();
                  return;
                }
                if (e.key === "Escape" && templateLibraryBubbleOpen) {
                  e.preventDefault();
                  setTemplateLibraryBubbleOpen(false);
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey && !inputComposing) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              onPaste={handleTextareaPaste}
              aria-label={t("coursewareEditor.aiPanel.input.ariaLabel")}
              aria-expanded={mentionOpen}
              aria-haspopup="dialog"
            />
          </div>
          {mentionOpen && mentionMenuPos ? (
            <AiPanelResourceBubble
              open={mentionOpen}
              themeMode={themeMode}
              position={mentionMenuPos}
              searchQuery={resourceBubbleSearch}
              onSearchQueryChange={updateResourceBubbleSearch}
              recentEntries={resourceRecentEntries}
              libraryCandidates={mentionCandidates}
              libraryAssets={libraryAssets}
              isUploading={isAttaching}
              onClose={closeActiveResourceMention}
              onPickExistingResources={() => {
                resourcePickerMentionStartRef.current = activeMention?.start ?? null;
                setResourceAssetPickerOpen(true);
              }}
              onSelectFile={() => {
                if (isAttaching) return;
                if (activeMention) {
                  resourcePickerMentionStartRef.current = activeMention.start;
                }
                attachInputRef.current?.click();
              }}
              onPickCourseware={() => openCoursewareLibraryPicker(activeMention?.start)}
              onPickRecent={pickResourceRecentEntry}
              onPickLibraryAsset={selectMentionAsset}
            />
          ) : null}
          {mentionPreviewAsset && mentionPreviewCoords ? (
            <MentionImagePreviewBubble
              asset={mentionPreviewAsset}
              coords={mentionPreviewCoords}
              themeMode={themeMode}
            />
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-visible">
              <input
                ref={attachInputRef}
                type="file"
                className="hidden"
                accept={ATTACH_ACCEPT}
                onChange={(e) => void handleAttachmentChange(e)}
              />
              <AiPanelFooterIconTooltip
                themeMode={themeMode}
                label={t("coursewareEditor.aiPanel.footer.mentionTooltip")}
              >
                <button
                  type="button"
                  onClick={insertAtTrigger}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 transition hover:border-slate-400 dark:hover:border-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
                  aria-label={t("coursewareEditor.aiPanel.footer.mentionAria")}
                >
                  <AtSign className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
                </button>
              </AiPanelFooterIconTooltip>
              <AiPanelFooterIconTooltip
                themeMode={themeMode}
                label={t("coursewareEditor.aiPanel.templateBubble.title")}
              >
                <button
                  ref={templateLibraryBtnRef}
                  type="button"
                  onClick={openTemplateLibraryBubble}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 transition hover:border-slate-400 dark:hover:border-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white"
                  aria-label={t("coursewareEditor.aiPanel.templateBubble.title")}
                  aria-expanded={templateLibraryBubbleOpen}
                >
                  <LayoutTemplate className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
                </button>
              </AiPanelFooterIconTooltip>
              {onManualMarkModeToggle ? (
                <AiPanelFooterIconTooltip
                  themeMode={themeMode}
                  label={
                    manualMarkModeActive
                      ? t("coursewareEditor.aiPanel.footer.manualMarkExit")
                      : t("coursewareEditor.aiPanel.footer.manualMarkEnter")
                  }
                >
                  <button
                    type="button"
                    onClick={onManualMarkModeToggle}
                    className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ${
                      manualMarkModeActive
                        ? "bg-rose-600/35 text-rose-100 ring-1 ring-rose-500/50 hover:bg-rose-600/50"
                        : "text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-white"
                    }`}
                    aria-label={t("coursewareEditor.aiPanel.footer.manualMarkAria")}
                    aria-pressed={manualMarkModeActive}
                  >
                    <PenTool className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
                  </button>
                </AiPanelFooterIconTooltip>
              ) : null}
              {onClearHistory ? (
                <AiPanelFooterIconTooltip
                  themeMode={themeMode}
                  label={t("coursewareEditor.aiPanel.clearHistoryTitle")}
                >
                  <button
                    type="button"
                    onClick={() => void handleClearHistoryClick()}
                    disabled={busy}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-600 dark:text-slate-300 transition hover:border-slate-400 dark:hover:border-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={t("coursewareEditor.aiPanel.clearHistoryTitle")}
                  >
                    {isClearing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Eraser className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
                    )}
                  </button>
                </AiPanelFooterIconTooltip>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
            <AiPanelModelSelector
              themeMode={themeMode}
              value={selectedAgentModel}
              disabled={busy}
              onChange={handleAgentModelChange}
            />
            <button
              type="button"
              onClick={() => {
                if (canAbortStream && !chatInput.trim()) {
                  void interruptActiveStream();
                  return;
                }
                void handleSend();
              }}
              disabled={sendBlocked || (!chatInput.trim() && !canAbortStream)}
              title={
                canAbortStream && !chatInput.trim()
                  ? t("coursewareEditor.aiPanel.abortTitle")
                  : hasActiveChatStream && chatInput.trim()
                    ? t("coursewareEditor.aiPanel.abortAndSendTitle")
                    : t("coursewareEditor.aiPanel.send")
              }
              aria-label={
                canAbortStream && !chatInput.trim()
                  ? t("coursewareEditor.aiPanel.abort")
                  : isSending && !(chatInput.trim() && hasActiveChatStream)
                    ? t("coursewareEditor.aiPanel.sending")
                    : t("coursewareEditor.aiPanel.send")
              }
              className={
                canAbortStream && !chatInput.trim()
                  ? "courseware-editor-ai-send-abort inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-600 text-white shadow-sm transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                  : "courseware-editor-ai-send-btn inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white shadow-sm transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-200 dark:disabled:bg-slate-700 disabled:text-slate-500"
              }
            >
              {canAbortStream && !chatInput.trim() ? (
                <OctagonPause className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
              ) : isSending && !(chatInput.trim() && hasActiveChatStream) ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <ArrowUp className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden />
              )}
            </button>
            </div>
          </div>
        </div>
      </div>

      {isFileDragOverAgent ? (
        <div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-4"
          aria-hidden
        >
          <div
            className={`absolute inset-3 rounded-xl border-2 border-dashed motion-safe:animate-pulse ${
              fileDropAllowed
                ? "border-violet-400/90 bg-violet-500/10 shadow-[inset_0_0_0_1px_rgba(167,139,250,0.1)]"
                : "border-slate-400 dark:border-slate-500/75 bg-slate-950/40"
            }`}
          />
          <div className="relative z-10 flex max-w-[min(92%,300px)] flex-col items-center gap-2 text-center">
            <Upload
              className={`h-9 w-9 shrink-0 ${fileDropAllowed ? "text-violet-300" : "text-slate-500"}`}
              strokeWidth={1.75}
              aria-hidden
            />
            <p
              className={`text-sm font-semibold leading-tight ${
                fileDropAllowed ? "text-violet-50" : "text-slate-400"
              }`}
            >
              {fileDropAllowed
                ? t("coursewareEditor.aiPanel.drop.allowedTitle")
                : t("coursewareEditor.aiPanel.drop.genericTitle")}
            </p>
            <p
              className={`text-[11px] leading-snug ${fileDropAllowed ? "text-violet-200/85" : "text-slate-500"}`}
            >
              {fileDropAllowed
                ? t("coursewareEditor.aiPanel.drop.allowedHint")
                : busy
                  ? t("coursewareEditor.aiPanel.drop.busyHint")
                  : t("coursewareEditor.aiPanel.drop.noCoursewareId")}
            </p>
          </div>
        </div>
      ) : null}
      {draftModalContent ? (
        <PlanDraftModal draft={draftModalContent} onClose={() => setDraftModalContent(null)} />
      ) : null}
      <CoursewareLibraryPickerModal
        open={coursewareLibraryPickerOpen}
        themeMode={themeMode}
        excludeCoursewareId={coursewareId}
        sectionCourseId={sectionCourseId}
        orgId={orgId}
        onClose={() => {
          coursewarePickerMentionStartRef.current = null;
          setCoursewareLibraryPickerOpen(false);
        }}
        onPick={selectReferencedCourseware}
      />
      <DesignTemplatePickerModal
        open={designTemplatePickerOpen}
        themeMode={themeMode}
        orgId={orgId}
        onClose={() => {
          designTemplatePickerMentionStartRef.current = null;
          setFocusDesignTemplateId(null);
          setDesignTemplatePickerOpen(false);
        }}
        onPick={selectReferencedDesignTemplate}
        onExtractNew={() => setExtractDesignTemplateOpen(true)}
        listRefreshKey={designTemplateListRefreshKey}
        focusTemplateId={focusDesignTemplateId}
        onDeleted={() => setResourceRecentsTick((n) => n + 1)}
      />
      <ExtractDesignTemplateModal
        open={extractDesignTemplateOpen}
        themeMode={themeMode}
        orgId={orgId}
        coursewareId={coursewareId}
        sectionCourseId={sectionCourseId}
        onClose={() => setExtractDesignTemplateOpen(false)}
        onExtracted={(item) => {
          selectReferencedDesignTemplate(item);
          setFocusDesignTemplateId(item.id);
          setDesignTemplateListRefreshKey((key) => key + 1);
        }}
      />
      <ContentTemplatePickerModal
        open={contentTemplatePickerOpen}
        themeMode={themeMode}
        orgId={orgId}
        onClose={() => {
          contentTemplatePickerMentionStartRef.current = null;
          setFocusContentTemplateId(null);
          setContentTemplatePickerOpen(false);
        }}
        onPick={selectReferencedContentTemplate}
        onExtractNew={() => setExtractContentTemplateOpen(true)}
        listRefreshKey={contentTemplateListRefreshKey}
        focusTemplateId={focusContentTemplateId}
        onDeleted={() => setResourceRecentsTick((n) => n + 1)}
      />
      <ExtractContentTemplateModal
        open={extractContentTemplateOpen}
        themeMode={themeMode}
        orgId={orgId}
        coursewareId={coursewareId}
        sectionCourseId={sectionCourseId}
        onClose={() => setExtractContentTemplateOpen(false)}
        onExtracted={(item) => {
          selectReferencedContentTemplate(item);
          setFocusContentTemplateId(item.id);
          setContentTemplateListRefreshKey((key) => key + 1);
        }}
      />
      <CoursewareExtractableAssetPickerModal
        open={resourceAssetPickerOpen}
        themeMode={themeMode}
        coursewareId={coursewareId}
        onClose={() => {
          resourcePickerMentionStartRef.current = null;
          setResourceAssetPickerOpen(false);
        }}
        onPick={(asset) => {
          const start = resourcePickerMentionStartRef.current;
          setResourceAssetPickerOpen(false);
          insertAssetMention(asset, start);
        }}
      />
      <AiPanelTemplateLibraryBubble
        open={templateLibraryBubbleOpen}
        themeMode={themeMode}
        anchorRect={templateLibraryAnchor}
        recentEntries={templateRecentEntries}
        onClose={() => setTemplateLibraryBubbleOpen(false)}
        onOpenDesignLibrary={() => openDesignTemplatePicker()}
        onOpenContentLibrary={() => openContentTemplatePicker()}
        onPickRecent={pickTemplateRecentEntry}
      />
    </div>
  );
}
