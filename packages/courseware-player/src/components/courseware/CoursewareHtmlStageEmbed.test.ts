// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import coursewareAssetsApi from "../../api/courseware_assets.ts";
import {
  publishEditorStageHtmlBaseline,
  peekEditorStageHtmlBaseline,
  fetchHtmlSourceForAutofit,
  invalidateHtmlSourceAutofitCacheAsync,
  injectBaseTag,
  prepareHtmlForEmbed,
  resolveBaseHrefFromUrl,
  resolveHtmlEmbedContentFitLayout,
  resolveHtmlEmbedFitLayout,
  resolveHtmlEmbedStageLayout,
  resolveHtmlEmbedViewportPaint,
  resolveHtmlContentZoom,
  resolveHtmlSourceAutofitCacheKey,
} from "./CoursewareHtmlStageEmbed.tsx";

vi.mock("../../api/courseware_assets.ts", () => ({
  default: {
    readAssetText: vi.fn(),
  },
}));

const HTML_SAMPLE = "<html><body><div>Quiz</div></body></html>";
const ASSET_PATH = "organization/org-1/courseware_assets/cw-1/page.html";
const ASSET_SRC = `https://cdn.example.com/v1/courseware/asset/file/${ASSET_PATH}?X-Amz-Signature=abc`;

function stubCacheApi(): Map<string, Response> {
  const store = new Map<string, Response>();
  vi.stubGlobal("caches", {
    open: vi.fn(async () => ({
      match: async (request: Request) => store.get(request.url),
      put: async (request: Request, response: Response) => {
        store.set(request.url, response);
      },
      delete: async (request: Request) => store.delete(request.url),
      keys: async () => [...store.keys()].map((url) => new Request(url)),
    })),
    delete: vi.fn(async () => {
      store.clear();
      return true;
    }),
    has: vi.fn(async () => true),
    keys: vi.fn(async () => []),
    match: vi.fn(async () => undefined),
  } as unknown as CacheStorage);
  return store;
}

beforeEach(() => {
  stubCacheApi();
});

afterEach(async () => {
  await invalidateHtmlSourceAutofitCacheAsync();
  vi.mocked(coursewareAssetsApi.readAssetText).mockReset();
  vi.unstubAllGlobals();
});

describe("resolveHtmlEmbedFitLayout", () => {
  it("keeps iframe layout at baseline and shrinks to thumbnail target", () => {
    const fit = resolveHtmlEmbedFitLayout({
      widthLogical: 1920,
      heightLogical: 1080,
      targetWidthPx: 200,
      targetHeightPx: 112.5,
      layoutBaselineScale: 0.29,
      layoutScale: 0.29,
    });
    expect(fit.fitScale).toBeCloseTo(200 / 1920, 5);
    expect(fit.layoutBaselineScale).toBe(0.29);
    expect(fit.zoomMul).toBeLessThan(1);
    expect(fit.layoutW * fit.zoomMul).toBeCloseTo(fit.wTarget, 0);
  });
});

describe("fetchHtmlSourceForAutofit", () => {
  it("returns error for non-http src", async () => {
    const result = await fetchHtmlSourceForAutofit("data:text/html,<div/>");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Unsupported");
    }
  });

  it("reuses in-memory cache for the same courseware asset", async () => {
    vi.mocked(coursewareAssetsApi.readAssetText).mockResolvedValue(HTML_SAMPLE);

    const first = await fetchHtmlSourceForAutofit(ASSET_SRC, "cw-1");
    const second = await fetchHtmlSourceForAutofit(ASSET_SRC, "cw-1");

    expect(first).toEqual({ ok: true, html: HTML_SAMPLE });
    expect(second).toEqual(first);
    expect(coursewareAssetsApi.readAssetText).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent requests for the same asset", async () => {
    let proxyCalls = 0;
    vi.mocked(coursewareAssetsApi.readAssetText).mockImplementation(async () => {
      proxyCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return HTML_SAMPLE;
    });

    const [resultA, resultB] = await Promise.all([
      fetchHtmlSourceForAutofit(ASSET_SRC, "cw-1"),
      fetchHtmlSourceForAutofit(ASSET_SRC, "cw-1"),
    ]);

    expect(proxyCalls).toBe(1);
    expect(resultA).toEqual({ ok: true, html: HTML_SAMPLE });
    expect(resultB).toEqual(resultA);
  });

  it("shares cache across signed URL variants of the same asset path", async () => {
    vi.mocked(coursewareAssetsApi.readAssetText).mockResolvedValue(HTML_SAMPLE);
    const signedA = `https://cdn.example.com/v1/courseware/asset/file/${ASSET_PATH}?X-Amz-Signature=aaa`;
    const signedB = `https://cdn.example.com/v1/courseware/asset/file/${ASSET_PATH}?X-Amz-Signature=bbb`;

    await fetchHtmlSourceForAutofit(signedA, "cw-1");
    await fetchHtmlSourceForAutofit(signedB, "cw-1");

    expect(resolveHtmlSourceAutofitCacheKey(signedA, "cw-1")).toBe(
      resolveHtmlSourceAutofitCacheKey(signedB, "cw-1"),
    );
    expect(coursewareAssetsApi.readAssetText).toHaveBeenCalledTimes(1);
  });

  it("drops cached HTML after invalidation", async () => {
    vi.mocked(coursewareAssetsApi.readAssetText).mockResolvedValue(HTML_SAMPLE);

    await fetchHtmlSourceForAutofit(ASSET_SRC, "cw-1");
    await invalidateHtmlSourceAutofitCacheAsync({ coursewareId: "cw-1", src: ASSET_SRC });
    await fetchHtmlSourceForAutofit(ASSET_SRC, "cw-1");

    expect(coursewareAssetsApi.readAssetText).toHaveBeenCalledTimes(2);
  });
});

describe("prepareHtmlForEmbed", () => {
  it("injects base href and autofit reporter for remote HTML", () => {
    const prepared = prepareHtmlForEmbed(
      "<html><head></head><body><div>Quiz</div></body></html>",
      "https://cdn.example.com/assets/quiz.html",
      "el_html_1",
      "nonce-1",
    );
    expect(prepared).toContain('<base href="https://cdn.example.com/assets/">');
    expect(prepared).toContain("ainobi:html-autofit-size");
    expect(prepared).toContain("el_html_1");
  });
});

describe("resolveHtmlEmbedContentFitLayout", () => {
  it("expands iframe viewport when content overflows the element box", () => {
    const fit = resolveHtmlEmbedContentFitLayout({
      layoutW: 800,
      layoutH: 450,
      targetWidthPx: 400,
      targetHeightPx: 225,
      fallbackZoomMul: 0.5,
      contentSize: { width: 1600, height: 900 },
    });
    expect(fit.contentFitActive).toBe(true);
    expect(fit.layoutW).toBe(1600);
    expect(fit.layoutH).toBe(900);
    expect(fit.layoutW * fit.zoomMul).toBeCloseTo(400, 0);
  });
});

describe("resolveHtmlEmbedViewportPaint", () => {
  const base = {
    widthLogical: 1600,
    heightLogical: 900,
    targetWidthPx: 672,
    targetHeightPx: 378,
    contentSize: { width: 800, height: 400 },
  };

  it("shrinks the iframe viewport as content zoom increases (DPI model)", () => {
    const at100 = resolveHtmlEmbedViewportPaint({ ...base, contentZoom: 1 });
    const at250 = resolveHtmlEmbedViewportPaint({ ...base, contentZoom: 2.5 });
    expect(at100.viewportW).toBe(1600);
    expect(at100.viewportH).toBe(900);
    expect(at250.viewportW).toBe(640);
    expect(at250.viewportH).toBe(360);
    expect(at250.dpiScale).toBe(2.5);
  });

  it("keeps paintScale fixed to the element box as zoom changes", () => {
    const paints = [1, 1.5, 2, 2.5].map((contentZoom) =>
      resolveHtmlEmbedViewportPaint({ ...base, contentZoom }),
    );
    for (const paint of paints) {
      expect(paint.paintScale).toBeCloseTo(base.targetWidthPx / base.widthLogical, 5);
      expect(paint.boxLayoutW * paint.paintScale).toBeCloseTo(base.targetWidthPx, 0);
    }
  });

  it("does not shrink paintScale when content measurement reports overflow", () => {
    const normal = resolveHtmlEmbedViewportPaint({ ...base, contentZoom: 2.5 });
    const inflated = resolveHtmlEmbedViewportPaint({
      ...base,
      contentZoom: 2.5,
      contentSize: { width: 4000, height: 3000 },
    });
    expect(inflated.paintScale).toBe(normal.paintScale);
  });

  it("uses more of the element width at higher zoom for fixed-width HTML", () => {
    const at100 = resolveHtmlEmbedViewportPaint({ ...base, contentZoom: 1 });
    const at250 = resolveHtmlEmbedViewportPaint({ ...base, contentZoom: 2.5 });
    const usageAt100 = (base.contentSize.width * at100.dpiScale) / at100.boxLayoutW;
    const usageAt250 = (base.contentSize.width * at250.dpiScale) / at250.boxLayoutW;
    expect(usageAt250).toBeGreaterThan(usageAt100);
  });
});

describe("resolveHtmlEmbedStageLayout", () => {
  it("uses logical element size for iframe layout regardless of painted target size", () => {
    const atFit = resolveHtmlEmbedStageLayout({
      widthLogical: 1600,
      heightLogical: 900,
      targetWidthPx: 672,
      targetHeightPx: 378,
    });
    expect(atFit.layoutW).toBe(1600);
    expect(atFit.layoutH).toBe(900);
    expect(atFit.zoomMul).toBeCloseTo(0.42, 5);
  });
});

describe("resolveHtmlContentZoom", () => {
  it("clamps invalid zoom to allowed range", () => {
    expect(resolveHtmlContentZoom(undefined)).toBe(1);
    expect(resolveHtmlContentZoom(9)).toBe(2.5);
    expect(resolveHtmlContentZoom(0.1)).toBe(1);
  });
});

describe("editor stage html baseline", () => {
  it("publishes once per element for minimap / thumbnails to read", () => {
    const id = "el_html_editor_baseline_test";
    expect(publishEditorStageHtmlBaseline(id, 0.29)).toBe(0.29);
    expect(publishEditorStageHtmlBaseline(id, 0.58)).toBe(0.29);
    expect(peekEditorStageHtmlBaseline(id)).toBe(0.29);
  });
});
