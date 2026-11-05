// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  refreshCoursewareAssetFileUrlForResponse,
  refreshCoursewareCoverUrlForResponse,
  refreshCoursewareRecordingFileUrlForResponse,
} from "./courseware-object-url-response.ts";

test("bare keys are served as playable URLs via the active backend", () => {
  const cover = refreshCoursewareCoverUrlForResponse(
    "courseware_covers/org-1/cw-1/hash.png"
  );
  assert.ok(cover && cover.includes("courseware_covers/org-1/cw-1/hash.png"), "keeps the key path");
  assert.ok(/^https?:\/\//.test(cover), "returns a URL, not the bare key");

  const asset = refreshCoursewareAssetFileUrlForResponse("raw/png/abc.png");
  assert.ok(asset && asset.includes("raw/png/abc.png"));
  assert.ok(asset !== "raw/png/abc.png");

  const recording = refreshCoursewareRecordingFileUrlForResponse(
    "quiz_answer_recordings/org-1/rec-1.webm"
  );
  assert.ok(recording && recording.includes("quiz_answer_recordings/org-1/rec-1.webm"));
});

test("legacy aliyun public URLs pass through untouched", () => {
  const aliyun = "https://example-courseware.oss-ap-northeast-1.aliyuncs.com/courseware_covers/org-1/cw-1/x.png";
  assert.equal(refreshCoursewareCoverUrlForResponse(aliyun), aliyun);
  assert.equal(
    refreshCoursewareAssetFileUrlForResponse(
      "https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/png/x.png"
    ),
    "https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/png/x.png",
  );
});

test("legacy OCI native URLs are re-signed from the extracted key", () => {
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
  process.env.OCI_S3_BUCKET = "example-storage";
  process.env.OCI_S3_ACCESS_KEY_ID = "0".repeat(40);
  process.env.OCI_S3_SECRET_KEY = "test-secret";
  process.env.OCI_S3_REGION = "ap-tokyo-1";
  try {
    const native =
      "https://objectstorage.ap-tokyo-1.oraclecloud.com/n/ns/b/example-public/o/courseware_covers/org-1/cw-1/x.png";
    const out = refreshCoursewareCoverUrlForResponse(native);
    assert.ok(out && out.includes("X-Amz-Signature="), "re-signed for OCI");
    assert.ok(!out.includes("oraclecloud.com"), "native host replaced by compat endpoint");
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete (process.env as Record<string, unknown>)[name];
      else (process.env as Record<string, unknown>)[name] = value;
    }
  }
});

test("null and empty inputs pass through", () => {
  assert.equal(refreshCoursewareCoverUrlForResponse(null), null);
  assert.equal(refreshCoursewareAssetFileUrlForResponse(""), "");
  assert.equal(refreshCoursewareRecordingFileUrlForResponse(undefined), null);
});
