// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "vitest";

import {
  filterMentionRecents,
  readResourceMentionRecents,
  readTemplateMentionRecents,
  recordAssetMentionRecent,
  recordContentTemplateMentionRecent,
  recordCoursewareMentionRecent,
  recordDesignTemplateMentionRecent,
  removeContentTemplateMentionRecent,
  removeDesignTemplateMentionRecent,
} from "./ai-mention-recents.ts";

describe("ai-mention-recents", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("records resource MRU per courseware and trims to 12", () => {
    const coursewareId = "cw-resource-1";
    for (let i = 0; i < 14; i += 1) {
      recordAssetMentionRecent(coursewareId, {
        id: `asset-${i}`,
        name: `file-${i}.png`,
        extension: "png",
      });
    }
    const rows = readResourceMentionRecents(coursewareId);
    expect(rows).toHaveLength(12);
    expect(rows[0]?.id).toBe("asset-13");
    expect(rows.every((row) => row.kind === "asset" || row.kind === "courseware")).toBe(true);
  });

  it("keeps courseware and asset buckets separate from template org buckets", () => {
    recordAssetMentionRecent("cw-a", { id: "a1", name: "a.png", extension: "png" });
    recordCoursewareMentionRecent("cw-a", {
      id: "ref-1",
      key: "ref-key",
      title: "参考课件",
    });
    recordDesignTemplateMentionRecent("org-1", { id: "d1", name: "设计模板" });
    recordContentTemplateMentionRecent("org-1", { id: "c1", name: "内容模板" });

    expect(readResourceMentionRecents("cw-a").map((r) => r.kind)).toEqual([
      "courseware",
      "asset",
    ]);
    expect(readTemplateMentionRecents("org-1").map((r) => r.kind)).toEqual([
      "content_template",
      "design_template",
    ]);
    expect(readTemplateMentionRecents("org-other")).toEqual([]);
  });

  it("removes template recents when a template is deleted", () => {
    recordDesignTemplateMentionRecent("org-1", { id: "d1", name: "设计模板" });
    recordContentTemplateMentionRecent("org-1", { id: "c1", name: "内容模板" });
    recordDesignTemplateMentionRecent("org-1", { id: "d2", name: "设计模板 2" });

    removeDesignTemplateMentionRecent("org-1", "d1");
    expect(readTemplateMentionRecents("org-1").map((r) => r.id)).toEqual(["d2", "c1"]);

    removeContentTemplateMentionRecent("org-1", "c1");
    expect(readTemplateMentionRecents("org-1").map((r) => r.id)).toEqual(["d2"]);
  });

  it("filterMentionRecents matches name / extension / kind", () => {
    const rows = [
      {
        kind: "asset" as const,
        id: "1",
        name: "diagram.png",
        extension: "png",
        touchedAt: 1,
      },
      {
        kind: "courseware" as const,
        id: "2",
        key: "k2",
        name: "解剖课件",
        touchedAt: 2,
      },
    ];
    expect(filterMentionRecents(rows, "png")).toHaveLength(1);
    expect(filterMentionRecents(rows, "解剖")[0]?.id).toBe("2");
    expect(filterMentionRecents(rows, "courseware")).toHaveLength(1);
  });
});
