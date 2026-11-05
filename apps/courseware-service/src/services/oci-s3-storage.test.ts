// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  createOciS3PresignedPost,
  isOciS3StorageEnabled,
  resolveOciS3StorageBackend,
  signOciS3ObjectReadUrl,
} from "@ainobi/courseware-cli/cli/oci-s3-storage.ts";
import {
  publicUrlForObjectKey,
  signOciS3ReadUrl,
  storageBackendForStoredObjectUrl,
} from "@ainobi/courseware-cli/cli/assets.ts";
import {
  coursewareAssetUrlPrefixes,
  coursewarePersistenceUrlHosts,
  isCoursewarePersistenceUrl,
  isOciS3StorageUrl,
  publicUrlForOciS3ObjectKey,
} from "@ainobi/courseware-cli/cli/url-policy.ts";
import { normalizeCoursewareAssetUrlForPersistence } from "@ainobi/courseware-cli/cli/asset-url-persistence.ts";

const OCI_ENV: Record<string, string> = {
  STORAGE_BACKEND: "oci_s3",
  OCI_S3_ENDPOINT: "https://examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com",
  OCI_S3_BUCKET: "example-storage",
  OCI_S3_ACCESS_KEY_ID: "0000000000000000000000000000000000000000",
  OCI_S3_SECRET_KEY: "sigv4-test-secret-key",
  OCI_S3_REGION: "ap-tokyo-1",
};

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) saved[key] = process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const FIXED_NOW = new Date("2026-09-02T01:02:03Z");

test("resolveOciS3StorageBackend defaults to aliyun_oss and only oci_s3 switches", () => {
  assert.equal(resolveOciS3StorageBackend({}), "aliyun_oss");
  assert.equal(resolveOciS3StorageBackend({ STORAGE_BACKEND: "" }), "aliyun_oss");
  assert.equal(resolveOciS3StorageBackend({ STORAGE_BACKEND: "aliyun_oss" }), "aliyun_oss");
  assert.equal(resolveOciS3StorageBackend({ STORAGE_BACKEND: "s3" }), "aliyun_oss");
  assert.equal(resolveOciS3StorageBackend({ STORAGE_BACKEND: "oci" }), "aliyun_oss");
  assert.equal(resolveOciS3StorageBackend({ STORAGE_BACKEND: "oci_s3" }), "oci_s3");
  assert.equal(resolveOciS3StorageBackend({ STORAGE_BACKEND: " OCI_S3 " }), "oci_s3");
  assert.equal(isOciS3StorageEnabled({ STORAGE_BACKEND: "oci_s3" }), true);
  assert.equal(isOciS3StorageEnabled({}), false);
});

test("signOciS3ObjectReadUrl encodes the key as UTF-8 RFC 3986 and stamps the SigV4 date", () => {
  const url = new URL(signOciS3ObjectReadUrl("raw/素材 a+b~.png", 600, { now: FIXED_NOW, env: OCI_ENV }));
  assert.ok(url.pathname.endsWith("/raw/%E7%B4%A0%E6%9D%90%20a%2Bb~.png"), url.pathname);
  assert.equal(url.searchParams.get("X-Amz-Date"), "20260902T010203Z");
});

test("signOciS3ObjectReadUrl builds a bucket-in-path SigV4 presigned GET", () => {
  const url = signOciS3ObjectReadUrl("raw/png/abc.png", 600, {
    now: FIXED_NOW,
    env: OCI_ENV,
  });
  const parsed = new URL(url);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.host, "examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com");
  assert.equal(parsed.pathname, "/example-storage/raw/png/abc.png");
  assert.equal(parsed.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
  assert.equal(
    parsed.searchParams.get("X-Amz-Credential"),
    `${OCI_ENV.OCI_S3_ACCESS_KEY_ID}/20260902/ap-tokyo-1/s3/aws4_request`,
  );
  assert.equal(parsed.searchParams.get("X-Amz-Date"), "20260902T010203Z");
  assert.equal(parsed.searchParams.get("X-Amz-Expires"), "600");
  assert.equal(parsed.searchParams.get("X-Amz-SignedHeaders"), "host");
  assert.match(parsed.searchParams.get("X-Amz-Signature") ?? "", /^[0-9a-f]{64}$/);
});

test("signOciS3ObjectReadUrl clamps expiry to [60, 604800] and defaults to 7 days", () => {
  const parsed = (url: string) => new URL(url).searchParams;
  assert.equal(parsed(signOciS3ObjectReadUrl("k", 1, { now: FIXED_NOW, env: OCI_ENV })).get("X-Amz-Expires"), "60");
  assert.equal(
    parsed(signOciS3ObjectReadUrl("k", 60 * 60 * 24 * 30, { now: FIXED_NOW, env: OCI_ENV })).get("X-Amz-Expires"),
    "604800",
  );
  assert.equal(
    parsed(signOciS3ObjectReadUrl("k", undefined, { now: FIXED_NOW, env: OCI_ENV })).get("X-Amz-Expires"),
    "604800",
  );
});

test("signOciS3ObjectReadUrl is deterministic and key/secret sensitive", () => {
  const a = signOciS3ObjectReadUrl("raw/png/abc.png", 600, { now: FIXED_NOW, env: OCI_ENV });
  const b = signOciS3ObjectReadUrl("raw/png/abc.png", 600, { now: FIXED_NOW, env: OCI_ENV });
  assert.equal(a, b);
  const otherSecret = signOciS3ObjectReadUrl("raw/png/abc.png", 600, {
    now: FIXED_NOW,
    env: { ...OCI_ENV, OCI_S3_SECRET_KEY: "another-secret" },
  });
  assert.notEqual(new URL(a).searchParams.get("X-Amz-Signature"), new URL(otherSecret).searchParams.get("X-Amz-Signature"));
});

test("presigned GET shares the AWS SDK presigner's canonical query params", async () => {
  // The AWS SDK presigner emits the same SigV4 query shape but adds its own
  // extra canonical-query params (x-id, x-amz-checksum-mode,
  // X-Amz-Content-Sha256), so signatures legitimately differ. Assert every
  // shared param (including scope/date) matches the SDK output — the signature
  // itself is proven against the real OCI endpoint by the deployment smoke test.
  let s3mod: typeof import("@aws-sdk/client-s3") | null = null;
  let presigner: typeof import("@aws-sdk/s3-request-presigner") | null = null;
  try {
    s3mod = await import("@aws-sdk/client-s3");
    presigner = await import("@aws-sdk/s3-request-presigner");
  } catch {
    return;
  }
  const client = new s3mod.S3Client({
    region: OCI_ENV.OCI_S3_REGION,
    endpoint: OCI_ENV.OCI_S3_ENDPOINT,
    credentials: {
      accessKeyId: OCI_ENV.OCI_S3_ACCESS_KEY_ID,
      secretAccessKey: OCI_ENV.OCI_S3_SECRET_KEY,
    },
    forcePathStyle: true,
  });
  const sdkUrl = await presigner.getSignedUrl(
    client,
    new s3mod.GetObjectCommand({ Bucket: OCI_ENV.OCI_S3_BUCKET, Key: "raw/png/abc.png" }),
    { expiresIn: 600, signingDate: FIXED_NOW },
  );
  const ours = new URL(signOciS3ObjectReadUrl("raw/png/abc.png", 600, { now: FIXED_NOW, env: OCI_ENV }));
  const theirs = new URL(sdkUrl);
  assert.equal(ours.host, theirs.host);
  assert.equal(ours.pathname, theirs.pathname);
  for (const param of ["X-Amz-Algorithm", "X-Amz-Credential", "X-Amz-Date", "X-Amz-Expires", "X-Amz-SignedHeaders"]) {
    assert.equal(ours.searchParams.get(param), theirs.searchParams.get(param), `param ${param}`);
  }
  assert.equal(new URL(sdkUrl).searchParams.get("X-Amz-Content-Sha256"), "UNSIGNED-PAYLOAD");
  assert.match(ours.searchParams.get("X-Amz-Signature") ?? "", /^[0-9a-f]{64}$/);
});

test("publicUrlForObjectKey switches to OCI presigned GET under oci_s3", () => {
  withEnv(OCI_ENV, () => {
    const url = publicUrlForObjectKey("raw/audio/abc.mp3", ".mp3");
    const parsed = new URL(url);
    assert.equal(parsed.host, "examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com");
    assert.equal(parsed.pathname, "/example-storage/raw/audio/abc.mp3");
    assert.equal(parsed.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
    assert.equal(parsed.searchParams.get("X-Amz-Signature")?.length, 64);
    // HTML CDN must not be used for OCI objects (it only fronts the aliyun bucket).
    const html = new URL(publicUrlForObjectKey("artifact/xyz.html", ".html"));
    assert.equal(html.pathname, "/example-storage/artifact/xyz.html");
  });
  // Regression guard (aliyun/OCI divergence): the html custom-domain host
  // rewrite must never reach the OCI path — SigV4 is host-bound, and the CDN
  // only fronts the aliyun bucket. Even with the override env set, OCI html
  // objects keep the presigned S3-compat host.
  withEnv({ ...OCI_ENV, COURSEWARE_HTML_ASSET_BASE_URL: "https://courseware.geekaca.cn" }, () => {
    const html = new URL(publicUrlForObjectKey("artifact/xyz.html", ".html"));
    assert.equal(
      html.host,
      "examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com",
    );
    assert.equal(html.pathname, "/example-storage/artifact/xyz.html");
    assert.equal(html.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
  });
  // Default backend keeps the aliyun public URL shape untouched.
  withEnv(
    {
      STORAGE_BACKEND: undefined,
      OSS_PUBLIC_BASE_URL: "https://example-courseware.oss-ap-northeast-1.aliyuncs.com",
    },
    () => {
      assert.equal(
        publicUrlForObjectKey("raw/audio/abc.mp3", ".mp3"),
        "https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/audio/abc.mp3",
      );
    },
  );
});

test("publicUrlForOciS3ObjectKey is the stable native persistence form", () => {
  withEnv(OCI_ENV, () => {
    assert.equal(
      publicUrlForOciS3ObjectKey("raw/png/abc.png"),
      "https://objectstorage.ap-tokyo-1.oraclecloud.com/n/examplenamespace/b/example-storage/o/raw/png/abc.png",
    );
  });
  withEnv({ OCI_S3_ENDPOINT: undefined }, () => {
    assert.equal(publicUrlForOciS3ObjectKey("raw/png/abc.png"), null);
  });
});

test("isOciS3StorageUrl recognizes OCI hosts only", () => {
  withEnv(OCI_ENV, () => {
    assert.equal(
      isOciS3StorageUrl("https://objectstorage.ap-tokyo-1.oraclecloud.com/n/examplenamespace/b/example-storage/o/raw/png/a.png?X-Amz-Signature=x"),
      true,
    );
    assert.equal(
      isOciS3StorageUrl("https://examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com/example-storage/raw/png/a.png"),
      true,
    );
    assert.equal(isOciS3StorageUrl("https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/png/a.png"), false);
    assert.equal(isOciS3StorageUrl("raw/png/a.png"), false);
  });
});

test("storageBackendForStoredObjectUrl follows the URL host family", () => {
  withEnv(OCI_ENV, () => {
    assert.equal(storageBackendForStoredObjectUrl("https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/png/a.png"), "aliyun_oss");
    assert.equal(storageBackendForStoredObjectUrl("https://objectstorage.ap-tokyo-1.oraclecloud.com/n/examplenamespace/b/example-storage/o/raw/png/a.png"), "oci_s3");
    // Bare keys follow the active backend.
    assert.equal(storageBackendForStoredObjectUrl("raw/png/a.png"), "oci_s3");
  });
  withEnv({ STORAGE_BACKEND: undefined }, () => {
    assert.equal(storageBackendForStoredObjectUrl("raw/png/a.png"), "aliyun_oss");
  });
});

test("courseware persistence policy recognizes OCI URLs", () => {
  withEnv(OCI_ENV, () => {
    const hosts = coursewarePersistenceUrlHosts();
    assert.equal(hosts.has("objectstorage.ap-tokyo-1.oraclecloud.com"), true);
    assert.equal(hosts.has("examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com"), true);
    assert.equal(isCoursewarePersistenceUrl("https://objectstorage.ap-tokyo-1.oraclecloud.com/n/examplenamespace/b/example-storage/o/raw/png/a.png"), true);
    assert.equal(
      coursewareAssetUrlPrefixes().some((prefix) =>
        prefix.startsWith("https://objectstorage.ap-tokyo-1.oraclecloud.com/"),
      ),
      true,
    );
  });
});

test("scene persistence normalization round-trips OCI presigned URLs to the bare object key", () => {
  withEnv(OCI_ENV, () => {
    const presigned = signOciS3ReadUrl("raw/audio/narration-1.mp3", 3600);
    const persisted = normalizeCoursewareAssetUrlForPersistence(presigned);
    // Unified 2026-09-07: OCI objects persist as bare keys (native/compat URLs anonymously 404,
    // which once misled the agent into suspecting a storage failure and regenerating a whole batch of narration).
    assert.equal(persisted, "raw/audio/narration-1.mp3");
    // Idempotent across repeated saves.
    assert.equal(normalizeCoursewareAssetUrlForPersistence(persisted), persisted);

    // env-independent: host form check — the sandbox save path without OCI_S3_* env normalizes the same way.
    const prevBackend = process.env.STORAGE_BACKEND;
    const prevEndpoint = process.env.OCI_S3_ENDPOINT;
    const prevBucket = process.env.OCI_S3_BUCKET;
    const prevRegion = process.env.OCI_S3_REGION;
    const prevAk = process.env.OCI_S3_ACCESS_KEY_ID;
    const prevSk = process.env.OCI_S3_SECRET_ACCESS_KEY;
    for (const k of [
      "STORAGE_BACKEND",
      "OCI_S3_ENDPOINT",
      "OCI_S3_BUCKET",
      "OCI_S3_REGION",
      "OCI_S3_ACCESS_KEY_ID",
      "OCI_S3_SECRET_ACCESS_KEY",
    ] as const) {
      delete process.env[k];
    }
    try {
      assert.equal(
        normalizeCoursewareAssetUrlForPersistence(
          "https://objectstorage.ap-tokyo-1.oraclecloud.com/n/examplenamespace/b/example-storage/o/raw/png/a.png",
        ),
        "raw/png/a.png",
      );
    } finally {
      if (prevBackend !== undefined) process.env.STORAGE_BACKEND = prevBackend;
      if (prevEndpoint !== undefined) process.env.OCI_S3_ENDPOINT = prevEndpoint;
      if (prevBucket !== undefined) process.env.OCI_S3_BUCKET = prevBucket;
      if (prevRegion !== undefined) process.env.OCI_S3_REGION = prevRegion;
      if (prevAk !== undefined) process.env.OCI_S3_ACCESS_KEY_ID = prevAk;
      if (prevSk !== undefined) process.env.OCI_S3_SECRET_ACCESS_KEY = prevSk;
    }

    // Legacy aliyun URLs keep collapsing to the aliyun public URL.
    const aliyunPersisted = normalizeCoursewareAssetUrlForPersistence(
      "https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/png/legacy.png",
    );
    assert.equal(aliyunPersisted, "https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/png/legacy.png");
  });
});

test("presigned POST policy is SigV4 signed with the documented fields", async () => {
  const post = await withEnv(OCI_ENV, () =>
    createOciS3PresignedPost({
      objectKey: "raw/png/abc.png",
      expiresSeconds: 600,
      contentType: "image/png",
      contentLengthRange: { min: 1, max: 1024 },
      now: FIXED_NOW,
    }),
  );
  assert.equal(post.url, "https://examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com/example-storage");
  assert.equal(post.fields.key, "raw/png/abc.png");
  assert.equal(post.fields["x-amz-algorithm"], "AWS4-HMAC-SHA256");
  assert.equal(
    post.fields["x-amz-credential"],
    `${OCI_ENV.OCI_S3_ACCESS_KEY_ID}/20260902/ap-tokyo-1/s3/aws4_request`,
  );
  assert.equal(post.fields["x-amz-date"], "20260902T010203Z");
  assert.match(post.fields["x-amz-signature"], /^[0-9a-f]{64}$/);
  const policy = JSON.parse(Buffer.from(post.fields.policy, "base64").toString("utf8")) as {
    conditions: unknown[];
  };
  // botocore order: caller conditions, then bucket, key and the SigV4 fields
  assert.deepEqual(policy.conditions, [
    { "Content-Type": "image/png" },
    ["content-length-range", 1, 1024],
    { bucket: "example-storage" },
    { key: "raw/png/abc.png" },
    { "x-amz-algorithm": "AWS4-HMAC-SHA256" },
    { "x-amz-credential": post.fields["x-amz-credential"] },
    { "x-amz-date": "20260902T010203Z" },
  ]);
  assert.equal(post.fields["Content-Type"], "image/png");
});
