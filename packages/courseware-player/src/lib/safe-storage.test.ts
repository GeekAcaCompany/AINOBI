// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanupEvictableLocalStorage,
  isQuotaExceededError,
  safeLocalStorageSetItem,
} from "./safe-storage.ts";

describe("safe-storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("detects QuotaExceededError", () => {
    const err = new DOMException("quota", "QuotaExceededError");
    expect(isQuotaExceededError(err)).toBe(true);
    expect(isQuotaExceededError(new Error("other"))).toBe(false);
  });

  it("does not evict protected keys like session", () => {
    localStorage.setItem("session", '{"access_token":"x"}');
    localStorage.setItem("courseware-editor-scene:abc", "x".repeat(1000));

    cleanupEvictableLocalStorage();

    expect(localStorage.getItem("session")).not.toBeNull();
    expect(localStorage.getItem("courseware-editor-scene:abc")).toBeNull();
  });

  it("retries setItem after evicting large cache", () => {
    localStorage.setItem("courseware-preview-scene:old", JSON.stringify({ createdAt: 0, scene: {} }));

    const originalSetItem = Storage.prototype.setItem;
    let calls = 0;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      calls += 1;
      if (calls === 1 && key === "session") {
        throw new DOMException("quota", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    });

    const ok = safeLocalStorageSetItem("session", '{"access_token":"ok"}');
    expect(ok).toBe(true);
    expect(localStorage.getItem("session")).toContain("ok");
    expect(localStorage.getItem("courseware-preview-scene:old")).toBeNull();
  });

  it("reclaims preview scene cache during cleanup", () => {
    // Preview scene packages are in EVICTABLE_PREFIXES: the cleanup round reclaims them whatever their TTL
    // (a regenerable cache; the old assertion "fresh survives" was really the bug of skipping keys while deleting during iteration)
    const expired = JSON.stringify({ createdAt: Date.now() - 48 * 60 * 60 * 1000, scene: {} });
    localStorage.setItem("courseware-preview-scene:expired", expired);
    localStorage.setItem(
      "courseware-preview-scene:fresh",
      JSON.stringify({ createdAt: Date.now(), scene: {} }),
    );

    cleanupEvictableLocalStorage();

    expect(localStorage.getItem("courseware-preview-scene:expired")).toBeNull();
    expect(localStorage.getItem("courseware-preview-scene:fresh")).toBeNull();
  });

  it("keeps protectKeys alive even when expired during cleanup", () => {
    // The local preview scene package in use when the resume position is saved: must not be cleared even when expired / under quota reclamation
    const activeBundle = JSON.stringify({
      createdAt: Date.now() - 48 * 60 * 60 * 1000,
      scene: {},
    });
    localStorage.setItem("courseware-preview-scene:active", activeBundle);
    localStorage.setItem("courseware-editor-scene:other", "x".repeat(1000));

    cleanupEvictableLocalStorage({ protectKeys: ["courseware-preview-scene:active"] });

    expect(localStorage.getItem("courseware-preview-scene:active")).not.toBeNull();
    expect(localStorage.getItem("courseware-editor-scene:other")).toBeNull();
  });

  it("reclaims expired playback resume entries during cleanup", () => {
    // Resume positions are reclaimed with a 30-day TTL: previously in the protected prefixes and never cleaned, so expired records piled up endlessly
    const expiredAt = Date.now() - 31 * 24 * 60 * 60 * 1000;
    localStorage.setItem(
      "recording-playback-position:sec-1%40user-1",
      JSON.stringify({ sourceKey: "rec-1", seconds: 30, updatedAt: expiredAt }),
    );
    localStorage.setItem(
      "courseware-playback-position:cw-1%40user-1",
      JSON.stringify({ sceneTimeMs: 30000, updatedAt: expiredAt }),
    );
    localStorage.setItem(
      "recording-playback-position:sec-1%40user-2",
      JSON.stringify({ sourceKey: "rec-1", seconds: 30, updatedAt: Date.now() }),
    );

    cleanupEvictableLocalStorage();

    expect(localStorage.getItem("recording-playback-position:sec-1%40user-1")).toBeNull();
    expect(localStorage.getItem("courseware-playback-position:cw-1%40user-1")).toBeNull();
    expect(localStorage.getItem("recording-playback-position:sec-1%40user-2")).not.toBeNull();
  });

  it("keeps live playback resume entries during normal cleanup", () => {
    // Unexpired resume positions aren't an evictable cache: ordinary reclamation leaves them, only aggressive reclamation as a last resort
    localStorage.setItem(
      "recording-playback-position:sec-1%40user-1",
      JSON.stringify({ sourceKey: "rec-1", seconds: 30, updatedAt: Date.now() }),
    );
    localStorage.setItem("courseware-editor-scene:abc", "x".repeat(1000));

    cleanupEvictableLocalStorage();

    expect(localStorage.getItem("recording-playback-position:sec-1%40user-1")).not.toBeNull();
    expect(localStorage.getItem("courseware-editor-scene:abc")).toBeNull();
  });
});
