// SPDX-License-Identifier: AGPL-3.0-only
import React, { memo, useDeferredValue, useEffect, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

export interface MarkdownRendererProps {
  content: string;
  className?: string;
  allowHtml?: boolean;
  allowMath?: boolean;
  allowCodeHighlight?: boolean;
}

/** react-markdown v9+ no longer passes `inline`; blocks are wrapped by the outer `pre`, so only `code` is rendered here */
const MarkdownCodeBlock = ({
  className,
  children,
  ...props
}: Record<string, unknown> & { className?: string; children?: React.ReactNode }) => {
  const text = String(children).replace(/\n$/, "");
  const isFencedBlock =
    /language-[\w-]+/.test(className ?? "") || text.includes("\n");

  if (isFencedBlock) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  return (
    <code
      className={`bg-gray-100 dark:bg-slate-700 px-1 py-0.5 rounded text-sm text-gray-900 dark:text-slate-100 ${className ?? ""}`}
      {...props}
    >
      {children}
    </code>
  );
};

const MARKDOWN_COMPONENTS = {
  code: MarkdownCodeBlock,
  a: ({ href, children, ...props }: Record<string, unknown> & { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:text-blue-800 underline dark:text-sky-400 dark:hover:text-sky-300"
      {...props}
    >
      {children}
    </a>
  ),
  table: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <div className="overflow-x-auto">
      <table
        className="min-w-full border-collapse border border-gray-300 dark:border-slate-600 mb-3"
        {...props}
      >
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <th
      className="border border-gray-300 dark:border-slate-600 bg-gray-100 dark:bg-slate-700/80 px-4 py-2 text-left font-semibold text-gray-900 dark:text-slate-100"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <td className="border border-gray-300 dark:border-slate-600 px-4 py-2 text-gray-800 dark:text-slate-200" {...props}>
      {children}
    </td>
  ),
  blockquote: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <blockquote
      className="border-l-4 border-gray-300 dark:border-slate-500 pl-4 italic text-gray-700 dark:text-slate-300"
      {...props}
    >
      {children}
    </blockquote>
  ),
  ul: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <ul className="list-disc list-inside space-y-1 text-gray-800 dark:text-slate-200" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <ol className="list-decimal list-inside space-y-1 text-gray-800 dark:text-slate-200" {...props}>
      {children}
    </ol>
  ),
  h1: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-4 mt-6" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-3 mt-5" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <h3 className="text-lg font-bold text-gray-900 dark:text-slate-100 mb-2 mt-4" {...props}>
      {children}
    </h3>
  ),
  h4: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <h4 className="text-base font-bold text-gray-900 dark:text-slate-100 mb-2 mt-3" {...props}>
      {children}
    </h4>
  ),
  h5: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <h5 className="text-sm font-bold text-gray-900 dark:text-slate-100 mb-1 mt-2" {...props}>
      {children}
    </h5>
  ),
  h6: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <h6 className="text-sm font-semibold text-gray-900 dark:text-slate-100 mb-1 mt-2" {...props}>
      {children}
    </h6>
  ),
  p: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <p className="mb-3 last:mb-0 text-gray-800 dark:text-slate-200 leading-relaxed whitespace-pre-line" {...props}>
      {children}
    </p>
  ),
  pre: ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => (
    <pre
      className="bg-gray-100 dark:bg-slate-800/90 rounded-md p-4 overflow-x-auto text-gray-900 dark:text-slate-100"
      {...props}
    >
      {children}
    </pre>
  ),
  hr: ({ ...props }: Record<string, unknown>) => (
    <hr className="border-t border-gray-300 dark:border-slate-600 my-6" {...props} />
  ),
} as Components;

const REMARK_WITH_MATH = [remarkGfm, remarkMath];
const REMARK_NO_MATH = [remarkGfm];
const REHYPE_WITH_MATH = [rehypeKatex, rehypeRaw, rehypeSanitize];
const REHYPE_NO_MATH = [rehypeRaw, rehypeSanitize];

/**
 * Markdown renderer component
 * Supports GitHub-flavored markdown, math formulas, code highlighting, etc.
 */
export default function MarkdownRenderer({
  content,
  className = "",
  allowHtml = true,
  allowMath = true,
  allowCodeHighlight: _allowCodeHighlight = true,
}: MarkdownRendererProps) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    if (allowMath) {
      void import("katex/dist/katex.min.css");
    }
  }, [allowMath]);

  const remarkPlugins = useMemo(() => (allowMath ? REMARK_WITH_MATH : REMARK_NO_MATH), [allowMath]);
  const rehypePlugins = useMemo(() => (allowMath ? REHYPE_WITH_MATH : REHYPE_NO_MATH), [allowMath]);

  const rootClassName = `markdown-content text-gray-800 dark:text-slate-200 [&_.katex]:text-inherit ${className}`;

  if (!isClient) {
    return <div className={rootClassName}>{content}</div>;
  }

  return (
    <div className={rootClassName}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={MARKDOWN_COMPONENTS}
        skipHtml={!allowHtml}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Dedicated to chat bubbles: stable plugin references + `useDeferredValue` reduce main thread pressure during streaming output
 */
export const ChatMarkdownRenderer = memo(function ChatMarkdownRenderer({
  content,
  className = "",
}: {
  content: string;
  className?: string;
}) {
  const [isClient, setIsClient] = useState(false);
  const deferredContent = useDeferredValue(content);

  useEffect(() => {
    setIsClient(true);
    void import("katex/dist/katex.min.css");
  }, []);

  const rootClassName = `markdown-content text-gray-800 dark:text-slate-200 [&_.katex]:text-inherit ${className}`;

  if (!isClient) {
    return <div className={rootClassName}>{content}</div>;
  }

  return (
    <div className={rootClassName}>
      <ReactMarkdown
        remarkPlugins={REMARK_WITH_MATH}
        rehypePlugins={REHYPE_WITH_MATH}
        components={MARKDOWN_COMPONENTS}
      >
        {deferredContent}
      </ReactMarkdown>
    </div>
  );
});
