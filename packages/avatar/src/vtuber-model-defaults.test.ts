// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import { configureAvatar } from "./host.ts";
import {
  getVtuberModelUrlFromMetadata,
  normalizeVtuberMetadataForPersistence,
} from "./vtuber-model-defaults.ts";

const DEFAULT_AI_TEACHER_MODEL_URL = "model/teachers/default/teacher.inx";
configureAvatar({ aiTeacherDefaultModelUrl: DEFAULT_AI_TEACHER_MODEL_URL, defaultModelUrl: "/models/teacher.inx" });

describe("vtuber-model-defaults", () => {
  it("fills default CDN model URL for AI teacher vtuber on persistence", () => {
    const next = normalizeVtuberMetadataForPersistence({
      ai_teacher_id: "00000000-0000-4000-8000-000000000001",
      ai_teacher_name: "Test",
    });
    expect(next.model_url).toBe(DEFAULT_AI_TEACHER_MODEL_URL);
    expect(next.ai_teacher_live2d_model_url).toBe(DEFAULT_AI_TEACHER_MODEL_URL);
    expect(next.runtime).toBe("inochi2d");
  });

  it("resolves the host default for a vtuber without a model or teacher", () => {
    expect(getVtuberModelUrlFromMetadata({})).toBe("/models/teacher.inx");
  });

  it("leaves vtuber without ai_teacher_id unchanged on persistence", () => {
    const meta = { model_url: "" };
    expect(normalizeVtuberMetadataForPersistence(meta)).toBe(meta);
  });

  it("resolves display URL for AI teacher without explicit model", () => {
    expect(
      getVtuberModelUrlFromMetadata({
        ai_teacher_id: "00000000-0000-4000-8000-000000000001",
      }),
    ).toBe(DEFAULT_AI_TEACHER_MODEL_URL);
  });

  it("aliases legacy .model3.js URLs to .model3.json", () => {
    expect(
      getVtuberModelUrlFromMetadata({
        model_url:
          "https://objectstorage.ap-tokyo-1.oraclecloud.com/n/examplenamespace/b/example-public/o/public/live2d_models/ainobi-teacher-001/ainobi-teacher-001.model3.js",
      }),
    ).toBe(
      "https://objectstorage.ap-tokyo-1.oraclecloud.com/n/examplenamespace/b/example-public/o/public/live2d_models/ainobi-teacher-001/ainobi-teacher-001.model3.json",
    );
    expect(getVtuberModelUrlFromMetadata({ model_url: "/m/x.model3.json" })).toBe(
      "/m/x.model3.json",
    );
  });
});
