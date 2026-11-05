// SPDX-License-Identifier: AGPL-3.0-only
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Loader2,
  Minus,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "../../host/auth.ts";
import { useI18nNew } from "../../hooks/useI18nNew.tsx";
import config from "../../host/config.ts";
import logger from "../../host/logger.ts";
import { parseAiAssistantContent } from "../../lib/courseware/ai-assistant-content.ts";
import { ChatMarkdownRenderer } from "../MarkdownRenderer.tsx";
import {
  isTodoToolAssistantBlock,
  isAskUserQuestionToolAssistantBlock,
  isAskUserQuestionProcessOptionLabel,
  pickAssistantOpsCardTitle,
  type CoursewareAgentTodoItem,
  type CoursewareAgentUserQuestion,
  type CoursewareAiAssistantBlock,
} from "../../api/courseware_agent.ts";

const OPS_TITLE_MS = 280;
const SMOOTH_SCROLL_EASING = 0.24;

type SmoothScrollRunner = { raf: number };

type AssistantRenderSegment =
  | { kind: "prose"; text: string }
  | { kind: "insufficient_org_credits" }
  | { kind: "insufficient_personal_credits" }
  | { kind: "agent_context_reset_required" }
  | { kind: "todos"; items: CoursewareAgentTodoItem[] }
  | {
      kind: "user_question";
      requestId: string;
      toolUseId: string;
      questions: CoursewareAgentUserQuestion[];
      answered?: boolean;
      expired?: boolean;
    }
  | { kind: "tools"; tools: Extract<CoursewareAiAssistantBlock, { type: "tool" }>[] };

function userQuestionRenderKey(questions: readonly CoursewareAgentUserQuestion[]): string {
  return questions
    .map((q) => {
      const optionsSig = q.options
        .map((o) => `${o.label}|${o.description ?? ""}|${o.preview ?? ""}`)
        .join("||");
      return [
        q.header,
        q.question,
        q.multiSelect ? "multi" : "single",
        q.freeText ? "freeText" : "choice",
        optionsSig,
      ].join("::");
    })
    .join("\n---\n");
}

function prefersReducedScrollMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function cancelSmoothScroll(state: SmoothScrollRunner): void {
  if (state.raf !== 0) {
    cancelAnimationFrame(state.raf);
    state.raf = 0;
  }
}

function smoothScrollTowardBottom(
  el: HTMLElement,
  state: SmoothScrollRunner,
  options?: { easing?: number; epsilon?: number },
): void {
  if (prefersReducedScrollMotion()) {
    cancelSmoothScroll(state);
    el.scrollTop = el.scrollHeight;
    return;
  }

  if (state.raf !== 0) return;

  const easing = options?.easing ?? SMOOTH_SCROLL_EASING;
  const epsilon = options?.epsilon ?? 0.75;

  const step = (): void => {
    const target = Math.max(0, el.scrollHeight - el.clientHeight);
    const gap = target - el.scrollTop;
    if (Math.abs(gap) <= epsilon) {
      el.scrollTop = target;
      state.raf = 0;
      return;
    }
    el.scrollTop += gap * easing;
    state.raf = requestAnimationFrame(step);
  };

  state.raf = requestAnimationFrame(step);
}

function blocksToRenderSegments(blocks: readonly CoursewareAiAssistantBlock[]): AssistantRenderSegment[] {
  const segments: AssistantRenderSegment[] = [];
  for (const block of blocks) {
    if (block.type === "prose") {
      segments.push({ kind: "prose", text: block.text });
      continue;
    }
    if (block.type === "insufficient_org_credits") {
      segments.push({ kind: "insufficient_org_credits" });
      continue;
    }
    if (block.type === "insufficient_personal_credits") {
      segments.push({ kind: "insufficient_personal_credits" });
      continue;
    }
    if (block.type === "agent_context_reset_required") {
      segments.push({ kind: "agent_context_reset_required" });
      continue;
    }
    if (block.type === "todos") {
      if (block.items.length > 0) {
        segments.push({ kind: "todos", items: block.items });
      }
      continue;
    }
    if (block.type === "user_question") {
      segments.push({
        kind: "user_question",
        requestId: block.requestId,
        toolUseId: block.toolUseId,
        questions: block.questions,
        answered: block.answered,
        expired: block.expired,
      });
      continue;
    }
    if (isTodoToolAssistantBlock(block)) continue;
    if (isAskUserQuestionToolAssistantBlock(block)) continue;
    const last = segments[segments.length - 1];
    if (last?.kind === "tools") {
      last.tools.push(block);
    } else {
      segments.push({ kind: "tools", tools: [block] });
    }
  }
  return segments;
}

export function buildAssistantPanelSegments(
  content: string,
  blocks: readonly CoursewareAiAssistantBlock[] | undefined,
): AssistantRenderSegment[] {
  if (blocks && blocks.length > 0) return blocksToRenderSegments(blocks);
  return parseAiAssistantContent(content).map((seg) =>
    seg.kind === "prose"
      ? { kind: "prose" as const, text: seg.text }
      : {
          kind: "tools" as const,
          tools: seg.ops.map((op, index) => ({
            type: "tool" as const,
            id: `${op.title}-${index}`,
            toolName: op.toolName,
            title: op.title,
            command: op.lines
              .find((line) => /^\s*\$/.test(line))
              ?.trim()
              .replace(/^\$\s?/, ""),
            output: op.lines
              .filter((line) => /^\s*→/.test(line))
              .map((line) => line.trim().replace(/^→\s?/, ""))
              .join("\n"),
          })),
        },
  );
}

export function assistantPanelBubbleHasVisibleBody(
  content: string,
  blocks: readonly CoursewareAiAssistantBlock[] | undefined,
): boolean {
  const segments = buildAssistantPanelSegments(content, blocks);
  return segments.length > 0 || content.trim().length > 0;
}

function buildManageOrganizationUrl(accessToken: string | undefined | null): string {
  const manageBase = config.origin.manage.replace(/\/+$/, "");
  const path = "/organization";
  if (accessToken?.trim()) {
    const token = encodeURIComponent(accessToken.trim());
    return `${manageBase}${path}?session=${token}`;
  }
  return `${manageBase}${path}`;
}

const AiAssistantOpsCardTitle = memo(function AiAssistantOpsCardTitle({
  title,
  shimmer,
}: {
  title: string;
  shimmer?: boolean;
}) {
  const prevTitleRef = useRef(title);
  const [wheel, setWheel] = useState<{ from: string; to: string; active: boolean } | null>(null);
  const shimmerClass = shimmer ? "courseware-editor-ai-ops-title-shimmer" : "";

  useLayoutEffect(() => {
    if (title === prevTitleRef.current) return;
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = prevTitleRef.current;
    prevTitleRef.current = title;
    if (reduceMotion) {
      setWheel(null);
      return;
    }
    setWheel({ from, to: title, active: false });
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setWheel((current) => (current ? { ...current, active: true } : current));
      });
    });
    const timer = window.setTimeout(() => setWheel(null), OPS_TITLE_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [title]);

  if (!wheel) {
    return (
      <span className="block h-5 min-w-0 flex-1 truncate text-left text-[11px] leading-5 font-medium text-slate-800 dark:text-slate-200">
        {shimmerClass ? <span className={shimmerClass}>{title}</span> : title}
      </span>
    );
  }

  return (
    <span className="block h-5 min-w-0 flex-1 overflow-hidden text-left" aria-live="polite">
      <span
        className="block ease-out will-change-transform motion-reduce:transition-none"
        style={{
          transform: wheel.active ? "translateY(-50%)" : "translateY(0)",
          transition: `transform ${OPS_TITLE_MS}ms ease-out`,
        }}
      >
        <span
          className={`block h-5 truncate text-left text-[11px] leading-5 font-medium motion-reduce:opacity-100 ${shimmerClass ? "" : "text-slate-800 dark:text-slate-200"}`}
          style={{
            opacity: wheel.active ? 0 : 1,
            transition: `opacity ${OPS_TITLE_MS}ms ease-out`,
          }}
        >
          {shimmerClass ? <span className={shimmerClass}>{wheel.from}</span> : wheel.from}
        </span>
        <span
          className={`block h-5 truncate text-left text-[11px] leading-5 font-medium motion-reduce:opacity-100 ${shimmerClass ? "" : "text-slate-800 dark:text-slate-200"}`}
          style={{
            opacity: wheel.active ? 1 : 0.35,
            transition: `opacity ${OPS_TITLE_MS}ms ease-out`,
          }}
        >
          {shimmerClass ? <span className={shimmerClass}>{wheel.to}</span> : wheel.to}
        </span>
      </span>
    </span>
  );
});

const AiAssistantUserQuestionCard = memo(function AiAssistantUserQuestionCard({
  requestId,
  questions,
  answered = false,
  expired = false,
  onSubmit,
  /** Student practice (home/preview): strip flow placeholders and hide option subtitles, to avoid spoilers */
  practiceQuiz = false,
}: {
  requestId: string;
  questions: readonly CoursewareAgentUserQuestion[];
  answered?: boolean;
  expired?: boolean;
  onSubmit?: (args: { requestId: string; answers: Record<string, string> }) => void | Promise<void>;
  practiceQuiz?: boolean;
}) {
  const { t } = useI18nNew();
  const [selections, setSelections] = useState<Record<string, string[]>>(() => ({}));
  const [otherActive, setOtherActive] = useState<Record<string, boolean>>(() => ({}));
  const [customTexts, setCustomTexts] = useState<Record<string, string>>(() => ({}));
  const [submitting, setSubmitting] = useState(false);

  const displayQuestions = useMemo(() => {
    return questions.map((q) => {
      if (q.freeText) return { ...q, options: [] as CoursewareAgentUserQuestion["options"] };
      if (!practiceQuiz) return q;
      const knowledgeOptions = q.options.filter(
        (o) => !isAskUserQuestionProcessOptionLabel(o.label),
      );
      if (knowledgeOptions.length < 2) {
        return { ...q, freeText: true, multiSelect: false, options: [] };
      }
      return knowledgeOptions.length === q.options.length ? q : { ...q, options: knowledgeOptions };
    });
  }, [practiceQuiz, questions]);

  const isQuestionAnswered = useCallback(
    (q: CoursewareAgentUserQuestion): boolean => {
      if (q.freeText) {
        return (customTexts[q.question] ?? "").trim().length > 0;
      }
      // Editor clarification questions: allow a custom "other" answer
      if (!practiceQuiz && otherActive[q.question]) {
        const custom = (customTexts[q.question] ?? "").trim();
        if (custom.length > 0) return true;
        const picked = selections[q.question];
        return q.multiSelect && Array.isArray(picked) && picked.length > 0;
      }
      const picked = selections[q.question];
      return Array.isArray(picked) && picked.length > 0;
    },
    [customTexts, otherActive, practiceQuiz, selections],
  );

  const allAnswered = useMemo(
    () => displayQuestions.every((q) => isQuestionAnswered(q)),
    [displayQuestions, isQuestionAnswered],
  );

  const toggleOption = useCallback((question: CoursewareAgentUserQuestion, label: string) => {
    setOtherActive((prev) => ({ ...prev, [question.question]: false }));
    setSelections((prev) => {
      const current = prev[question.question] ?? [];
      if (question.multiSelect) {
        const next = current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label];
        return { ...prev, [question.question]: next };
      }
      return { ...prev, [question.question]: [label] };
    });
  }, []);

  const activateOther = useCallback((question: CoursewareAgentUserQuestion) => {
    setOtherActive((prev) => ({ ...prev, [question.question]: true }));
    if (!question.multiSelect) {
      setSelections((prev) => ({ ...prev, [question.question]: [] }));
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!onSubmit || answered || expired || !allAnswered || submitting) return;
    const answers: Record<string, string> = {};
    for (const q of displayQuestions) {
      if (q.freeText) {
        const custom = (customTexts[q.question] ?? "").trim();
        if (custom) answers[q.question] = custom;
        continue;
      }
      const labels = selections[q.question] ?? [];
      const custom = (customTexts[q.question] ?? "").trim();
      if (!practiceQuiz && otherActive[q.question]) {
        const parts = [...labels];
        if (custom) parts.push(custom);
        if (parts.length > 0) answers[q.question] = parts.join(", ");
        continue;
      }
      if (labels.length === 0) continue;
      answers[q.question] = labels.join(", ");
    }
    setSubmitting(true);
    try {
      await onSubmit({ requestId, answers });
      // After success, stay disabled with "processing" until the parent sets answered to true
    } catch {
      setSubmitting(false);
    }
  }, [
    allAnswered,
    answered,
    customTexts,
    displayQuestions,
    expired,
    onSubmit,
    otherActive,
    practiceQuiz,
    requestId,
    selections,
    submitting,
  ]);

  useEffect(() => {
    if (answered) setSubmitting(false);
  }, [answered]);

  const locked = answered || submitting || expired;
  const processing = submitting;
  const submitted = answered;

  return (
    <div className="overflow-hidden rounded-xl border border-[#2F5C75]/30 bg-[rgba(47,92,117,0.06)] shadow-sm dark:border-[#2F5C75]/50 dark:bg-[rgba(47,92,117,0.22)]">
      <div className="border-b border-[#2F5C75]/20 bg-[rgba(47,92,117,0.1)] px-3 py-2 text-[11px] font-semibold tracking-wide text-[#2F5C75] dark:border-[#2F5C75]/35 dark:bg-[rgba(47,92,117,0.28)] dark:text-sky-100">
        {expired
          ? t("coursewareEditor.aiPanel.userQuestion.expired")
          : processing
            ? t("coursewareEditor.aiPanel.userQuestion.submitting")
            : submitted
              ? t("coursewareEditor.aiPanel.userQuestion.submitted")
              : t("coursewareEditor.aiPanel.userQuestion.confirmRequired")}
      </div>
      <div className="space-y-3.5 px-3 py-3">
        {displayQuestions.map((q) => (
          <fieldset key={`${requestId}-${q.header}-${q.question}`} className="min-w-0 space-y-2">
            <legend className="flex flex-wrap items-start gap-2 text-[13px] font-semibold leading-snug text-slate-900 dark:text-slate-100">
              <span className="shrink-0 rounded-md bg-[#2F5C75] px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">
                {q.header}
              </span>
              <span className="wrap-anywhere min-w-0 flex-1">{q.question}</span>
            </legend>
            {!q.freeText && q.options.length > 0 ? (
              <ul className="space-y-1.5">
                {q.options.map((opt) => {
                  const picked =
                    !(otherActive[q.question] && !practiceQuiz) &&
                    (selections[q.question] ?? []).includes(opt.label);
                  return (
                    <li key={opt.label}>
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() => toggleOption(q, opt.label)}
                        style={
                          picked
                            ? {
                                backgroundColor: "#2F5C75",
                                borderColor: "#2F5C75",
                                color: "#ffffff",
                              }
                            : undefined
                        }
                        className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition ${
                          picked
                            ? "shadow-md shadow-[#2F5C75]/25"
                            : "border-slate-200 bg-white text-slate-800 shadow-sm hover:border-[#2F5C75]/45 hover:bg-[rgba(47,92,117,0.04)] dark:border-slate-600 dark:bg-slate-900/70 dark:text-slate-100 dark:hover:border-[#2F5C75]/60"
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        <span
                          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                            picked
                              ? "border-white/90 bg-white/20 text-white"
                              : "border-slate-300 bg-white text-transparent dark:border-slate-500 dark:bg-slate-800"
                          }`}
                          aria-hidden
                        >
                          {picked ? <Check className="h-2.5 w-2.5 stroke-[3]" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                          <span
                            className={`text-[12px] font-semibold leading-snug ${
                              picked ? "text-white" : ""
                            }`}
                          >
                            {opt.label}
                          </span>
                          {!practiceQuiz && opt.description ? (
                            <span
                              className={`text-[11px] leading-snug ${
                                picked ? "text-white/90" : "text-slate-600 dark:text-slate-300"
                              }`}
                            >
                              {opt.description}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {!practiceQuiz ? (
                  <li>
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => activateOther(q)}
                      style={
                        otherActive[q.question]
                          ? {
                              backgroundColor: "#2F5C75",
                              borderColor: "#2F5C75",
                              color: "#ffffff",
                            }
                          : undefined
                      }
                      className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition ${
                        otherActive[q.question]
                          ? "shadow-md shadow-[#2F5C75]/25"
                          : "border-slate-200 bg-white text-slate-800 shadow-sm hover:border-[#2F5C75]/45 hover:bg-[rgba(47,92,117,0.04)] dark:border-slate-600 dark:bg-slate-900/70 dark:text-slate-100 dark:hover:border-[#2F5C75]/60"
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      <span className="min-w-0 flex-1 flex flex-col gap-0.5">
                        <span
                          className={`text-[12px] font-semibold leading-snug ${
                            otherActive[q.question] ? "text-white" : ""
                          }`}
                        >
                          {t("coursewareEditor.aiPanel.userQuestion.otherLabel")}
                        </span>
                        <span
                          className={`text-[11px] leading-snug ${
                            otherActive[q.question]
                              ? "text-white/90"
                              : "text-slate-600 dark:text-slate-300"
                          }`}
                        >
                          {t("coursewareEditor.aiPanel.userQuestion.otherHint")}
                        </span>
                      </span>
                    </button>
                  </li>
                ) : null}
              </ul>
            ) : null}
            {q.freeText || (!practiceQuiz && otherActive[q.question]) ? (
              <textarea
                className="w-full resize-y rounded-lg border border-[#2F5C75]/35 bg-white px-2.5 py-2 text-[12px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-[#2F5C75] focus:outline-none focus:ring-2 focus:ring-[#2F5C75]/25 disabled:opacity-60 dark:border-[#2F5C75]/50 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                rows={3}
                disabled={locked}
                placeholder={
                  q.freeText
                    ? t("coursewareEditor.aiPanel.userQuestion.answerPlaceholder")
                    : t("coursewareEditor.aiPanel.userQuestion.customPlaceholder")
                }
                value={customTexts[q.question] ?? ""}
                onChange={(e) =>
                  setCustomTexts((prev) => ({ ...prev, [q.question]: e.target.value }))
                }
              />
            ) : null}
          </fieldset>
        ))}
        {expired || submitted ? null : (
          <button
            type="button"
            disabled={!allAnswered || processing || !onSubmit}
            onClick={() => void handleSubmit()}
            style={
              processing
                ? { backgroundColor: "rgba(47,92,117,0.55)", color: "#ffffff" }
                : !allAnswered || !onSubmit
                  ? undefined
                  : { backgroundColor: "#2F5C75", color: "#ffffff" }
            }
            className="w-full rounded-lg px-3 py-2 text-[12px] font-semibold transition hover:brightness-95 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
          >
            {processing
              ? t("coursewareEditor.aiPanel.userQuestion.submitting")
              : t("coursewareEditor.aiPanel.userQuestion.confirmContinue")}
          </button>
        )}
      </div>
    </div>
  );
});

const AiAssistantTodosList = memo(function AiAssistantTodosList({
  items,
  isLive = false,
}: {
  items: readonly CoursewareAgentTodoItem[];
  isLive?: boolean;
}) {
  const { t } = useI18nNew();
  if (items.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-lg border bg-slate-100 border-slate-200 dark:border-violet-500/25 dark:bg-violet-950/20">
      <div className="border-b border-slate-200 dark:border-violet-500/20 px-2.5 py-1.5 text-[10px] font-medium tracking-wide text-slate-700 dark:text-violet-200/90 uppercase">
        {t("coursewareEditor.aiPanel.todosTitle")}
      </div>
      <ul className="space-y-0.5 px-2 py-2">
        {items.map((item, index) => {
          const done = item.status === "completed";
          const cancelled = item.status === "cancelled";
          const active = item.status === "in_progress";
          const stalled = !isLive && !done && !cancelled;
          const Icon = done ? Check : cancelled ? Minus : stalled ? X : active ? Loader2 : Circle;
          const iconClass = done
            ? "text-emerald-400/90"
            : cancelled
              ? "text-slate-500"
              : stalled
                ? "text-rose-400/90"
                : active
                  ? "animate-spin text-violet-300"
                  : "text-slate-500";
          const textClass = done
            ? "text-slate-500 line-through decoration-slate-600"
            : cancelled
              ? "text-slate-600 line-through decoration-slate-700"
              : stalled
                ? "text-slate-500 line-through decoration-slate-600"
                : active
                  ? "text-slate-300"
                  : "text-slate-300";

          return (
            <li
              key={item.id ?? `${index}-${item.content}`}
              className="flex items-start gap-2 text-[11px] leading-snug"
            >
              <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${iconClass}`} aria-hidden />
              <span className={`min-w-0 flex-1 wrap-anywhere ${textClass}`}>{item.content}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
});

const AiAssistantOpsCard = memo(function AiAssistantOpsCard({
  tools,
  titleShimmer,
  detailsExpandable = true,
}: {
  tools: Extract<CoursewareAiAssistantBlock, { type: "tool" }>[];
  titleShimmer?: boolean;
  detailsExpandable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const title = pickAssistantOpsCardTitle(tools);
  const body = open
    ? tools
        .map((tool) => {
          const lines: string[] = [];
          if (tool.command) {
            lines.push(tool.toolName === "Read" ? tool.command : `$ ${tool.command}`);
          }
          if (tool.output) lines.push(`→ ${tool.output}`);
          const detail = lines.join("\n").trim();
          return detail ? `${tool.title}\n${detail}` : tool.title;
        })
        .join("\n\n")
    : "";

  const bodyScrollRef = useRef<HTMLPreElement>(null);
  const bodyScrollAnimRef = useRef<SmoothScrollRunner>({ raf: 0 });

  useEffect(() => {
    if (detailsExpandable) return;
    setOpen(false);
  }, [detailsExpandable]);

  useLayoutEffect(() => {
    if (!open || !body) {
      cancelSmoothScroll(bodyScrollAnimRef.current);
      return;
    }
    const el = bodyScrollRef.current;
    if (!el) return;
    smoothScrollTowardBottom(el, bodyScrollAnimRef.current, { easing: 0.28 });
  }, [open, body]);

  useEffect(() => () => cancelSmoothScroll(bodyScrollAnimRef.current), []);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700/70 bg-white/90 dark:bg-slate-900/40">
      {detailsExpandable ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-[11px] text-slate-800 dark:text-slate-200 transition hover:bg-slate-100/90 dark:hover:bg-slate-800/60"
        >
          <AiAssistantOpsCardTitle title={title} shimmer={titleShimmer} />
          {open ? (
            <ChevronUp className="h-3 w-3 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
          )}
        </button>
      ) : (
        <div className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-[11px] text-slate-800 dark:text-slate-200">
          <AiAssistantOpsCardTitle title={title} shimmer={titleShimmer} />
        </div>
      )}
      {open && body ? (
        <pre
          ref={bodyScrollRef}
          className="max-h-56 overflow-auto border-t border-slate-200 dark:border-slate-800/80 px-2.5 py-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-slate-400 dark:text-slate-500"
        >
          {body}
        </pre>
      ) : null}
    </div>
  );
});

const AiAssistantInsufficientOrgCreditsCard = memo(function AiAssistantInsufficientOrgCreditsCard() {
  const { t } = useI18nNew();
  const { session } = useAuth();

  const handleRecharge = useCallback(() => {
    if (session?.access_token) {
      const url = buildManageOrganizationUrl(session.access_token);
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    logger.error("No access token available for manage organization recharge");
    toast.error(t("myCourses.cannotGetToken"));
  }, [session?.access_token, t]);

  return (
    <div className="rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2.5 text-[12px] leading-relaxed text-amber-900 shadow-sm dark:border-amber-700/60 dark:bg-amber-950/35 dark:text-amber-100">
      <p className="font-medium">{t("player.error.chatInsufficientOrgCredits")}</p>
      <button
        type="button"
        onClick={handleRecharge}
        className="mt-2.5 inline-flex items-center justify-center rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[11px] font-medium text-amber-900 transition hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-900/55 dark:text-amber-50 dark:hover:bg-amber-900/75"
      >
        {t("player.error.goToRecharge")}
      </button>
    </div>
  );
});

export const AiAssistantInsufficientPersonalCreditsCard = memo(function AiAssistantInsufficientPersonalCreditsCard() {
  const { t } = useI18nNew();

  const handleRecharge = useCallback(() => {
    window.open("/settings/subscription", "_blank", "noopener,noreferrer");
  }, []);

  const handleViewUsage = useCallback(() => {
    window.open("/settings/personal-credits", "_blank", "noopener,noreferrer");
  }, []);

  return (
    <div className="rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2.5 text-[12px] leading-relaxed text-amber-900 shadow-sm dark:border-amber-700/60 dark:bg-amber-950/35 dark:text-amber-100">
      <p className="font-medium">{t("player.error.chatInsufficientPersonalCredits")}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleRecharge}
          className="inline-flex items-center justify-center rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[11px] font-medium text-amber-900 transition hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-900/55 dark:text-amber-50 dark:hover:bg-amber-900/75"
        >
          {t("player.error.goToRecharge")}
        </button>
        <button
          type="button"
          onClick={handleViewUsage}
          className="inline-flex items-center justify-center rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[11px] font-medium text-amber-900 transition hover:bg-amber-100 dark:border-amber-600 dark:bg-amber-900/55 dark:text-amber-50 dark:hover:bg-amber-900/75"
        >
          {t("player.error.viewUsage")}
        </button>
      </div>
    </div>
  );
});

export const AiAssistantContextResetCard = memo(function AiAssistantContextResetCard({
  onResetAgentContext,
}: {
  onResetAgentContext?: () => void | Promise<void>;
}) {
  const { t } = useI18nNew();

  return (
    <div className="rounded-xl border border-amber-500/35 bg-amber-950/30 px-3 py-2.5 text-[12px] leading-relaxed text-amber-50">
      <p>{t("coursewareEditor.aiPanel.contextTooLargeMessage")}</p>
      {onResetAgentContext ? (
        <button
          type="button"
          onClick={() => void onResetAgentContext()}
          className="mt-2.5 inline-flex items-center justify-center rounded-lg border border-amber-400/40 bg-amber-900/50 px-3 py-1.5 text-[11px] font-medium text-amber-50 transition hover:border-amber-300/60 hover:bg-amber-900/80"
        >
          {t("coursewareEditor.aiPanel.contextTooLargeAction")}
        </button>
      ) : null}
    </div>
  );
});

export const CoursewareAiAssistantMessageBody = memo(function CoursewareAiAssistantMessageBody({
  content,
  blocks,
  isLive,
  markdownClassName = "text-[12px] leading-relaxed",
  onSubmitAgentUserQuestion,
  onResetAgentContext,
  practiceQuiz = false,
}: {
  content: string;
  blocks?: CoursewareAiAssistantBlock[];
  /** true only while the assistant SSE is still in progress (for the action title shimmer etc.) */
  isLive: boolean;
  markdownClassName?: string;
  onSubmitAgentUserQuestion?: (args: {
    requestId: string;
    answers: Record<string, string>;
  }) => void | Promise<void>;
  /** Clear the assistant history (the context-too-large recovery card) */
  onResetAgentContext?: () => void | Promise<void>;
  /** Student practice mode: strip flow placeholders and hide option subtitles (false by default in the editor) */
  practiceQuiz?: boolean;
}) {
  const detailsExpandable =
    config.modules?.interaction?.allowAssistantToolDetailsExpand !== false;
  const segments = useMemo(
    () => buildAssistantPanelSegments(content, blocks),
    [blocks, content],
  );

  if (segments.length === 0) {
    return content.trim() ? (
      <div className="courseware-editor-ai-md wrap-anywhere min-w-0 overflow-x-auto">
        <ChatMarkdownRenderer content={content} className={markdownClassName} />
      </div>
    ) : null;
  }

  return (
    <div className="space-y-2.5">
      {segments.map((seg, index) => {
        if (seg.kind === "prose") {
          return (
            <div
              key={`p-${index}`}
              className="courseware-editor-ai-md wrap-anywhere min-w-0 overflow-x-auto"
            >
              <ChatMarkdownRenderer content={seg.text} className={markdownClassName} />
            </div>
          );
        }
        if (seg.kind === "insufficient_org_credits") {
          return <AiAssistantInsufficientOrgCreditsCard key={`credits-org-${index}`} />;
        }
        if (seg.kind === "insufficient_personal_credits") {
          return <AiAssistantInsufficientPersonalCreditsCard key={`credits-personal-${index}`} />;
        }
        if (seg.kind === "agent_context_reset_required") {
          return (
            <AiAssistantContextResetCard
              key={`context-reset-${index}`}
              onResetAgentContext={onResetAgentContext}
            />
          );
        }
        if (seg.kind === "todos") {
          return <AiAssistantTodosList key={`todo-${index}`} items={seg.items} isLive={isLive} />;
        }
        if (seg.kind === "user_question") {
          const stableKey = userQuestionRenderKey(seg.questions);
          return (
            <AiAssistantUserQuestionCard
              key={`q-${stableKey}`}
              requestId={seg.requestId}
              questions={seg.questions}
              answered={seg.answered}
              expired={seg.expired}
              onSubmit={onSubmitAgentUserQuestion}
              practiceQuiz={practiceQuiz}
            />
          );
        }
        return (
          <AiAssistantOpsCard
            key={`t-${index}-${seg.tools[0]?.id ?? index}`}
            tools={seg.tools}
            titleShimmer={Boolean(isLive && index === segments.length - 1)}
            detailsExpandable={detailsExpandable}
          />
        );
      })}
    </div>
  );
});
