// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import {
  collectHtmlAssetRefs,
  resolveHtmlRefToKey,
  rewriteHtmlWithSignedRefs,
  rewriteHtmlSlideAssets,
} from "./html-asset-rewrite.ts";

describe("collectHtmlAssetRefs", () => {
  it("collects src/href/poster/data-src and css url()", () => {
    const html = `<html><head><link rel="stylesheet" href="style.css"></head>
<body style="background:url('bg.png')">
<img src="assets/封面.png" data-src="assets/lazy.png">
<a href="https://example.com/x">ext</a>
</body></html>`;
    const refs = collectHtmlAssetRefs(html);
    expect(refs).toContain("style.css");
    expect(refs).toContain("bg.png");
    expect(refs).toContain("assets/封面.png");
    expect(refs).toContain("assets/lazy.png");
    expect(refs).toContain("https://example.com/x");
  });
});

describe("resolveHtmlRefToKey", () => {
  const htmlKey = "raw/html/abc.html";

  it("resolves relative refs against the html key dir (browser <base> semantics)", () => {
    expect(resolveHtmlRefToKey("assets/封面.png", htmlKey)).toBe("raw/html/assets/封面.png");
    expect(resolveHtmlRefToKey("./a.png", htmlKey)).toBe("raw/html/a.png");
    expect(resolveHtmlRefToKey("../jpg/x.jpg", htmlKey)).toBe("raw/jpg/x.jpg");
  });

  it("extracts keys from absolute storage URLs (aliyun / OCI / signed)", () => {
    expect(
      resolveHtmlRefToKey(
        "https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/jpg/f4be.jpg",
        htmlKey,
      ),
    ).toBe("raw/jpg/f4be.jpg");
    expect(
      resolveHtmlRefToKey(
        "https://examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com/example-storage/raw/mp3/ef.mp3?X-Amz-Signature=abc",
        htmlKey,
      ),
    ).toBe("raw/mp3/ef.mp3");
  });

  it("returns null for external/non-asset refs", () => {
    expect(resolveHtmlRefToKey("https://static.cloudflareinsights.com/beacon.js", htmlKey)).toBeNull();
    expect(resolveHtmlRefToKey("data:image/png;base64,xxx", htmlKey)).toBeNull();
    expect(resolveHtmlRefToKey("#anchor", htmlKey)).toBeNull();
  });
});

describe("rewriteHtmlWithSignedRefs", () => {
  it("rewrites matching refs and leaves the rest untouched", () => {
    const html = `<img src="assets/a.png"><img src='keep.png'>background:url('assets/b.png')`;
    const out = rewriteHtmlWithSignedRefs(html, (ref) => {
      if (ref === "assets/a.png") return "https://signed/a.png?sig=1";
      if (ref === "assets/b.png") return "https://signed/b.png?sig=2";
      return undefined;
    });
    expect(out).toContain('src="https://signed/a.png?sig=1"');
    expect(out).toContain("url('https://signed/b.png?sig=2')");
    expect(out).toContain("keep.png");
  });

  it("handles &amp;-escaped attribute values", () => {
    const out = rewriteHtmlWithSignedRefs(`<img src="assets/a&amp;b.png">`, (ref) =>
      ref === "assets/a&b.png" ? "https://signed/ab.png" : undefined,
    );
    expect(out).toContain("https://signed/ab.png");
  });
});

describe("rewriteHtmlSlideAssets", () => {
  it("presigns resolved keys and rewrites the html", async () => {
    const html = `<img src="assets/封面.png">`;
    const out = await rewriteHtmlSlideAssets(html, "https://host/example-storage/raw/html/abc.html?sig=x", {
      coursewareId: "cw-1",
      presign: async (keys) => {
        expect(keys).toEqual(["raw/html/assets/封面.png"]);
        return { "raw/html/assets/封面.png": "https://signed/cover.png?s=1" };
      },
    });
    expect(out).toContain("https://signed/cover.png?s=1");
  });

  it("returns html unchanged when presign fails or no coursewareId", async () => {
    const html = `<img src="assets/封面.png">`;
    const out1 = await rewriteHtmlSlideAssets(html, "https://host/raw/html/abc.html", {
      coursewareId: null,
      presign: async () => ({}),
    });
    expect(out1).toBe(html);
    const out2 = await rewriteHtmlSlideAssets(html, "https://host/raw/html/abc.html", {
      coursewareId: "cw-1",
      presign: async () => {
        throw new Error("boom");
      },
    });
    expect(out2).toBe(html);
  });
});
