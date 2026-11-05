// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from "vitest";
import { presignBatchWithInternalNetworkFallback } from "./presign-scene.ts";

describe("presignBatchWithInternalNetworkFallback", () => {
  it("falls back to a public re-presign when every intranet URL is unreachable", async () => {
    const presign = vi
      .fn()
      .mockResolvedValueOnce({ "a.mp3": "https://bucket.oss-ap-northeast-1-internal.aliyuncs.com/a.mp3" })
      .mockResolvedValueOnce({ "a.mp3": "https://bucket.oss-ap-northeast-1.aliyuncs.com/a.mp3" });
    const probe = vi.fn().mockResolvedValue(false);

    const result = await presignBatchWithInternalNetworkFallback(presign, "internal", probe);

    expect(presign).toHaveBeenNthCalledWith(1, "internal");
    expect(presign).toHaveBeenNthCalledWith(2, "public");
    expect(probe).toHaveBeenCalledWith("https://bucket.oss-ap-northeast-1-internal.aliyuncs.com/a.mp3");
    expect(result).toEqual({ "a.mp3": "https://bucket.oss-ap-northeast-1.aliyuncs.com/a.mp3" });
  });

  it("re-signs only unreachable intranet URLs as public when the batch is partially reachable", async () => {
    const presign = vi
      .fn()
      .mockResolvedValueOnce({
        "a.mp3": "https://bucket.oss-ap-northeast-1-internal.aliyuncs.com/a.mp3",
        "b.mp3": "https://bucket.oss-ap-northeast-1-internal.aliyuncs.com/b.mp3",
      })
      .mockResolvedValueOnce({
        "a.mp3": "https://bucket.oss-ap-northeast-1.aliyuncs.com/a.mp3",
        "b.mp3": "https://bucket.oss-ap-northeast-1.aliyuncs.com/b.mp3",
      });
    const probe = vi.fn(async (url: string) => !url.includes("/b.mp3"));

    const result = await presignBatchWithInternalNetworkFallback(presign, "internal", probe);

    expect(presign).toHaveBeenCalledTimes(2);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      "a.mp3": "https://bucket.oss-ap-northeast-1-internal.aliyuncs.com/a.mp3",
      "b.mp3": "https://bucket.oss-ap-northeast-1.aliyuncs.com/b.mp3",
    });
  });

  it("keeps the intranet result when the probe succeeds (no extra request)", async () => {
    const presign = vi
      .fn()
      .mockResolvedValueOnce({ "a.mp3": "https://bucket.oss-ap-northeast-1-internal.aliyuncs.com/a.mp3" });
    const probe = vi.fn().mockResolvedValue(true);

    const result = await presignBatchWithInternalNetworkFallback(presign, "internal", probe);

    expect(presign).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ "a.mp3": "https://bucket.oss-ap-northeast-1-internal.aliyuncs.com/a.mp3" });
  });

  it("never probes when network is public or unspecified", async () => {
    const presign = vi.fn().mockResolvedValue({ "a.mp3": "https://bucket.oss-ap-northeast-1.aliyuncs.com/a.mp3" });
    const probe = vi.fn();

    await presignBatchWithInternalNetworkFallback(presign, "public", probe);
    await presignBatchWithInternalNetworkFallback(presign, undefined, probe);

    expect(probe).not.toHaveBeenCalled();
  });

  it("skips the probe (and returns as-is) when the batch came back empty", async () => {
    const presign = vi.fn().mockResolvedValue({});
    const probe = vi.fn();

    const result = await presignBatchWithInternalNetworkFallback(presign, "internal", probe);

    expect(probe).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });
});
