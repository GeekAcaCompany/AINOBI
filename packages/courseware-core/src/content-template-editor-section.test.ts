// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

const CONTENT_TEMPLATE_CONTENT_INJECT_MAX_CHARS = 8_000;

function truncateContentTemplateContentForInject(content: string): {
  text: string;
  truncated: boolean;
} {
  const trimmed = content.trim();
  if (trimmed.length <= CONTENT_TEMPLATE_CONTENT_INJECT_MAX_CHARS) {
    return { text: trimmed, truncated: false };
  }
  return {
    text: `${trimmed.slice(0, CONTENT_TEMPLATE_CONTENT_INJECT_MAX_CHARS)}\n\n…(template truncated for context limit)`,
    truncated: true,
  };
}

function buildReferencedContentTemplatesEditorSection(
  templates: readonly { id: string; name: string; content: string }[],
): string {
  if (templates.length === 0) return "";

  const lines = [
    "[User @ Referenced Content Templates]",
    "Follow these content templates (built-in or org) as authoritative outline/structure constraints unless the user overrides. Apply learning goals, page outline, pacing, quiz checkpoints, and narration rhythm — not visual style.",
  ];

  for (const template of templates) {
    const { text, truncated } = truncateContentTemplateContentForInject(template.content);
    lines.push("", `### Template: ${template.name} (id: ${template.id})`);
    if (truncated) {
      lines.push(
        `(Note: template body was truncated to ${CONTENT_TEMPLATE_CONTENT_INJECT_MAX_CHARS} chars for context.)`,
      );
    }
    lines.push(text);
  }

  return lines.join("\n");
}

describe("content template editor context section", () => {
  it("includes outline markdown in editor section", () => {
    const section = buildReferencedContentTemplatesEditorSection([
      {
        id: "t1",
        name: "医学病例页纲",
        content: "## 教学目标\n- 识别急症体征\n## 页纲与节奏\n1. 封面",
      },
    ]);
    expect(section).toContain("[User @ Referenced Content Templates]");
    expect(section).toContain("Template: 医学病例页纲");
    expect(section).toContain("教学目标");
    expect(section).toContain("not visual style");
    expect(section).toContain("built-in or org");
  });

  it("truncates oversized template bodies", () => {
    const long = "x".repeat(30_000);
    const { text, truncated } = truncateContentTemplateContentForInject(long);
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThan(long.length);
  });
});
