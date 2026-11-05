// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  deepStripPresignQueries,
  stripPresignQueriesInText,
} from "./presign-url-sanitize.ts";

test("stripPresignQueriesInText drops presign query from OCI compat URLs", () => {
  const text =
    'audio_url: "https://ns.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com/example-storage/tts_outputs/a.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc&X-Amz-Expires=604800"';
  const out = stripPresignQueriesInText(text);
  assert.equal(
    out,
    'audio_url: "https://ns.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com/example-storage/tts_outputs/a.mp3"',
  );
});

test("stripPresignQueriesInText drops OSS signature query", () => {
  const text =
    "https://bucket.oss-ap-northeast-1.aliyuncs.com/raw/mp3/a.mp3?Expires=1&OSSAccessKeyId=k&Signature=sig";
  assert.equal(
    stripPresignQueriesInText(text),
    "https://bucket.oss-ap-northeast-1.aliyuncs.com/raw/mp3/a.mp3",
  );
});

test("stripPresignQueriesInText keeps URLs without presign params", () => {
  const text = "https://courseware.example.com/artifact/pdf/abc/index.html?mode=inline";
  assert.equal(stripPresignQueriesInText(text), text);
});

test("deepStripPresignQueries walks nested structures", () => {
  const entry = {
    type: "assistant",
    message: {
      content: [
        { type: "tool_result", text: "tts https://x.compat.objectstorage.r.oci.customer-oci.com/b/o/a.mp3?X-Amz-Signature=z" },
      ],
    },
    nested: { list: ["plain", { url: "https://y.example.com/a?Signature=q" }] },
  };
  const out = deepStripPresignQueries(entry) as typeof entry;
  const text = JSON.stringify(out);
  assert.ok(!text.includes("X-Amz-Signature"));
  assert.ok(!text.includes("Signature=q"));
  assert.ok(text.includes("https://x.compat.objectstorage.r.oci.customer-oci.com/b/o/a.mp3"));
  assert.equal((out.nested.list[1] as { url: string }).url, "https://y.example.com/a");
});
