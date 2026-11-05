// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from "vitest";
import { probeUrlReachable } from "./oss-internal-reachability-probe.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("probeUrlReachable", () => {
  it("resolves true when fetch completes (even opaque no-cors response)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({} as Response);
    await expect(probeUrlReachable("https://example.internal/asset.mp3")).resolves.toBe(true);
  });

  it("resolves false when fetch rejects (DNS/connection failure)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(probeUrlReachable("https://example.internal/asset.mp3")).resolves.toBe(false);
  });

  it("resolves false when the probe times out", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const pending = probeUrlReachable("https://example.internal/asset.mp3", 1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toBe(false);
    vi.useRealTimers();
  });

  it("treats a missing fetch implementation as reachable (never blocks non-browser runtimes)", async () => {
    // @ts-expect-error simulate a runtime without fetch
    globalThis.fetch = undefined;
    await expect(probeUrlReachable("https://example.internal/asset.mp3")).resolves.toBe(true);
  });
});
