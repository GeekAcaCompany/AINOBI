// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildCoursewarePlaybackResumeKey,
  clearCoursewarePlaybackResume,
  migrateStandaloneCoursewarePlaybackResume,
  readCoursewarePlaybackResume,
  saveCoursewarePlaybackResume,
} from "./playback-resume.ts";

describe("buildCoursewarePlaybackResumeKey", () => {
  it("builds a namespaced key from the courseware identity", () => {
    expect(buildCoursewarePlaybackResumeKey("abc-123")).toBe(
      "courseware-playback-position:abc-123",
    );
  });

  it("returns null for blank identities", () => {
    expect(buildCoursewarePlaybackResumeKey(null)).toBeNull();
    expect(buildCoursewarePlaybackResumeKey("   ")).toBeNull();
  });
});

describe("readCoursewarePlaybackResume / saveCoursewarePlaybackResume", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("round-trips a saved playhead", () => {
    const key = buildCoursewarePlaybackResumeKey("cw-1");
    expect(saveCoursewarePlaybackResume(key, 42000, 120000)).toBe(true);
    expect(readCoursewarePlaybackResume(key)).toMatchObject({ sceneTimeMs: 42000 });
  });

  it("treats a zero playhead as a rewind and clears the stored position", () => {
    const key = buildCoursewarePlaybackResumeKey("cw-2");
    expect(saveCoursewarePlaybackResume(key, 60000, 120000)).toBe(true);
    expect(saveCoursewarePlaybackResume(key, 0, 120000)).toBe(true);
    expect(readCoursewarePlaybackResume(key)).toBeNull();
  });

  it("rejects invalid playheads and null keys", () => {
    const key = buildCoursewarePlaybackResumeKey("cw-2b");
    expect(saveCoursewarePlaybackResume(key, -5, 120000)).toBe(false);
    expect(saveCoursewarePlaybackResume(key, Number.NaN, 120000)).toBe(false);
    expect(saveCoursewarePlaybackResume(null, 5000, 120000)).toBe(false);
    expect(readCoursewarePlaybackResume(key)).toBeNull();
  });

  it("clears the stored position once playback reaches the ending", () => {
    const key = buildCoursewarePlaybackResumeKey("cw-3");
    expect(saveCoursewarePlaybackResume(key, 60000, 120000)).toBe(true);
    // Less than 1s from the end: counts as finished, the resume position is cleared
    expect(saveCoursewarePlaybackResume(key, 119500, 120000)).toBe(true);
    expect(readCoursewarePlaybackResume(key)).toBeNull();
  });

  it("drops corrupted entries instead of throwing", () => {
    const key = buildCoursewarePlaybackResumeKey("cw-4");
    window.localStorage.setItem(key ?? "", "{not-json");
    expect(readCoursewarePlaybackResume(key)).toBeNull();
    window.localStorage.setItem(key ?? "", JSON.stringify({ sceneTimeMs: "x" }));
    expect(readCoursewarePlaybackResume(key)).toBeNull();
  });

  it("expires entries older than the TTL", () => {
    const key = buildCoursewarePlaybackResumeKey("cw-5");
    window.localStorage.setItem(
      key ?? "",
      JSON.stringify({ sceneTimeMs: 5000, updatedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 }),
    );
    expect(readCoursewarePlaybackResume(key)).toBeNull();
  });

  it("clears the position explicitly", () => {
    const key = buildCoursewarePlaybackResumeKey("cw-6");
    saveCoursewarePlaybackResume(key, 30000, 120000);
    clearCoursewarePlaybackResume(key);
    expect(readCoursewarePlaybackResume(key)).toBeNull();
    expect(() => clearCoursewarePlaybackResume(null)).not.toThrow();
  });
});

describe("migrateStandaloneCoursewarePlaybackResume", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("moves a valid legacy entry to the scoped key and removes the legacy one", () => {
    const legacyKey = buildCoursewarePlaybackResumeKey("cw-old@user-1");
    const key = buildCoursewarePlaybackResumeKey("cw-old@user-1@standalone");
    window.localStorage.setItem(
      legacyKey ?? "",
      JSON.stringify({ sceneTimeMs: 42000, updatedAt: Date.now() }),
    );
    migrateStandaloneCoursewarePlaybackResume(key, legacyKey, 120000);
    expect(readCoursewarePlaybackResume(key)).toMatchObject({ sceneTimeMs: 42000 });
    expect(window.localStorage.getItem(legacyKey ?? "")).toBeNull();
  });

  it("keeps the scoped entry when one already exists", () => {
    const legacyKey = buildCoursewarePlaybackResumeKey("cw-old@user-2");
    const key = buildCoursewarePlaybackResumeKey("cw-old@user-2@standalone");
    saveCoursewarePlaybackResume(key, 80000, 120000);
    window.localStorage.setItem(
      legacyKey ?? "",
      JSON.stringify({ sceneTimeMs: 42000, updatedAt: Date.now() }),
    );
    migrateStandaloneCoursewarePlaybackResume(key, legacyKey, 120000);
    expect(readCoursewarePlaybackResume(key)).toMatchObject({ sceneTimeMs: 80000 });
    expect(window.localStorage.getItem(legacyKey ?? "")).not.toBeNull();
  });

  it("ignores invalid or expired legacy entries", () => {
    const legacyKey = buildCoursewarePlaybackResumeKey("cw-old@user-3");
    const key = buildCoursewarePlaybackResumeKey("cw-old@user-3@standalone");
    window.localStorage.setItem(
      legacyKey ?? "",
      JSON.stringify({
        sceneTimeMs: 42000,
        updatedAt: Date.now() - 31 * 24 * 60 * 60 * 1000,
      }),
    );
    migrateStandaloneCoursewarePlaybackResume(key, legacyKey, 120000);
    expect(readCoursewarePlaybackResume(key)).toBeNull();
    expect(window.localStorage.getItem(legacyKey ?? "")).not.toBeNull();
  });

  it("clears both keys when the legacy head is inside the ending window", () => {
    const legacyKey = buildCoursewarePlaybackResumeKey("cw-old@user-4");
    const key = buildCoursewarePlaybackResumeKey("cw-old@user-4@standalone");
    window.localStorage.setItem(
      legacyKey ?? "",
      JSON.stringify({ sceneTimeMs: 119500, updatedAt: Date.now() }),
    );
    migrateStandaloneCoursewarePlaybackResume(key, legacyKey, 120000);
    expect(readCoursewarePlaybackResume(key)).toBeNull();
    expect(window.localStorage.getItem(legacyKey ?? "")).toBeNull();
  });

  it("no-ops on missing or identical keys", () => {
    const key = buildCoursewarePlaybackResumeKey("cw-old@user-5");
    expect(() => migrateStandaloneCoursewarePlaybackResume(null, key, 120000)).not.toThrow();
    expect(() => migrateStandaloneCoursewarePlaybackResume(key, key, 120000)).not.toThrow();
    expect(readCoursewarePlaybackResume(key)).toBeNull();
  });
});
