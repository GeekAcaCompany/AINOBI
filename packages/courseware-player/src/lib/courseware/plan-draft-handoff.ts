// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Plan → Agent handoff: design draft delimiting and brief extraction (shared by the editor panel and the home AI courseware shell).
 */

const PLAN_DRAFT_HANDOFF_START = "<!-- ainobi-plan-draft:start -->";
const PLAN_DRAFT_HANDOFF_END = "<!-- ainobi-plan-draft:end -->";

/** Assemble the handoff message: the note + the delimited draft. */
export function buildPlanDraftHandoffMessage(instruction: string, draft: string): string {
  return `${instruction.trim()}\n\n${PLAN_DRAFT_HANDOFF_START}\n${draft.trim()}\n${PLAN_DRAFT_HANDOFF_END}`;
}

/** Extract the delimited draft body from a user message; returns null for messages that aren't handoffs. */
export function extractPlanDraftFromMessage(content: string): string | null {
  const start = content.indexOf(PLAN_DRAFT_HANDOFF_START);
  if (start === -1) return null;
  const afterStart = start + PLAN_DRAFT_HANDOFF_START.length;
  const end = content.indexOf(PLAN_DRAFT_HANDOFF_END, afterStart);
  const body = end === -1 ? content.slice(afterStart) : content.slice(afterStart, end);
  const trimmed = body.trim();
  return trimmed ? extractPlanDesignBriefMarkdown(trimmed) : null;
}

/** In the Plan assistant's final reply, strip the question/confirmation dialogue and keep only the design brief markdown body. */
export function extractPlanDesignBriefMarkdown(fullText: string): string {
  const text = fullText.trim();
  if (!text) return "";

  const briefHeading = text.match(/^#{1,4}\s+.*(?:设计简报|设计草案|Design Brief).*$/im);
  if (briefHeading?.index != null) {
    return stripPlanBriefClosingRemark(text.slice(briefHeading.index).trim());
  }

  const transitionPatterns = [
    /信息已齐全[，,]\s*下面是完整的(?:课件)?设计简报[。.：:]*\s*\n+/i,
    /以下是完整(?:的)?(?:课件)?设计简报[：:.]*\s*\n+/i,
    /下面是完整(?:的)?(?:课件)?设计简报[：:.]*\s*\n+/i,
    /Below is the full (?:courseware )?design brief[.:]*\s*\n+/i,
  ];
  for (const re of transitionPatterns) {
    const m = text.match(re);
    if (m?.index != null) {
      const rest = text.slice(m.index + m[0].length).trim();
      if (rest.length >= 80) return stripPlanBriefClosingRemark(rest);
    }
  }

  const sectionMatch = text.match(/^#{1,4}\s*(?:课件标题|教学目标)\b/im);
  if (sectionMatch?.index != null) {
    const before = text.slice(0, sectionMatch.index);
    const prevHeading = before.match(/#{1,4}\s+[^\n]+\s*$/);
    const start = prevHeading?.index ?? sectionMatch.index;
    return stripPlanBriefClosingRemark(text.slice(start).trim());
  }

  return stripPlanBriefClosingRemark(text);
}

/** Remove the closing sentence addressed to the user at the end of the brief (not part of the brief body). */
export function stripPlanBriefClosingRemark(text: string): string {
  return text
    .replace(
      /\n+(?:以上是完整设计简报|你可以直接提出修改|如需调整请直接告诉我|也可以点击[「"]?开始制作).*$/is,
      "",
    )
    .trim();
}

/** Strip bracketed notes addressed to the agent from the title, such as "(给构建 Agent)". */
export function stripPlanDraftTitleMeta(title: string): string {
  return title
    .replace(/\s*[（(][^）)]*(?:Agent|agent|构建|CLI|ainobi)[^）)]*[）)]\s*/g, "")
    .trim();
}

/** Extract the display title from the brief markdown. */
export function extractPlanDraftDisplayTitle(briefMarkdown: string): string {
  const text = extractPlanDesignBriefMarkdown(briefMarkdown).trim();
  if (!text) return "";

  const briefTitle = text.match(/^#{1,4}\s+(.*(?:设计简报|设计草案|Design Brief).*)$/im);
  if (briefTitle?.[1]) return stripPlanDraftTitleMeta(briefTitle[1].trim());

  const h1 = text.match(/^#{1,4}\s+(.+)$/m);
  if (h1?.[1]) return stripPlanDraftTitleMeta(h1[1].trim());

  const bold = text.match(/^\*\*([^*]+)\*\*/m);
  if (bold?.[1]) return stripPlanDraftTitleMeta(bold[1].trim());

  const titleLine = text.match(/^([^\n#*].{2,80}(?:设计简报|设计草案|Design Brief)[^\n]*)$/m);
  if (titleLine?.[1]) return stripPlanDraftTitleMeta(titleLine[1].trim());

  return "";
}

/** Whether the brief reached the length needed to hand over for generation. */
export function isPlanDraftReadyForHandoff(briefMarkdown: string): boolean {
  return extractPlanDesignBriefMarkdown(briefMarkdown).trim().length >= 80;
}
