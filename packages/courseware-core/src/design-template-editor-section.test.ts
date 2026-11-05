// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

const DESIGN_TEMPLATE_CONTENT_INJECT_MAX_CHARS = 8_000;

function truncateDesignTemplateContentForInject(content: string): {
  text: string;
  truncated: boolean;
} {
  const trimmed = content.trim();
  if (trimmed.length <= DESIGN_TEMPLATE_CONTENT_INJECT_MAX_CHARS) {
    return { text: trimmed, truncated: false };
  }
  return {
    text: `${trimmed.slice(0, DESIGN_TEMPLATE_CONTENT_INJECT_MAX_CHARS)}\n\n…(template truncated for context limit)`,
    truncated: true,
  };
}

function buildReferencedDesignTemplatesEditorSection(
  templates: readonly { id: string; name: string; content: string }[],
): string {
  if (templates.length === 0) return "";

  const lines = [
    "[User @ Referenced Design Templates]",
    "Follow these org design templates as authoritative style guides unless the user overrides.",
  ];

  for (const template of templates) {
    const { text, truncated } = truncateDesignTemplateContentForInject(template.content);
    lines.push("", `### Template: ${template.name} (id: ${template.id})`);
    if (truncated) {
      lines.push(
        `(Note: template body was truncated to ${DESIGN_TEMPLATE_CONTENT_INJECT_MAX_CHARS} chars for context.)`,
      );
    }
    lines.push(text);
  }

  return lines.join("\n");
}

describe("design template editor context section", () => {
  it("includes template markdown in editor section", () => {
    const section = buildReferencedDesignTemplatesEditorSection([
      { id: "t1", name: "Brand Blue", content: "## 色板\n- Primary: #0055FF" },
    ]);
    expect(section).toContain("[User @ Referenced Design Templates]");
    expect(section).toContain("Template: Brand Blue");
    expect(section).toContain("#0055FF");
  });

  it("truncates oversized template bodies", () => {
    const long = "x".repeat(30_000);
    const { text, truncated } = truncateDesignTemplateContentForInject(long);
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThan(long.length);
  });
});
