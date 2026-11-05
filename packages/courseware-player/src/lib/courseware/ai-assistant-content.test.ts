// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  aiAssistantOpsCardBody,
  aiAssistantOpsCardTitle,
  parseAiAssistantContent,
} from "./ai-assistant-content.ts";

describe("parseAiAssistantContent", () => {
  it("splits prose and grouped tool operations", () => {
    const raw = [
      "Let me start by checking the current scene state.",
      "",
      "· Bash：Get current scene info",
      "  $ ainobi scene info --verbose 2>&1",
      "  → {",
      '"scene_id": "sc_1",',
      "}",
      "",
      "· Bash：List current slides",
      "  $ ainobi slide list --verbose 2>&1",
      "  → {\"slide_count\": 1}",
      "",
      "Let me read the skill documentation.",
      "",
      "· Read：/path/SKILL.md",
      "  → 已读取 /path/SKILL.md（181 行）",
    ].join("\n");

    const segments = parseAiAssistantContent(raw);
    expect(segments).toHaveLength(4);
    expect(segments[0]).toEqual({
      kind: "prose",
      text: "Let me start by checking the current scene state.",
    });
    expect(segments[1].kind).toBe("ops");
    if (segments[1].kind === "ops") {
      expect(segments[1].ops).toHaveLength(2);
      expect(aiAssistantOpsCardTitle(segments[1].ops)).toBe("List current slides");
      expect(aiAssistantOpsCardBody(segments[1].ops)).toContain("ainobi scene info");
      expect(aiAssistantOpsCardBody(segments[1].ops)).toContain("ainobi slide list");
    }
    expect(segments[2]).toEqual({
      kind: "prose",
      text: "Let me read the skill documentation.",
    });
    expect(segments[3].kind).toBe("ops");
  });

  it("keeps tool results in ops when leading spaces were trimmed from fragment", () => {
    const raw = [
      "Let me start by checking the current scene state.",
      "",
      "· Bash：Get current scene info",
      "  $ ainobi scene info --verbose 2>&1",
      "",
      "→ {",
      '"scene_id": "sc_1",',
      "}",
      "",
      "· Bash：List current slides",
      "→ {\"slide_count\": 1}",
    ].join("\n");

    const segments = parseAiAssistantContent(raw);
    expect(segments).toHaveLength(2);
    expect(segments[0].kind).toBe("prose");
    expect(segments[1].kind).toBe("ops");
    if (segments[1].kind === "ops") {
      const body = aiAssistantOpsCardBody(segments[1].ops);
      expect(body).toContain("scene_id");
      expect(body).toContain("slide_count");
    }
    const proseText = segments
      .filter((s) => s.kind === "prose")
      .map((s) => (s.kind === "prose" ? s.text : ""))
      .join("\n");
    expect(proseText).not.toContain("scene_id");
    expect(proseText).not.toContain("slide_count");
  });

  it("groups bare tool titles with following results", () => {
    const raw = [
      "Let me start.",
      "",
      "Get current scene info",
      "→ {\"ok\": true}",
      "",
      "Let me read docs.",
    ].join("\n");

    const segments = parseAiAssistantContent(raw);
    expect(segments).toHaveLength(3);
    expect(segments[1].kind).toBe("ops");
    if (segments[1].kind === "ops") {
      expect(aiAssistantOpsCardTitle(segments[1].ops)).toBe("Get current scene info");
      expect(aiAssistantOpsCardBody(segments[1].ops)).toContain("ok");
    }
  });
});

describe("english status labels", () => {
  it("parses English Read summaries the same as legacy Chinese ones", () => {
    const legacy = [
      "· Read：/path/SKILL.md",
      "  → 已读取 /path/SKILL.md（181 行）",
    ].join("\n");
    const english = [
      "· Read: /path/SKILL.md",
      "  → Read /path/SKILL.md (181 lines)",
    ].join("\n");

    const legacySegments = parseAiAssistantContent(legacy);
    const englishSegments = parseAiAssistantContent(english);
    expect(englishSegments.map((s) => s.kind)).toEqual(legacySegments.map((s) => s.kind));
    expect(englishSegments[0]?.kind).toBe("ops");
    if (englishSegments[0]?.kind === "ops") {
      expect(englishSegments[0].ops).toHaveLength(1);
      expect(englishSegments[0].ops[0]?.toolName).toBe("Read");
      expect(englishSegments[0].ops[0]?.title).toBe("/path/SKILL.md");
    }
  });

  it("uses an English fallback title for headerless tool bodies", () => {
    const segments = parseAiAssistantContent('{"ok": true}');
    expect(segments).toHaveLength(1);
    if (segments[0]?.kind === "ops") {
      expect(segments[0].ops[0]?.title).toBe("Operations");
      expect(aiAssistantOpsCardTitle([])).toBe("Operations");
    } else {
      throw new Error("expected ops segment");
    }
  });
});
