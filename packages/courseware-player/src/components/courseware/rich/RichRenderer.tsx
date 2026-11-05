// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Recursive renderer for a `rich` element's `react_layout`.
 *
 * Renders the validated, style-sanitized {@link RichAstNode} into host DOM with
 * `createElement`: `className` (Tailwind) passes through and inline `style` is
 * re-sanitized at render time as defense-in-depth. There is no runtime JSX
 * parsing and no behavior — purely presentational.
 */

import {
  createElement,
  Fragment,
  useEffect,
  useRef,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type MutableRefObject,
  type ReactNode,
  type Ref,
} from "react";

import {
  isRichTag,
  RICH_VOID_HTML_TAGS,
  type RichAstNode,
  type RichAstPropValue,
  type RichTag,
} from "@ainobi/courseware-core/rich-ast.ts";
import { normalizeQuizAstStyle } from "../quiz/quiz-style-allowlist.ts";

const propsForRender = (raw: Record<string, RichAstPropValue>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "style") {
      out[key] = normalizeQuizAstStyle(value);
      continue;
    }
    out[key] = value;
  }
  return out;
};

type RichTextPath = number[];

const pathKey = (path: RichTextPath): string => path.join(".");
const pathsEqual = (a: RichTextPath | undefined, b: RichTextPath): boolean =>
  Array.isArray(a) && a.length === b.length && a.every((value, index) => value === b[index]);

interface RichRendererEditOptions {
  annotateNodePaths?: boolean;
  activeTextEditPath?: RichTextPath | null;
  legacyAllTextEditable?: boolean;
  selectedTextPath?: RichTextPath;
  onTextChange?: (path: RichTextPath, text: string) => void;
  onTextSelect?: (path: RichTextPath) => void;
  onTextCommit?: () => void;
}

function EditableRichTextNode({
  text,
  path,
  options,
}: {
  text: string;
  path: RichTextPath;
  options: RichRendererEditOptions;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const initialTextRef = useRef(text);
  const selected = pathsEqual(options.selectedTextPath, path);
  const editing =
    pathsEqual(options.activeTextEditPath ?? undefined, path) ||
    Boolean(options.legacyAllTextEditable);

  useEffect(() => {
    const node = ref.current;
    if (node) node.innerText = initialTextRef.current;
  }, []);

  useEffect(() => {
    if (!editing) return;
    const node = ref.current;
    if (!node) return;
    requestAnimationFrame(() => focusEditableRichText(node));
  }, [editing]);

  if (!editing) {
    return <span data-rich-text-path={pathKey(path)}>{text}</span>;
  }

  return (
    <span
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-rich-text-path={pathKey(path)}
      onPointerDown={(event) => {
        event.stopPropagation();
        options.onTextSelect?.(path);
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onFocus={() => options.onTextSelect?.(path)}
      onInput={(event: FormEvent<HTMLSpanElement>) =>
        options.onTextChange?.(path, event.currentTarget.innerText)
      }
      onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          options.onTextCommit?.();
        }
      }}
      style={{
        outline: selected
          ? "2px solid rgba(59, 130, 246, 0.9)"
          : "1px dashed rgba(59, 130, 246, 0.65)",
        outlineOffset: selected ? 3 : 2,
        cursor: "text",
        whiteSpace: "pre-wrap",
      }}
    />
  );
}

const renderChildren = (
  children: RichAstNode[],
  path: RichTextPath,
  options?: RichRendererEditOptions,
): ReactNode =>
  children.map((child, index) => (
    <Fragment key={index}>{renderNode(child, [...path, index], options)}</Fragment>
  ));

const renderElementNode = (
  tag: RichTag,
  props: Record<string, RichAstPropValue>,
  children: RichAstNode[],
  path: RichTextPath,
  options?: RichRendererEditOptions,
): ReactNode => {
  const reactProps = propsForRender(props);
  if (options?.annotateNodePaths) {
    reactProps["data-rich-node-path"] = pathKey(path);
  }
  if (RICH_VOID_HTML_TAGS.has(tag)) {
    return createElement(tag, reactProps);
  }
  return createElement(tag, reactProps, renderChildren(children, path, options));
};

const renderNode = (
  node: RichAstNode,
  path: RichTextPath,
  options?: RichRendererEditOptions,
): ReactNode => {
  if (node.kind === "text") {
    const inEditMode =
      options?.legacyAllTextEditable ||
      (options?.activeTextEditPath !== undefined && options.activeTextEditPath !== null);
    if (inEditMode) {
      return <EditableRichTextNode text={node.text} path={path} options={options} />;
    }
    if (options?.annotateNodePaths) {
      return <span data-rich-text-path={pathKey(path)}>{node.text}</span>;
    }
    return node.text;
  }
  if (node.kind !== "element") return null;
  if (!isRichTag(node.tag)) return null;
  return renderElementNode(node.tag, node.props, node.children, path, options);
};

export interface RichRendererProps {
  reactLayout: RichAstNode;
  /** Extra style merged onto the root element (e.g. fill the scaled canvas box). */
  containerStyle?: CSSProperties;
  className?: string;
  /** @deprecated Use `activeTextEditPath` via CoursewareRichStageEditor. */
  editableText?: boolean;
  annotateNodePaths?: boolean;
  activeTextEditPath?: RichTextPath | null;
  selectedTextPath?: RichTextPath;
  onTextChange?: (path: RichTextPath, text: string) => void;
  onTextSelect?: (path: RichTextPath) => void;
  onTextCommit?: () => void;
  rootRef?: Ref<HTMLElement | null>;
}

const focusEditableRichText = (node: HTMLElement): void => {
  node.focus();
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
};

const assignRef = (ref: Ref<HTMLElement | null> | undefined, node: HTMLElement | null): void => {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(node);
    return;
  }
  (ref as MutableRefObject<HTMLElement | null>).current = node;
};

export const RichRenderer = ({
  reactLayout,
  containerStyle,
  className,
  editableText = false,
  annotateNodePaths = false,
  activeTextEditPath = editableText ? [] : null,
  selectedTextPath,
  onTextChange,
  onTextSelect,
  onTextCommit,
  rootRef,
}: RichRendererProps) => {
  const internalRootRef = useRef<HTMLElement | null>(null);
  const didAutoFocusRef = useRef(false);
  const root = reactLayout;

  const legacyAllTextEditable =
    editableText && activeTextEditPath !== null && activeTextEditPath.length === 0;

  const editOptions: RichRendererEditOptions | undefined =
    annotateNodePaths || activeTextEditPath !== null || legacyAllTextEditable
      ? {
          annotateNodePaths,
          activeTextEditPath,
          legacyAllTextEditable,
          selectedTextPath,
          onTextChange,
          onTextSelect,
          onTextCommit,
        }
      : undefined;

  useEffect(() => {
    if (!editableText || activeTextEditPath !== null) {
      didAutoFocusRef.current = false;
      return;
    }
    if (didAutoFocusRef.current) return;
    didAutoFocusRef.current = true;
    requestAnimationFrame(() => {
      const first = internalRootRef.current?.querySelector<HTMLElement>("[data-rich-text-path]");
      if (!first) return;
      const rawPath = first.dataset.richTextPath ?? "";
      const path = rawPath === "" ? [] : rawPath.split(".").map((part) => Number.parseInt(part, 10));
      if (path.every(Number.isFinite)) {
        onTextSelect?.(path);
      }
      focusEditableRichText(first);
    });
  }, [editableText, activeTextEditPath, onTextSelect]);

  if (!root || root.kind !== "element" || !isRichTag(root.tag)) {
    return null;
  }

  const rootProps = propsForRender(root.props);
  const rootStyle = normalizeQuizAstStyle(rootProps.style);
  const mergedClassName = [
    typeof rootProps.className === "string" ? rootProps.className : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const finalProps: Record<string, unknown> = {
    ...rootProps,
    ref: (node: HTMLElement | null) => {
      internalRootRef.current = node;
      assignRef(rootRef, node);
    },
    className: mergedClassName || undefined,
    style: { ...rootStyle, ...containerStyle },
  };
  if (annotateNodePaths) {
    finalProps["data-rich-node-path"] = pathKey([]);
  }
  if (RICH_VOID_HTML_TAGS.has(root.tag)) {
    return createElement(root.tag, finalProps);
  }
  return createElement(root.tag, finalProps, renderChildren(root.children, [], editOptions));
};
