// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "vitest";

import { normalizeCoursewareAssetUrlForPersistence } from "./asset-url-persistence.ts";
import { normalizeScenePatchForPersistence } from "./scene-persistence-normalize.ts";

const envSnapshot = { ...process.env };

afterEach(() => {
  process.env = { ...envSnapshot };
});

describe("normalizeScenePatchForPersistence", () => {
  it("persists internal signed OSS url in patch replace value as bare key", () => {
    process.env.OSS_BUCKET = "example-courseware";
    process.env.OSS_ENDPOINT = "https://oss-ap-northeast-1-internal.aliyuncs.com";
    process.env.OSS_PUBLIC_BASE_URL = "https://example-courseware.oss-ap-northeast-1.aliyuncs.com";

    const internal =
      "https://example-courseware.oss-ap-northeast-1-internal.aliyuncs.com/raw/png/abc.png?Signature=x";
    const patch = normalizeScenePatchForPersistence([
      { op: "replace", path: "/slide_elements/0/children_elements/0/source", value: internal },
    ]);

    expect(patch[0]?.value).toBe("raw/png/abc.png");
  });

  it("normalizes nested element objects in add operations", () => {
    process.env.OSS_PUBLIC_BASE_URL = "https://example-courseware.oss-ap-northeast-1.aliyuncs.com";
    const internal =
      "https://example-courseware.oss-ap-northeast-1-internal.aliyuncs.com/courseware_assets/a.png?sig=1";

    const patch = normalizeScenePatchForPersistence([
      {
        op: "add",
        path: "/slide_elements/0/children_elements/-",
        value: { element_type: "image", source: internal },
      },
    ]);

    const value = patch[0]?.value as { source?: string };
    expect(value.source).toBe(
      normalizeCoursewareAssetUrlForPersistence(internal),
    );
  });

  it("leaves non-asset patch values unchanged", () => {
    const patch = normalizeScenePatchForPersistence([
      { op: "replace", path: "/name", value: "Lesson title" },
    ]);
    expect(patch[0]?.value).toBe("Lesson title");
  });
});
