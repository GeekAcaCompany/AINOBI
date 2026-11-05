// SPDX-License-Identifier: AGPL-3.0-only
/** A single agent tool call (Bash / Read / TodoWrite etc.) */
export type AiAssistantOp = {
  toolName: string;
  /** Card title: the detail from `· Tool：detail`, defaulting to toolName */
  title: string;
  /** Detail lines such as commands and output (without the `·` title line) */
  lines: string[];
};

export type AiAssistantSegment =
  | { kind: "prose"; text: string }
  | { kind: "ops"; ops: AiAssistantOp[] };

const TOOL_HEADER_RE = /^·\s*([^：:]+?)(?:[：:]\s*(.*))?$/;
/** Allows a line starting with `  →`, or `→` after trimming */
const TOOL_CMD_OR_RESULT_RE = /^(?: {1,2})?(?:\$|→)\s?/;

const AGENT_PROSE_RE =
  /^(Let me\b|Now let'?s?\b|Now I\b|I'll\b|I will\b|The framework is\b|Network issue\b|Moving to\b|Narration recorded\b|Slide \d+ looks\b|First,\b|Accent SVG\b|GeekAca)/i;

const TOOL_TITLE_RE =
  /^(List|Check|Get|Write|Insert|Delete|Verify|Create|Read|Fetch|Build|Polish|Retry|Update|Add|Remove|Re-?insert|Main title|Subtitle|Tagline|Bullet \d|Section number|Title|Underline|Decorative|Accent|Bottom tagline|Create\b|Insert\b|Delete\b|Get\b|Check\b|Write\b)/i;

function parseToolHeader(line: string): { toolName: string; title: string } | null {
  const match = TOOL_HEADER_RE.exec(line);
  if (!match) return null;
  const toolName = match[1].trim();
  const detail = (match[2] ?? "").trim();
  return { toolName, title: detail || toolName };
}

function isToolCmdOrResultLine(line: string): boolean {
  return TOOL_CMD_OR_RESULT_RE.test(line);
}

function isSyntacticToolLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return !!(parseToolHeader(t) || isToolCmdOrResultLine(line) || isToolPayloadLine(line));
}

function hasProseSignals(t: string): boolean {
  if (AGENT_PROSE_RE.test(t)) return true;
  if (t.includes(" — ") && t.length > 24) return true;
  if (/[.!?。！？]$/.test(t) && t.length > 36) return true;
  if (/[，。]/.test(t) && t.length > 48) return true;
  return false;
}

/** The assistant's narrative body (should render as Markdown) */
function isAgentProseLine(line: string): boolean {
  const t = line.trim();
  if (!t || isSyntacticToolLine(line)) return false;
  return hasProseSignals(t);
}

/** Tool details such as shell commands, paths, heredocs, JSON */
function isToolPayloadLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (isToolCmdOrResultLine(line)) return true;
  if (/^ainobi\b/.test(t)) return true;
  if (/^(cat|echo)\s/.test(t)) return true;
  if (t.startsWith('WORK_DIR=')) return true;
  if (/<<\s*['"]?(EOF|TRANS)/.test(t)) return true;
  if (t === "EOF" || t === "TRANS" || t === "---") return true;
  if (/^\/(?:Users|var|tmp)\//.test(t)) return true;
  if (/\.(md|json|txt|sh)\b/.test(t) && (t.startsWith("/") || t.includes("WORK_DIR") || t.includes("$"))) {
    return true;
  }
  if (t === "操作" || t === "Operations" || t.startsWith('{"ok":')) return true;
  if (isToolOutputContinuationLine(line)) return true;
  if (t.startsWith('$(')) return true;
  if (t.startsWith('"element_type":')) return true;
  return false;
}

/** Tool step title (Bash description etc.), not necessarily right after `$`/`→` */
function isToolTitleLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 120) return false;
  if (isSyntacticToolLine(line) || hasProseSignals(t)) return false;
  if (/[.!?。！？]$/.test(t)) return false;
  if (/^\/\S+\.(md|json|txt)\b/.test(t)) return true;
  if (TOOL_TITLE_RE.test(t)) return true;
  if (/[，。]/.test(t)) return false;
  if (t.length < 80 && t.split(/\s+/).length <= 10) return true;
  return false;
}

/** Continuation lines in tool output (multi-line JSON, blank lines, indented content, etc.) */
function isToolOutputContinuationLine(line: string): boolean {
  if (!line.trim()) return true;
  if (line.startsWith(" ")) return true;
  const trimmed = line.trim();
  if (/^[{}[\]",]/.test(trimmed)) return true;
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return true;
  return false;
}

type LineKind = "blank" | "prose" | "tool_title" | "tool_body";

function classifyLine(line: string): LineKind {
  if (!line.trim()) return "blank";
  if (parseToolHeader(line.trim())) return "tool_title";
  if (isAgentProseLine(line)) return "prose";
  if (isToolPayloadLine(line)) return "tool_body";
  if (isToolTitleLine(line)) return "tool_title";
  return "prose";
}

function startOp(
  header: { toolName: string; title: string },
  opsBuf: AiAssistantOp[],
  currentOp: AiAssistantOp | null,
): AiAssistantOp {
  if (currentOp) opsBuf.push(currentOp);
  return { ...header, lines: [] };
}

/**
 * Split the sidebar assistant's plain text into "body / operation batch" fragments.
 * Consecutive tool calls of one batch merge into a single ops fragment, so the UI puts them into one card.
 */
export function parseAiAssistantContent(raw: string): AiAssistantSegment[] {
  if (!raw.trim()) return [];

  const segments: AiAssistantSegment[] = [];
  const lines = raw.split("\n");
  let proseBuf: string[] = [];
  let opsBuf: AiAssistantOp[] = [];
  let currentOp: AiAssistantOp | null = null;
  let inOps = false;

  const flushProse = (): void => {
    const text = proseBuf.join("\n").trim();
    proseBuf = [];
    if (text) segments.push({ kind: "prose", text });
  };

  const flushOps = (): void => {
    if (currentOp) {
      opsBuf.push(currentOp);
      currentOp = null;
    }
    if (opsBuf.length > 0) {
      segments.push({ kind: "ops", ops: opsBuf });
      opsBuf = [];
    }
    inOps = false;
  };

  const pushOpLine = (line: string): void => {
    if (!currentOp) return;
    currentOp.lines.push(line);
  };

  const ensureOps = (header: { toolName: string; title: string }): void => {
    flushProse();
    inOps = true;
    currentOp = startOp(header, opsBuf, currentOp);
  };

  for (const line of lines) {
    const kind = classifyLine(line);
    const header = parseToolHeader(line);

    if (header) {
      ensureOps(header);
      continue;
    }

    if (kind === "prose") {
      if (inOps) flushOps();
      proseBuf.push(line);
      continue;
    }

    if (kind === "blank") {
      if (inOps) pushOpLine(line);
      else proseBuf.push(line);
      continue;
    }

    // tool_title | tool_body
    flushProse();
    inOps = true;

    if (kind === "tool_title") {
      const title = line.trim();
      currentOp = startOp({ toolName: "tool", title }, opsBuf, currentOp);
      continue;
    }

    if (!currentOp) {
      currentOp = { toolName: "tool", title: "Operations", lines: [line] };
    } else {
      pushOpLine(line);
    }
  }

  flushProse();
  // flushOps() already pushes currentOp; a second manual push here duplicated the final op.
  flushOps();

  return segments;
}

/** Operation card title: the title of the last operation in the batch */
export function aiAssistantOpsCardTitle(ops: readonly AiAssistantOp[]): string {
  return ops[ops.length - 1]?.title ?? "Operations";
}

/** Operation card body: plain text, not rendered as Markdown */
export function aiAssistantOpsCardBody(ops: readonly AiAssistantOp[]): string {
  return ops
    .map((op) => {
      const detail = op.lines.join("\n").trim();
      return detail ? `${op.title}\n${detail}` : op.title;
    })
    .filter(Boolean)
    .join("\n\n");
}
