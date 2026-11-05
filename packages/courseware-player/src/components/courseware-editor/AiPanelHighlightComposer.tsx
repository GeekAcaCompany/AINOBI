// SPDX-License-Identifier: AGPL-3.0-only
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type ClipboardEvent,
  type FormEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { CoursewareAssetItem } from "../../api/courseware.ts";
import {
  getComposerCaretClientRect,
  getComposerSelectionOffsets,
  insertComposerPlainText,
  markAiPanelComposerChip,
  readComposerPlainText,
  setComposerSelectionOffsets,
} from "../../lib/courseware/ai-panel-composer.ts";
import {
  hasAiPanelBracketTokens,
  resolveAiPanelMentionSource,
  splitAiPanelRichTextSegments,
  type AiPanelRichTextSegment,
} from "../../lib/courseware/ai-manual-marks.ts";
import { splitMentionSegmentsForDisplay } from "../../lib/courseware/ai-asset-mentions.ts";

const MIN_PX = 54;
const MAX_PX = 240;

const CHIP_CLASS: Record<string, string> = {
  asset: "rounded-sm bg-violet-500/35 text-inherit",
  courseware: "rounded-sm bg-sky-500/35 text-inherit",
  design_template: "rounded-sm bg-amber-500/35 text-inherit",
  content_template: "rounded-sm bg-emerald-500/35 text-inherit",
  mark: "rounded-sm bg-rose-500/30 text-inherit",
};

const FIELD_CLASS =
  "box-border min-h-[54px] max-h-[240px] w-full overflow-x-hidden overflow-y-auto px-3 py-2.5 font-sans text-xs leading-5 whitespace-pre-wrap wrap-anywhere text-slate-900 caret-slate-900 outline-none dark:text-slate-100 dark:caret-slate-100";

export type AiPanelComposerHandle = {
  focus: () => void;
  getSelection: () => { start: number; end: number };
  setSelectionRange: (start: number, end: number) => void;
  getCaretClientRect: (position: number) => { top: number; left: number };
  getScrollElement: () => HTMLElement | null;
};

function segmentsForValue(
  text: string,
  libraryAssets: readonly CoursewareAssetItem[],
): AiPanelRichTextSegment[] {
  if (!text) return [];
  if (hasAiPanelBracketTokens(text)) return splitAiPanelRichTextSegments(text);
  const libraryById = new Map(libraryAssets.map((item) => [item.id, item]));
  return splitMentionSegmentsForDisplay(text, libraryAssets).map((seg): AiPanelRichTextSegment => {
    if (seg.kind === "text") return { kind: "text", value: seg.value };
    const libraryItem = libraryById.get(seg.id);
    return {
      kind: "assetMention",
      name: seg.name,
      id: seg.id,
      raw: seg.raw,
      mentionSource: libraryItem ? resolveAiPanelMentionSource(libraryItem) : "asset",
    };
  });
}

function appendTextWithBreaks(parent: Node, value: string): void {
  const parts = value.replace(/\r\n?/g, "\n").split("\n");
  parts.forEach((part, i) => {
    if (part) parent.appendChild(document.createTextNode(part));
    if (i < parts.length - 1) parent.appendChild(document.createElement("br"));
  });
}

function buildComposerDom(
  text: string,
  libraryAssets: readonly CoursewareAssetItem[],
): DocumentFragment {
  const frag = document.createDocumentFragment();
  const segments = segmentsForValue(text, libraryAssets);
  if (segments.length === 0) {
    if (text) appendTextWithBreaks(frag, text);
    return frag;
  }
  for (const seg of segments) {
    if (seg.kind === "text") {
      appendTextWithBreaks(frag, seg.value);
      continue;
    }
    const chip = document.createElement("span");
    markAiPanelComposerChip(chip);
    if (seg.kind === "manualMark") {
      chip.className = CHIP_CLASS.mark ?? "";
      chip.textContent = seg.raw || `标记${seg.index}:${seg.description}`;
    } else {
      chip.className = CHIP_CLASS[seg.mentionSource] ?? CHIP_CLASS.asset ?? "";
      chip.textContent = seg.raw || `@${seg.name}`;
    }
    frag.appendChild(chip);
  }
  return frag;
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  onCaretChange?: (caret: number) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  onPaste?: (e: ClipboardEvent<HTMLDivElement>) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: () => void;
  placeholder?: ReactNode;
  "aria-label"?: string;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: HTMLAttributes<HTMLElement>["aria-haspopup"];
  libraryAssets?: readonly CoursewareAssetItem[];
  className?: string;
};

export const AiPanelHighlightComposer = forwardRef<AiPanelComposerHandle, Props>(
  function AiPanelHighlightComposer(
    {
      value,
      onChange,
      onCaretChange,
      onKeyDown,
      onPaste,
      onCompositionStart,
      onCompositionEnd,
      placeholder,
      libraryAssets = [],
      className = "",
      ...aria
    },
    ref,
  ) {
    const edRef = useRef<HTMLDivElement | null>(null);
    const composingRef = useRef(false);
    const skipEmitRef = useRef(false);
    /** After focus moves to the picker, window.getSelection no longer lands in the composer, so the last valid selection is cached. */
    const cachedSelectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
    const libraryKey = useMemo(
      () => libraryAssets.map((a) => `${a.id}:${a.name}`).join("|"),
      [libraryAssets],
    );

    const syncHeight = useCallback(() => {
      const el = edRef.current;
      if (!el) return;
      el.style.height = "0px";
      const next = Math.min(MAX_PX, Math.max(MIN_PX, el.scrollHeight));
      el.style.height = `${next}px`;
    }, []);

    const readSelection = useCallback((): { start: number; end: number } => {
      const el = edRef.current;
      if (!el) return cachedSelectionRef.current;
      const sel = window.getSelection();
      const anchorInComposer =
        sel?.anchorNode != null && (el.contains(sel.anchorNode) || sel.anchorNode === el);
      if (!anchorInComposer) {
        return cachedSelectionRef.current;
      }
      const next = getComposerSelectionOffsets(el);
      cachedSelectionRef.current = next;
      return next;
    }, []);

    const emitCaret = useCallback(() => {
      const { start } = readSelection();
      onCaretChange?.(start);
    }, [onCaretChange, readSelection]);

    const rewriteDom = useCallback(
      (nextValue: string, caret: number | null) => {
        const el = edRef.current;
        if (!el) return;
        skipEmitRef.current = true;
        const frag = buildComposerDom(nextValue, libraryAssets);
        el.replaceChildren(frag);
        if (caret != null) {
          setComposerSelectionOffsets(el, caret, caret);
          cachedSelectionRef.current = { start: caret, end: caret };
        }
        skipEmitRef.current = false;
        syncHeight();
      },
      [libraryAssets, syncHeight],
    );

    useLayoutEffect(() => {
      const el = edRef.current;
      if (!el || composingRef.current) return;
      const current = readComposerPlainText(el);
      if (current === value) {
        syncHeight();
        return;
      }
      const { start } = readSelection();
      rewriteDom(value, start);
    }, [value, libraryKey, rewriteDom, syncHeight, readSelection]);

    useImperativeHandle(
      ref,
      (): AiPanelComposerHandle => ({
        focus: () => edRef.current?.focus(),
        getSelection: () => readSelection(),
        setSelectionRange: (start, end) => {
          const el = edRef.current;
          if (!el) return;
          el.focus();
          setComposerSelectionOffsets(el, start, end);
          cachedSelectionRef.current = { start, end };
          onCaretChange?.(start);
        },
        getCaretClientRect: (position) => {
          const el = edRef.current;
          if (!el) return { top: 0, left: 0 };
          return getComposerCaretClientRect(el, position);
        },
        getScrollElement: () => edRef.current,
      }),
      [onCaretChange, readSelection],
    );

    const handleInput = (e: FormEvent<HTMLDivElement>): void => {
      if (skipEmitRef.current || composingRef.current) return;
      const el = e.currentTarget;
      const text = readComposerPlainText(el);
      onChange(text);
      emitCaret();
      syncHeight();
    };

    const handlePaste = (e: ClipboardEvent<HTMLDivElement>): void => {
      onPaste?.(e);
      if (e.defaultPrevented) return;
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain");
      if (!text || !edRef.current) return;
      insertComposerPlainText(edRef.current, text);
      const next = readComposerPlainText(edRef.current);
      onChange(next);
      emitCaret();
      syncHeight();
      // Redraw the chips by token after pasting
      requestAnimationFrame(() => {
        const el = edRef.current;
        if (!el) return;
        const { start } = readSelection();
        rewriteDom(next, start);
      });
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
      if (e.key === "Enter" && e.shiftKey && !e.nativeEvent.isComposing && !composingRef.current) {
        e.preventDefault();
        const el = edRef.current;
        if (!el) return;
        insertComposerPlainText(el, "\n");
        const text = readComposerPlainText(el);
        onChange(text);
        emitCaret();
        syncHeight();
        return;
      }
      onKeyDown?.(e);
    };

    return (
      <div className={`relative ${className}`.trim()}>
        {!value && placeholder ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-0 px-3 py-2.5 font-sans text-xs leading-5 text-slate-700 dark:text-slate-600"
          >
            {placeholder}
          </div>
        ) : null}
        <div
          ref={edRef}
          role="textbox"
          aria-multiline
          contentEditable
          suppressContentEditableWarning
          className={FIELD_CLASS}
          data-ai-panel-composer=""
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onKeyUp={emitCaret}
          onClick={emitCaret}
          onSelect={emitCaret}
          onBlur={() => {
            // Refresh the cache once more before blurring, for later picker insertions
            const el = edRef.current;
            if (!el) return;
            const sel = window.getSelection();
            if (sel?.anchorNode && (el.contains(sel.anchorNode) || sel.anchorNode === el)) {
              cachedSelectionRef.current = getComposerSelectionOffsets(el);
            }
          }}
          onPaste={handlePaste}
          onCompositionStart={() => {
            composingRef.current = true;
            onCompositionStart?.();
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
            onCompositionEnd?.();
            const el = edRef.current;
            if (!el) return;
            const text = readComposerPlainText(el);
            onChange(text);
            const { start } = readSelection();
            rewriteDom(text, start);
          }}
          onScroll={emitCaret}
          {...aria}
        />
      </div>
    );
  },
);
