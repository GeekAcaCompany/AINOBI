// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "vitest";

import { rewriteSignedUrlForServerAccess, rewriteSignedUrlToInternalOssHost } from "./assets.ts";
import { rewriteSignedUrlForPublicPersistence } from "./url-policy.ts";

const envSnapshot = { ...process.env };

afterEach(() => {
  process.env = { ...envSnapshot };
});

describe("rewriteSignedUrlForServerAccess", () => {
  it("rewrites OSS_PUBLIC_BASE_URL host to OSS_ENDPOINT virtual host", () => {
    process.env.OSS_BUCKET = "example-courseware";
    process.env.OSS_ENDPOINT = "https://oss-ap-northeast-1-internal.aliyuncs.com";
    process.env.OSS_PUBLIC_BASE_URL = "https://example-courseware.oss-ap-northeast-1.aliyuncs.com";
    process.env.OSS_SECURE = "true";

    const input =
      "https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/pdf/abc.pdf?OSSAccessKeyId=x&Expires=1&Signature=y";
    const out = rewriteSignedUrlForServerAccess(input);

    expect(out).toBe(
      "https://example-courseware.oss-ap-northeast-1-internal.aliyuncs.com/raw/pdf/abc.pdf?OSSAccessKeyId=x&Expires=1&Signature=y",
    );
  });

  it("leaves internal host unchanged when already on access endpoint", () => {
    process.env.OSS_BUCKET = "example-courseware";
    process.env.OSS_ENDPOINT = "https://oss-ap-northeast-1-internal.aliyuncs.com";
    process.env.OSS_PUBLIC_BASE_URL = "https://example-courseware.oss-ap-northeast-1.aliyuncs.com";

    const input =
      "https://example-courseware.oss-ap-northeast-1-internal.aliyuncs.com/raw/pdf/abc.pdf?sig=1";
    expect(rewriteSignedUrlForServerAccess(input)).toBe(input);
  });

  it("does not rewrite when public and access hosts match (local dev)", () => {
    process.env.OSS_BUCKET = "example-courseware";
    process.env.OSS_ENDPOINT = "https://oss-ap-northeast-1.aliyuncs.com";
    process.env.OSS_PUBLIC_BASE_URL = "https://example-courseware.oss-ap-northeast-1.aliyuncs.com";

    const input =
      "https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/pdf/abc.pdf?sig=1";
    expect(rewriteSignedUrlForServerAccess(input)).toBe(input);
  });
});

describe("rewriteSignedUrlToInternalOssHost", () => {
  it("inserts -internal into a standard aliyuncs.com host", () => {
    const input =
      "https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/pdf/abc.pdf?OSSAccessKeyId=x&Expires=1&Signature=y";
    expect(rewriteSignedUrlToInternalOssHost(input)).toBe(
      "https://example-courseware.oss-ap-northeast-1-internal.aliyuncs.com/raw/pdf/abc.pdf?OSSAccessKeyId=x&Expires=1&Signature=y",
    );
  });

  it("is idempotent when already on the internal host", () => {
    const input =
      "https://example-courseware.oss-ap-northeast-1-internal.aliyuncs.com/raw/pdf/abc.pdf?sig=1";
    expect(rewriteSignedUrlToInternalOssHost(input)).toBe(input);
  });

  it("leaves non-aliyuncs.com (custom domain) hosts untouched", () => {
    const input = "https://cdn.example.com/raw/pdf/abc.pdf?sig=1";
    expect(rewriteSignedUrlToInternalOssHost(input)).toBe(input);
  });
});

describe("rewriteSignedUrlForPublicPersistence", () => {
  it("rewrites internal OSS host back to OSS_PUBLIC_BASE_URL", () => {
    process.env.OSS_BUCKET = "example-courseware";
    process.env.OSS_ENDPOINT = "https://oss-ap-northeast-1-internal.aliyuncs.com";
    process.env.OSS_PUBLIC_BASE_URL = "https://example-courseware.oss-ap-northeast-1.aliyuncs.com";

    const input =
      "https://example-courseware.oss-ap-northeast-1-internal.aliyuncs.com/raw/png/abc.png?OSSAccessKeyId=x&Expires=1&Signature=y";
    const out = rewriteSignedUrlForPublicPersistence(input);

    expect(out).toBe(
      "https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/png/abc.png?OSSAccessKeyId=x&Expires=1&Signature=y",
    );
  });
});
