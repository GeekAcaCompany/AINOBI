// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import type { RenderTaskResultPayload } from "../models/render-task-entity.ts";
import {
  presignRenderTaskResultForResponse,
  sanitizeRenderTaskResultForPersistence,
} from "./render-task-result-urls.ts";

const resultWithUrls = (): RenderTaskResultPayload => ({
  localPath: "/tmp/out.mp4",
  outputPath: "/tmp/out.mp4",
  render: { duration: 1000, takes: 2000, rtf: 0.5 },
  oss: {
    bucket: "example-video-bucket",
    key: "renders/job-1/out.mp4",
    url: "https://signed.example/renders/job-1/out.mp4?X-Amz-Signature=abc",
    sizeBytes: 123,
    etag: "e1",
  },
  cover: {
    bucket: "example-video-bucket",
    key: "renders/job-1/cover.jpg",
    url: "https://signed.example/renders/job-1/cover.jpg?X-Amz-Signature=def",
  },
});

test("sanitizeRenderTaskResultForPersistence strips urls, keeps keys", () => {
  const sanitized = sanitizeRenderTaskResultForPersistence(resultWithUrls());
  assert.equal(sanitized.oss?.url, undefined);
  assert.equal(sanitized.cover?.url, undefined);
  assert.equal(sanitized.oss?.bucket, "example-video-bucket");
  assert.equal(sanitized.oss?.key, "renders/job-1/out.mp4");
  assert.equal(sanitized.oss?.sizeBytes, 123);
  assert.equal(sanitized.oss?.etag, "e1");
  assert.equal(sanitized.cover?.key, "renders/job-1/cover.jpg");
  assert.equal(sanitized.render.takes, 2000);
});

test("sanitizeRenderTaskResultForPersistence does not mutate the input", () => {
  const original = resultWithUrls();
  sanitizeRenderTaskResultForPersistence(original);
  assert.equal(original.oss?.url, "https://signed.example/renders/job-1/out.mp4?X-Amz-Signature=abc");
});

test("presignRenderTaskResultForResponse keeps legacy aliyun url as-is without credentials", () => {
  // Aliyun mode with no signing credentials → stored (permanent) url passes
  // through. Credentials are pinned off so this holds regardless of env.
  const restore = withOssCreds(null);
  try {
    const response = presignRenderTaskResultForResponse(resultWithUrls());
    assert.equal(
      response?.oss?.url,
      "https://signed.example/renders/job-1/out.mp4?X-Amz-Signature=abc",
    );
  } finally {
    restore();
  }
});

test("presignRenderTaskResultForResponse presigns aliyun rows from bucket+key", () => {
  // Aliyun mode with credentials: the private-bucket storage policy requires
  // every read URL to be freshly signed — a stored plain/unsigned url must
  // never reach the client.
  const restore = withOssCreds({
    id: "test-ak",
    secret: "test-sk",
    endpoint: "https://oss-cn-shenzhen.aliyuncs.com",
  });
  try {
    const payload = resultWithUrls();
    const response = presignRenderTaskResultForResponse(payload);
    const url = response?.oss?.url ?? "";
    assert.ok(url.startsWith("https://example-video-bucket.oss-cn-shenzhen.aliyuncs.com/renders/job-1/out.mp4"), `signed against bucket host: ${url.slice(0, 90)}`);
    assert.ok(url.includes("Signature="), "carries OSS signature");
    assert.ok(url.includes("OSSAccessKeyId=test-ak"), "carries access key id");
    const coverUrl = response?.cover?.url ?? "";
    assert.ok(coverUrl.includes("Signature="), "cover url also presigned");
  } finally {
    restore();
  }
});

/** Pins/clears the aliyun OSS credential env for a test; returns a restore fn. */
function withOssCreds(creds: { id: string; secret: string; endpoint: string } | null): () => void {
  const keys = ["OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET", "OSS_ENDPOINT", "OSS_REGION", "OSS_STS_TOKEN"] as const;
  const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  if (creds) {
    process.env.OSS_ACCESS_KEY_ID = creds.id;
    process.env.OSS_ACCESS_KEY_SECRET = creds.secret;
    process.env.OSS_ENDPOINT = creds.endpoint;
  }
  return () => {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k as string];
      else process.env[k as string] = v;
    }
  };
}

test("presignRenderTaskResultForResponse handles null and missing url", () => {
  assert.equal(presignRenderTaskResultForResponse(null), null);
  const legacy: RenderTaskResultPayload = {
    localPath: "/tmp/o.mp4",
    outputPath: "/tmp/o.mp4",
    render: { duration: 1, takes: 1, rtf: 1 },
    oss: { bucket: "example-video-render-output", key: "renders/j/o.mp4" },
  };
  const response = presignRenderTaskResultForResponse(legacy);
  assert.ok(response?.oss?.url?.includes("example-video-render-output"), "rebuilds aliyun url from key");
  assert.ok(response?.oss?.url?.endsWith("/renders/j/o.mp4"), "url path matches the key");
});

test("presignRenderTaskResultForResponse keeps OCI-hosted stored url re-signed", () => {
  const previous = {
    backend: process.env.STORAGE_BACKEND,
    endpoint: process.env.OCI_S3_ENDPOINT,
    bucket: process.env.OCI_S3_BUCKET,
    key: process.env.OCI_S3_ACCESS_KEY_ID,
    secret: process.env.OCI_S3_SECRET_KEY,
    region: process.env.OCI_S3_REGION,
  };
  process.env.STORAGE_BACKEND = "oci_s3";
  process.env.OCI_S3_ENDPOINT = "https://ns.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com";
  process.env.OCI_S3_BUCKET = "example-video-bucket";
  process.env.OCI_S3_ACCESS_KEY_ID = "0".repeat(40);
  process.env.OCI_S3_SECRET_KEY = "test-secret";
  process.env.OCI_S3_REGION = "ap-tokyo-1";
  try {
    const payload = resultWithUrls();
    payload.oss!.url = "https://ns.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com/example-video-bucket/renders/job-1/out.mp4?X-Amz-Signature=old";
    const response = presignRenderTaskResultForResponse(payload);
    assert.ok(response?.oss?.url?.includes("X-Amz-Signature="), "re-signs OCI url from key");
    assert.ok(!response?.oss?.url?.includes("Signature=old"), "stored signature replaced");
    assert.ok(response?.oss?.url?.includes("/example-video-bucket/renders/job-1/out.mp4"), "key preserved in path");
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete (process.env as Record<string, unknown>)[name];
      else (process.env as Record<string, unknown>)[name] = value;
    }
  }
});
