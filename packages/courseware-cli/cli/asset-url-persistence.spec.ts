// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "vitest";

import { publicUrlForObjectKey } from "./assets.ts";
import { isAllowedCoursewareAssetUrl } from "./url-policy.ts";
import { normalizeCoursewareAssetUrlForPersistence } from "./asset-url-persistence.ts";

const envSnapshot = { ...process.env };

afterEach(() => {
  process.env = { ...envSnapshot };
});

describe("normalizeCoursewareAssetUrlForPersistence", () => {
  it("canonicalizes internal signed OSS URL to the bare object key", () => {
    process.env.OSS_BUCKET = "example-courseware";
    process.env.OSS_ENDPOINT = "https://oss-ap-northeast-1-internal.aliyuncs.com";
    process.env.OSS_PUBLIC_BASE_URL = "https://example-courseware.oss-ap-northeast-1.aliyuncs.com";

    const input =
      "https://example-courseware.oss-ap-northeast-1-internal.aliyuncs.com/raw/png/abc.png?OSSAccessKeyId=x&Expires=1&Signature=y";
    expect(normalizeCoursewareAssetUrlForPersistence(input)).toBe("raw/png/abc.png");
  });

  it("canonicalizes default internal OSS host without OSS_BUCKET env", () => {
    delete process.env.OSS_BUCKET;
    delete process.env.OSS_ENDPOINT;
    process.env.OSS_PUBLIC_BASE_URL = "https://example-courseware.oss-ap-northeast-1.aliyuncs.com";

    const input =
      "https://example-courseware.oss-ap-northeast-1-internal.aliyuncs.com/raw/png/abc.png?sig=1";
    expect(normalizeCoursewareAssetUrlForPersistence(input)).toBe(
      "https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/png/abc.png",
    );
  });

  it("leaves non-courseware URLs unchanged", () => {
    expect(normalizeCoursewareAssetUrlForPersistence("https://example.com/other.png")).toBe(
      "https://example.com/other.png",
    );
  });

  it("leaves external S3 URLs unchanged even with organization/ object key path", () => {
    const s3 =
      "https://example-storage-bucket-dev.s3.amazonaws.com/organization/8cdf6f92-b8ea-42c7-a060-5c808090e37a/ai_teachers/23f35e13-192a-4300-a807-d076c2eccf8f/live2d_model/geekaca-teacher.model3.json";
    expect(normalizeCoursewareAssetUrlForPersistence(s3)).toBe(s3);
  });

  it("strips presign query from external S3 organization/ URLs", () => {
    const input =
      "https://example-storage-bucket-dev.s3.amazonaws.com/organization/org-1/ai_teachers/t1/live2d_model/Aka.inx?AWSAccessKeyId=AKIA&Signature=sig&Expires=1";
    expect(normalizeCoursewareAssetUrlForPersistence(input)).toBe(
      "https://example-storage-bucket-dev.s3.amazonaws.com/organization/org-1/ai_teachers/t1/live2d_model/Aka.inx",
    );
  });

  it("strips presign query from external S3 public/ avatar URLs", () => {
    const input =
      "https://example-storage-bucket-dev.s3.amazonaws.com/public/avatar/ainobi-teacher-001.png?AWSAccessKeyId=AKIA&Signature=sig&Expires=1";
    expect(normalizeCoursewareAssetUrlForPersistence(input)).toBe(
      "https://example-storage-bucket-dev.s3.amazonaws.com/public/avatar/ainobi-teacher-001.png",
    );
  });

  it("collapses duplicate path slashes in vtuber / Live2D model S3 URLs", () => {
    const input =
      "https://example-storage-bucket-prod.s3.amazonaws.com//public/live2d_models/ainobi-teacher-001/ainobi-teacher-001.model3.json";
    expect(normalizeCoursewareAssetUrlForPersistence(input)).toBe(
      "https://example-storage-bucket-prod.s3.amazonaws.com/public/live2d_models/ainobi-teacher-001/ainobi-teacher-001.model3.json",
    );
  });

  it("collapses duplicate path slashes on ai_teacher metadata URL fields", () => {
    const input =
      "https://example-storage-bucket-prod.s3.amazonaws.com///public/live2d_models/ainobi-teacher-001/ainobi-teacher-001.model3.json";
    expect(normalizeCoursewareAssetUrlForPersistence(input)).toBe(
      "https://example-storage-bucket-prod.s3.amazonaws.com/public/live2d_models/ainobi-teacher-001/ainobi-teacher-001.model3.json",
    );
  });

  it("rewrites courseware.example.com artifact URLs to unsigned public form", () => {
    process.env.OSS_PUBLIC_BASE_URL = "https://example-courseware.oss-ap-northeast-1.aliyuncs.com";
    const input =
      "https://courseware.example.com/artifact/html/foo/index.html?OSSAccessKeyId=x&Signature=y";
    expect(normalizeCoursewareAssetUrlForPersistence(input)).toBe(
      "https://courseware.example.com/artifact/html/foo/index.html",
    );
  });

  it("persists OCI private-bucket URLs as the bare object key (2026-09-07 unification)", () => {
    // native form (the old persisted form, anonymous 404) → bare key
    const native =
      "https://objectstorage.ap-tokyo-1.oraclecloud.com/n/examplenamespace/b/example-storage/o/raw/mp3/6b84b51b21a1ac6d6aeb88dbdc9e69c2.mp3";
    expect(normalizeCoursewareAssetUrlForPersistence(native)).toBe(
      "raw/mp3/6b84b51b21a1ac6d6aeb88dbdc9e69c2.mp3",
    );
    // compat form (private bucket with signature) → bare key
    const compat =
      "https://examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com/example-storage/raw/mp3/7fda7e1c80a2c71cfa168624841dc44b.mp3?X-Amz-Signature=abc";
    expect(normalizeCoursewareAssetUrlForPersistence(compat)).toBe(
      "raw/mp3/7fda7e1c80a2c71cfa168624841dc44b.mp3",
    );
    // The physical mirror prefix form (s3/<bucket>/…, produced by the education backend) is outside this module's knowledge:
    // extract does not recognize a logical key → passes through as-is (URL form kept). Known debt; semantics not extended.
    const compatPrefixed =
      "https://examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com/example-storage/s3/example-storage-bucket-prod/temp/inochi2d_models/org-1/model.inx";
    expect(normalizeCoursewareAssetUrlForPersistence(compatPrefixed)).toBe(
      "https://examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com/example-storage/s3/example-storage-bucket-prod/temp/inochi2d_models/org-1/model.inx",
    );
  });

  it("persists OCI public-bucket URLs as the bare object key", () => {
    const compatPublic =
      "https://examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com/example-public/public/live2d_models/ainobi-teacher-001/ainobi-teacher-001.model3.json";
    expect(normalizeCoursewareAssetUrlForPersistence(compatPublic)).toBe(
      "public/live2d_models/ainobi-teacher-001/ainobi-teacher-001.model3.json",
    );
  });

  it("keeps bare object keys unchanged (idempotent)", () => {
    expect(normalizeCoursewareAssetUrlForPersistence("raw/mp3/abc.mp3")).toBe("raw/mp3/abc.mp3");
    expect(
      normalizeCoursewareAssetUrlForPersistence(
        "public/live2d_models/ainobi-teacher-001/ainobi-teacher-001.model3.json",
      ),
    ).toBe("public/live2d_models/ainobi-teacher-001/ainobi-teacher-001.model3.json");
  });
});

describe("normalizeCoursewareAssetUrlForPersistence — private active bucket", () => {
  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it("persists the bare object key for signed URLs on the active private bucket", () => {
    // example-storage (private, the test-env default): persisting origin+path
    // would lose the signature and fail immediately — the bare key lets the
    // read path re-sign (Codex review round 4, P1).
    process.env.OSS_BUCKET = "example-storage";
    process.env.OSS_ENDPOINT = "https://oss-cn-shenzhen.aliyuncs.com";
    delete process.env.OSS_PUBLIC_BASE_URL;
    delete process.env.AINOBI_COURSEWARE_ASSET_BASE_URL;

    const input =
      "https://example-storage.oss-cn-shenzhen.aliyuncs.com/courseware_assets/5873afbd-dddc-45d3-82e7-bcd676a88b51/732e5068-5ca4-43b0-9dec-e375c786bdf7/7100a6c0789c4fd78ad0d3290f148592.png?OSSAccessKeyId=LTAI&Expires=1893456000&Signature=abc";
    expect(normalizeCoursewareAssetUrlForPersistence(input)).toBe(
      "courseware_assets/5873afbd-dddc-45d3-82e7-bcd676a88b51/732e5068-5ca4-43b0-9dec-e375c786bdf7/7100a6c0789c4fd78ad0d3290f148592.png",
    );
  });

  it("still persists the URL form for legacy public-host assets", () => {
    process.env.OSS_BUCKET = "example-storage";
    process.env.OSS_ENDPOINT = "https://oss-cn-shenzhen.aliyuncs.com";
    process.env.OSS_PUBLIC_BASE_URL = "https://example-courseware.oss-ap-northeast-1.aliyuncs.com";

    const input =
      "https://example-courseware.oss-ap-northeast-1.aliyuncs.com/courseware_covers/5873afbd-dddc-45d3-82e7-bcd676a88b51/732e5068-5ca4-43b0-9dec-e375c786bdf7/691d83abbfe4f4b2924ad6fc6016ae6a.png?OSSAccessKeyId=LTAI&Expires=1893456000&Signature=def";
    const out = normalizeCoursewareAssetUrlForPersistence(input);
    // legacy public-host objects keep the URL form (unsigned, permanent)
    expect(out.startsWith("https://example-courseware.oss-ap-northeast-1.aliyuncs.com/")).toBe(true);
    expect(out.includes("Signature=")).toBe(false);
  });

  it("collapses signed URLs on the public twin of an internal endpoint to the bare key", () => {
    // The signer rewrites -internal → public for browsers, so a scene may hold
    // a signed URL whose host differs from ossVirtualHostedAccessBaseUrl()'s
    // configured (internal) form — it must still collapse to the bare key
    // (Codex P1: otherwise the URL persisted signature-stripped, unreadable).
    process.env.OSS_BUCKET = "example-storage";
    process.env.OSS_ENDPOINT = "https://oss-cn-shenzhen-internal.aliyuncs.com";
    delete process.env.COURSEWARE_HTML_ASSET_BASE_URL;

    const input =
      "https://example-storage.oss-cn-shenzhen.aliyuncs.com/raw/html/abc.html?OSSAccessKeyId=LTAI&Expires=1893456000&Signature=xyz";
    expect(normalizeCoursewareAssetUrlForPersistence(input)).toBe("raw/html/abc.html");
  });

  it("keeps the URL form for aliyun-host URLs while OCI is the active backend", () => {
    // Grayscale transition: bare keys re-sign against the ACTIVE backend, so
    // collapsing an aliyun URL would misroute aliyun-only objects to OCI and
    // 404 (Codex P1) — keep the host family, strip only the signature.
    process.env.STORAGE_BACKEND = "oci_s3";
    process.env.OSS_BUCKET = "example-storage";
    process.env.OSS_ENDPOINT = "https://oss-cn-shenzhen.aliyuncs.com";

    const input =
      "https://example-storage.oss-cn-shenzhen.aliyuncs.com/courseware_assets/org-1/file.png?OSSAccessKeyId=LTAI&Expires=1893456000&Signature=xyz";
    const out = normalizeCoursewareAssetUrlForPersistence(input);
    expect(out).toBe("https://example-storage.oss-cn-shenzhen.aliyuncs.com/courseware_assets/org-1/file.png");
    expect(out.includes("Signature=")).toBe(false);
  });

  it("collapses signed URLs on the html custom domain to the bare key", () => {
    process.env.OSS_BUCKET = "example-storage";
    process.env.OSS_ENDPOINT = "https://oss-cn-shenzhen.aliyuncs.com";
    process.env.COURSEWARE_HTML_ASSET_BASE_URL = "https://courseware.geekaca.cn";

    const input =
      "https://courseware.geekaca.cn/artifact/pptx/abc/html/slide_1.html?OSSAccessKeyId=LTAI&Expires=1893456000&Signature=xyz";
    expect(normalizeCoursewareAssetUrlForPersistence(input)).toBe("artifact/pptx/abc/html/slide_1.html");
  });

  it("collapses active-bucket URLs whose key is outside the signable prefix list", () => {
    // Keys outside SIGNABLE_FILE_PATH_PREFIXES (e.g. model/live2d_model/…,
    // supported by courseware-asset-presign.ts) have objectKey === null — the
    // key must come from the pathname, not a thrown-then-kept signed URL
    // (Codex P1: AI-teacher metadata would otherwise break after 7 days).
    process.env.OSS_BUCKET = "example-storage";
    process.env.OSS_ENDPOINT = "https://oss-cn-shenzhen.aliyuncs.com";
    delete process.env.COURSEWARE_HTML_ASSET_BASE_URL;

    const input =
      "https://example-storage.oss-cn-shenzhen.aliyuncs.com/model/live2d_model/org-1/teacher.model3.json?OSSAccessKeyId=LTAI&Expires=1893456000&Signature=xyz";
    expect(normalizeCoursewareAssetUrlForPersistence(input)).toBe(
      "model/live2d_model/org-1/teacher.model3.json",
    );
  });
});

describe("publicUrlForObjectKey — html custom-domain host rewrite", () => {
  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  const signingEnv = () => {
    process.env.OSS_BUCKET = "example-storage";
    process.env.OSS_ENDPOINT = "https://oss-cn-shenzhen.aliyuncs.com";
    process.env.ALIYUN_ACCESS_KEY_ID = "LTAI test-key";
    process.env.ALIYUN_ACCESS_KEY_SECRET = "test-secret";
  };

  it("serves html object URLs from COURSEWARE_HTML_ASSET_BASE_URL (no forced download)", () => {
    signingEnv();
    process.env.COURSEWARE_HTML_ASSET_BASE_URL = "https://courseware.geekaca.cn";

    const url = publicUrlForObjectKey("artifact/pptx/abc/html/slide_1.html");
    expect(url.startsWith("https://courseware.geekaca.cn/artifact/pptx/abc/html/slide_1.html?")).toBe(true);
    // the V1 signature covers /{bucket}/{key} only — it must survive the host swap
    expect(url).toContain("Signature=");
  });

  it("keeps non-html assets on the bucket host", () => {
    signingEnv();
    process.env.COURSEWARE_HTML_ASSET_BASE_URL = "https://courseware.geekaca.cn";

    const url = publicUrlForObjectKey("courseware_assets/org/file.png", ".png");
    expect(url.startsWith("https://example-storage.oss-cn-shenzhen.aliyuncs.com/")).toBe(true);
  });

  it("leaves the bucket host untouched when COURSEWARE_HTML_ASSET_BASE_URL is unset", () => {
    // Documented opt-in contract: without the override html objects get the
    // direct signed bucket URL (OSS serves it as an attachment). The legacy
    // default must NOT be auto-applied — it fronts the retired Tokyo bucket
    // and would 403 private-bucket objects. Deployments serving inline slide
    // HTML configure the override (test env: courseware.geekaca.cn via OOS).
    signingEnv();
    delete process.env.COURSEWARE_HTML_ASSET_BASE_URL;

    const url = publicUrlForObjectKey("artifact/pptx/abc/html/slide_1.html");
    expect(url.startsWith("https://example-storage.oss-cn-shenzhen.aliyuncs.com/")).toBe(true);
  });

  it("signs against the region-derived endpoint when only OSS_REGION is set", () => {
    // OSS_REGION is the other configuration shape assertOssEnv() accepts —
    // the hand-rolled signer must not bail to the unsigned fallback (which
    // the private bucket 403s) just because OSS_ENDPOINT is absent (Codex P1).
    signingEnv();
    delete process.env.OSS_ENDPOINT;
    process.env.OSS_REGION = "oss-cn-shenzhen";
    delete process.env.COURSEWARE_HTML_ASSET_BASE_URL;

    const url = publicUrlForObjectKey("courseware_assets/org/file.png", ".png");
    expect(url.startsWith("https://example-storage.oss-cn-shenzhen.aliyuncs.com/")).toBe(true);
    expect(url).toContain("Signature=");
  });
});

describe("isAllowedCoursewareAssetUrl — legacy html origin stays accepted", () => {
  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it("accepts both the override origin and the legacy default (Codex P1)", () => {
    process.env.COURSEWARE_HTML_ASSET_BASE_URL = "https://courseware.geekaca.cn";
    expect(isAllowedCoursewareAssetUrl("https://courseware.geekaca.cn/artifact/a.html")).toBe(true);
    // Existing scenes legitimately store courseware.example.com references —
    // the override migrates NEW emission, it must not block their publication.
    expect(isAllowedCoursewareAssetUrl("https://courseware.example.com/artifact/a.html")).toBe(true);
  });
});
