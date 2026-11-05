// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertOciS3Env,
  isOciS3StorageEnabled,
  ociS3NativeObjectBaseUrl,
  ociS3StorageUrlHosts,
  ociS3UrlExpiresSeconds,
  publicUrlForOciS3ObjectKey,
  readOciS3Env,
  resolveOciS3StorageBackend,
  signOciS3ObjectReadUrl,
} from "./oci-s3-storage.ts";

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
  assert.equal(resolveOciS3StorageBackend({ STORAGE_BACKEND: "oci_s3" }), "oci_s3");
  assert.equal(resolveOciS3StorageBackend({ STORAGE_BACKEND: " OCI_S3 " }), "oci_s3");
  assert.equal(isOciS3StorageEnabled({ STORAGE_BACKEND: "oci_s3" }), true);
  assert.equal(isOciS3StorageEnabled({}), false);
});

test("readOciS3Env requires the full OCI_S3_* set and derives the namespace", () => {
  assert.equal(readOciS3Env({}), null);
  assert.equal(readOciS3Env({ ...OCI_ENV, OCI_S3_SECRET_KEY: undefined }), null);
  const config = readOciS3Env(OCI_ENV);
  assert.equal(config?.host, "examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com");
  assert.equal(config?.bucket, "example-storage");
  assert.equal(config?.namespace, "examplenamespace");
  assert.throws(() => assertOciS3Env({}), /missing OCI_S3_ENDPOINT/);
  assert.equal(assertOciS3Env(OCI_ENV).bucket, "example-storage");
});

test("signOciS3ObjectReadUrl encodes the key as UTF-8 RFC 3986 and stamps the SigV4 date", () => {
  const url = new URL(signOciS3ObjectReadUrl("raw/素材 a+b~.png", 600, { now: FIXED_NOW, env: OCI_ENV }));
  assert.ok(url.pathname.endsWith("/raw/%E7%B4%A0%E6%9D%90%20a%2Bb~.png"), url.pathname);
  assert.equal(url.searchParams.get("X-Amz-Date"), "20260902T010203Z");
});

test("signOciS3ObjectReadUrl builds a bucket-in-path SigV4 presigned GET", () => {
  const url = signOciS3ObjectReadUrl("renders/job-1/output.mp4", 600, {
    now: FIXED_NOW,
    env: OCI_ENV,
  });
  const parsed = new URL(url);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.host, "examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com");
  assert.equal(parsed.pathname, "/example-storage/renders/job-1/output.mp4");
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
  assert.equal(
    parsed(signOciS3ObjectReadUrl("k", 1, { now: FIXED_NOW, env: OCI_ENV })).get("X-Amz-Expires"),
    "60",
  );
  assert.equal(
    parsed(signOciS3ObjectReadUrl("k", 60 * 60 * 24 * 30, { now: FIXED_NOW, env: OCI_ENV })).get("X-Amz-Expires"),
    "604800",
  );
  assert.equal(
    parsed(signOciS3ObjectReadUrl("k", undefined, { now: FIXED_NOW, env: OCI_ENV })).get("X-Amz-Expires"),
    "604800",
  );
});

test("ociS3UrlExpiresSeconds honors OCI_S3_URL_EXPIRES and falls back to 7 days", () => {
  assert.equal(ociS3UrlExpiresSeconds({}), 604800);
  assert.equal(ociS3UrlExpiresSeconds({ OCI_S3_URL_EXPIRES: "3600" }), 3600);
  assert.equal(ociS3UrlExpiresSeconds({ OCI_S3_URL_EXPIRES: "abc" }), 604800);
  assert.equal(ociS3UrlExpiresSeconds({ OCI_S3_URL_EXPIRES: "-5" }), 604800);
});

test("signOciS3ObjectReadUrl is deterministic and key/secret sensitive", () => {
  const a = signOciS3ObjectReadUrl("renders/job-1/output.mp4", 600, { now: FIXED_NOW, env: OCI_ENV });
  const b = signOciS3ObjectReadUrl("renders/job-1/output.mp4", 600, { now: FIXED_NOW, env: OCI_ENV });
  assert.equal(a, b);
  const otherSecret = signOciS3ObjectReadUrl("renders/job-1/output.mp4", 600, {
    now: FIXED_NOW,
    env: { ...OCI_ENV, OCI_S3_SECRET_KEY: "another-secret" },
  });
  assert.notEqual(
    new URL(a).searchParams.get("X-Amz-Signature"),
    new URL(otherSecret).searchParams.get("X-Amz-Signature"),
  );
});

test("presigned GET shares the AWS SDK presigner canonical query params", async () => {
  // The AWS SDK presigner emits the same SigV4 query shape but adds its own
  // extra canonical-query params (x-id, x-amz-checksum-mode,
  // X-Amz-Content-Sha256), so signatures legitimately differ. Assert every
  // shared param matches the SDK output — the signature itself is proven
  // against the real OCI endpoint by the deployment smoke test.
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
    new s3mod.GetObjectCommand({ Bucket: OCI_ENV.OCI_S3_BUCKET, Key: "renders/job-1/output.mp4" }),
    { expiresIn: 600, signingDate: FIXED_NOW },
  );
  const ours = new URL(signOciS3ObjectReadUrl("renders/job-1/output.mp4", 600, { now: FIXED_NOW, env: OCI_ENV }));
  const theirs = new URL(sdkUrl);
  assert.equal(ours.host, theirs.host);
  assert.equal(ours.pathname, theirs.pathname);
  for (const param of ["X-Amz-Algorithm", "X-Amz-Credential", "X-Amz-Date", "X-Amz-Expires", "X-Amz-SignedHeaders"]) {
    assert.equal(ours.searchParams.get(param), theirs.searchParams.get(param), `param ${param}`);
  }
  assert.equal(theirs.searchParams.get("X-Amz-Content-Sha256"), "UNSIGNED-PAYLOAD");
  assert.match(ours.searchParams.get("X-Amz-Signature") ?? "", /^[0-9a-f]{64}$/);
});

test("publicUrlForOciS3ObjectKey is the stable native persistence form", () => {
  withEnv(OCI_ENV, () => {
    assert.equal(
      publicUrlForOciS3ObjectKey("renders/job-1/output.mp4"),
      "https://objectstorage.ap-tokyo-1.oraclecloud.com/n/examplenamespace/b/example-storage/o/renders/job-1/output.mp4",
    );
    assert.equal(
      ociS3NativeObjectBaseUrl(OCI_ENV),
      "https://objectstorage.ap-tokyo-1.oraclecloud.com/n/examplenamespace/b/example-storage/o",
    );
  });
  withEnv({ OCI_S3_ENDPOINT: undefined }, () => {
    assert.equal(publicUrlForOciS3ObjectKey("renders/job-1/output.mp4"), null);
  });
});

test("ociS3StorageUrlHosts covers the compat endpoint and the native host", () => {
  withEnv(OCI_ENV, () => {
    const hosts = ociS3StorageUrlHosts();
    assert.equal(hosts.has("examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com"), true);
    assert.equal(hosts.has("objectstorage.ap-tokyo-1.oraclecloud.com"), true);
    assert.equal(hosts.size, 2);
  });
  assert.equal(ociS3StorageUrlHosts({}).size, 0);
});
