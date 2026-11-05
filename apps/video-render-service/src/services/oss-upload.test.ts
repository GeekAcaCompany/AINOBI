// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { writeFile } from "node:fs/promises";

import {
  buildDistributedChunkObjectKey,
  buildDistributedPlanOssPrefix,
  buildVideoRenderCoverObjectKey,
  buildVideoRenderObjectKey,
  deleteOssPrefix,
  isLikelyNetworkError,
  ociUploadResultUrl,
  uploadFileToOss,
  uploadImageToOss,
  _setOciImplsForTests,
} from "./oss-upload.ts";

test("isLikelyNetworkError recognizes Node network error codes", () => {
  for (const code of ["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"]) {
    const error = Object.assign(new Error("boom"), { code });
    assert.equal(isLikelyNetworkError(error), true, `expected ${code} to be treated as a network error`);
  }
});

test("isLikelyNetworkError recognizes urllib's RequestError name", () => {
  const error = Object.assign(new Error("connect failed"), { name: "RequestError" });
  assert.equal(isLikelyNetworkError(error), true);
});

test("isLikelyNetworkError recognizes DNS failure messages without a code", () => {
  const error = new Error("getaddrinfo ENOTFOUND oss-ap-northeast-1-internal.aliyuncs.com");
  assert.equal(isLikelyNetworkError(error), true);
});

test("isLikelyNetworkError does not flag real OSS API errors (bad credentials, missing bucket)", () => {
  const accessDenied = Object.assign(new Error("Access Denied"), { code: "AccessDenied", status: 403 });
  assert.equal(isLikelyNetworkError(accessDenied), false);

  const noSuchBucket = Object.assign(new Error("The specified bucket does not exist"), {
    code: "NoSuchBucket",
    status: 404,
  });
  assert.equal(isLikelyNetworkError(noSuchBucket), false);
});

test("isLikelyNetworkError handles non-Error / nullish inputs safely", () => {
  assert.equal(isLikelyNetworkError(undefined), false);
  assert.equal(isLikelyNetworkError(null), false);
  assert.equal(isLikelyNetworkError("plain string failure"), false);
  assert.equal(isLikelyNetworkError({}), false);
});

// ---------------------------------------------------------------------------
// OCI (STORAGE_BACKEND=oci_s3) dispatch
// ---------------------------------------------------------------------------

const OCI_ENV: Record<string, string> = {
  STORAGE_BACKEND: "oci_s3",
  OCI_S3_ENDPOINT: "https://examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com",
  OCI_S3_BUCKET: "example-storage",
  OCI_S3_ACCESS_KEY_ID: "0000000000000000000000000000000000000000",
  OCI_S3_SECRET_KEY: "sigv4-test-secret-key",
  OCI_S3_REGION: "ap-tokyo-1",
};

function setOciEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(OCI_ENV)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("object key builders keep the render key layout (backend-independent)", () => {
  assert.equal(buildVideoRenderObjectKey("job-1", "/tmp/out/job-1.mp4"), "renders/job-1/job-1.mp4");
  assert.equal(buildVideoRenderCoverObjectKey("job-1"), "renders/job-1/cover.jpg");
  assert.equal(buildDistributedPlanOssPrefix("task-1"), "renders/task-1/plan");
  assert.equal(buildDistributedChunkObjectKey("task-1", 3), "renders/task-1/chunks/3.mp4");
});

test("ociUploadResultUrl returns a host-bound presigned GET", () => {
  const saved = setOciEnv();
  try {
    const url = ociUploadResultUrl("renders/job-1/job-1.mp4");
    const parsed = new URL(url);
    assert.equal(parsed.host, "examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com");
    assert.equal(parsed.pathname, "/example-storage/renders/job-1/job-1.mp4");
    assert.equal(parsed.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
    // Long validity: 7 days (SigV4 max) by default, OCI_S3_URL_EXPIRES overrides.
    assert.equal(parsed.searchParams.get("X-Amz-Expires"), "604800");
    assert.match(parsed.searchParams.get("X-Amz-Signature") ?? "", /^[0-9a-f]{64}$/);

    process.env.OCI_S3_URL_EXPIRES = "3600";
    assert.equal(
      new URL(ociUploadResultUrl("renders/job-1/job-1.mp4")).searchParams.get("X-Amz-Expires"),
      "3600",
    );
  } finally {
    delete process.env.OCI_S3_URL_EXPIRES;
    restoreEnv(saved);
  }
});

test("uploadFileToOss switches to the OCI client under STORAGE_BACKEND=oci_s3", async () => {
  const saved = setOciEnv();
  const localPath = join(tmpdir(), `oss-upload-oci-test-${process.pid}.mp4`);
  await writeFile(localPath, Buffer.alloc(20, 7));
  const puts: Array<{ key: string; contentType: string; path: string }> = [];
  _setOciImplsForTests({
    putFromFile: async (objectKey, filePath, contentType) => {
      puts.push({ key: objectKey, contentType, path: filePath });
    },
  });
  try {
    const result = await uploadFileToOss(localPath, "renders/job-1/job-1.mp4", "example-storage");
    assert.deepEqual(puts, [{ key: "renders/job-1/job-1.mp4", contentType: "video/mp4", path: localPath }]);
    assert.equal(result.bucket, "example-storage");
    assert.equal(result.key, "renders/job-1/job-1.mp4");
    assert.equal(result.sizeBytes, 20); // bytes of the fixture file written below
    assert.equal(new URL(result.url).host, "examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com");
    assert.match(new URL(result.url).searchParams.get("X-Amz-Signature") ?? "", /^[0-9a-f]{64}$/);
  } finally {
    await rm(localPath, { force: true });
    _setOciImplsForTests(null);
    restoreEnv(saved);
  }
});

test("uploadImageToOss switches to the OCI client and presigns the cover URL", async () => {
  const saved = setOciEnv();
  const localPath = join(tmpdir(), `oss-upload-oci-cover-test-${process.pid}.jpg`);
  await writeFile(localPath, Buffer.alloc(10, 3));
  const puts: Array<{ key: string; contentType: string }> = [];
  _setOciImplsForTests({
    putFromFile: async (objectKey, _filePath, contentType) => {
      puts.push({ key: objectKey, contentType });
    },
  });
  try {
    const result = await uploadImageToOss(localPath, "renders/job-1/cover.jpg", "example-storage");
    assert.deepEqual(puts, [{ key: "renders/job-1/cover.jpg", contentType: "image/jpeg" }]);
    assert.equal(result.key, "renders/job-1/cover.jpg");
    assert.equal(new URL(result.url).pathname, "/example-storage/renders/job-1/cover.jpg");
    assert.equal(result.sizeBytes, 10);
  } finally {
    await rm(localPath, { force: true });
    _setOciImplsForTests(null);
    restoreEnv(saved);
  }
});

test("downloadDirectoryFromOss and deleteOssPrefix switch to the OCI list/delete path", async () => {
  const saved = setOciEnv();
  const listedPrefixes: string[] = [];
  const deletedBatches: string[][] = [];
  _setOciImplsForTests({
    listPage: async (args) => {
      listedPrefixes.push(args.prefix);
      return { keys: ["renders/task-1/plan/index.html", "renders/task-1/plan/scene.json"], isTruncated: false };
    },
    deleteObjects: async (keys) => {
      deletedBatches.push(keys);
      return keys.length;
    },
  });
  try {
    const deleted = await deleteOssPrefix("example-storage", "renders/task-1/plan");
    assert.deepEqual(listedPrefixes, ["renders/task-1/plan/"]);
    assert.deepEqual(deletedBatches, [["renders/task-1/plan/index.html", "renders/task-1/plan/scene.json"]]);
    assert.equal(deleted, 2);
  } finally {
    _setOciImplsForTests(null);
    restoreEnv(saved);
  }
});
