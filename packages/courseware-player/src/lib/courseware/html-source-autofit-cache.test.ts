// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import coursewareAssetsApi from "../../api/courseware_assets.ts";
import { fetchHtmlSourceForAutofit } from "../../components/courseware/CoursewareHtmlStageEmbed.tsx";
import {
  clearHtmlSourceAutofitMemoryCacheForTests,
  invalidateHtmlSourceAutofitCacheAsync,
  readHtmlSourceAutofitCache,
  resolveHtmlSourceAutofitCacheKey,
} from "./html-source-autofit-cache.ts";

vi.mock("../../api/courseware_assets.ts", () => ({
  default: {
    readAssetText: vi.fn(),
  },
}));

const HTML_SAMPLE = "<html><body><div>Quiz</div></body></html>";
const ASSET_PATH = "organization/org-1/courseware_assets/cw-1/page.html";
const ASSET_SRC = `https://cdn.example.com/v1/courseware/asset/file/${ASSET_PATH}?X-Amz-Signature=abc`;

type MockCache = {
  match: (request: Request) => Promise<Response | undefined>;
  put: (request: Request, response: Response) => Promise<void>;
  delete: (request: Request) => Promise<boolean>;
  keys: () => Promise<Request[]>;
};

function createMockCacheStorage(): { store: Map<string, Response>; caches: CacheStorage } {
  const store = new Map<string, Response>();
  const open = vi.fn(async (): Promise<MockCache> => ({
    match: async (request: Request) => store.get(request.url),
    put: async (request: Request, response: Response) => {
      store.set(request.url, response);
    },
    delete: async (request: Request) => store.delete(request.url),
    keys: async () => [...store.keys()].map((url) => new Request(url)),
  }));

  return {
    store,
    caches: {
      open,
      delete: vi.fn(async () => {
        store.clear();
        return true;
      }),
      has: vi.fn(async () => true),
      keys: vi.fn(async () => []),
      match: vi.fn(async () => undefined),
    } as unknown as CacheStorage,
  };
}

describe("html source autofit cache", () => {
  let mockCache: ReturnType<typeof createMockCacheStorage>;

  beforeEach(() => {
    mockCache = createMockCacheStorage();
    vi.stubGlobal("caches", mockCache.caches);
  });

  afterEach(async () => {
    await invalidateHtmlSourceAutofitCacheAsync();
    vi.mocked(coursewareAssetsApi.readAssetText).mockReset();
    vi.unstubAllGlobals();
  });

  it("persists HTML in Cache Storage across memory clears (page refresh)", async () => {
    vi.mocked(coursewareAssetsApi.readAssetText).mockResolvedValue(HTML_SAMPLE);

    const first = await fetchHtmlSourceForAutofit(ASSET_SRC, "cw-1");
    expect(first).toEqual({ ok: true, html: HTML_SAMPLE });
    expect(coursewareAssetsApi.readAssetText).toHaveBeenCalledTimes(1);

    clearHtmlSourceAutofitMemoryCacheForTests();

    const cacheKey = resolveHtmlSourceAutofitCacheKey(ASSET_SRC, "cw-1");
    expect(cacheKey).toBeTruthy();
    const fromPersisted = await readHtmlSourceAutofitCache(cacheKey!);
    expect(fromPersisted).toEqual({ ok: true, html: HTML_SAMPLE });

    const second = await fetchHtmlSourceForAutofit(ASSET_SRC, "cw-1");
    expect(second).toEqual({ ok: true, html: HTML_SAMPLE });
    expect(coursewareAssetsApi.readAssetText).toHaveBeenCalledTimes(1);
    expect(mockCache.store.size).toBe(1);
  });

  it("removes persisted HTML after invalidation", async () => {
    vi.mocked(coursewareAssetsApi.readAssetText).mockResolvedValue(HTML_SAMPLE);

    await fetchHtmlSourceForAutofit(ASSET_SRC, "cw-1");
    await invalidateHtmlSourceAutofitCacheAsync({ coursewareId: "cw-1", src: ASSET_SRC });
    clearHtmlSourceAutofitMemoryCacheForTests();
    expect(mockCache.store.size).toBe(0);

    await fetchHtmlSourceForAutofit(ASSET_SRC, "cw-1");
    expect(coursewareAssetsApi.readAssetText).toHaveBeenCalledTimes(2);
  });
});
