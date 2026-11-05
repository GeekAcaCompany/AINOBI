// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  coursewareContentReferencesObjectKey,
  isAgentDirectOssObjectKey,
  isAwsS3ObjectKey,
  isOssKeyAllowedForCoursewarePresign,
  normalizeObjectKeyFromInput,
} from "./courseware-asset-presign.ts";

describe("normalizeObjectKeyFromInput", () => {
  it("extracts OSS raw/ and artifact/ keys", () => {
    expect(normalizeObjectKeyFromInput("raw/png/abc.png")).toBe("raw/png/abc.png");
    expect(normalizeObjectKeyFromInput("artifact/html/abc/index.html")).toBe(
      "artifact/html/abc/index.html",
    );
    expect(
      normalizeObjectKeyFromInput(
        "https://example-courseware.oss-ap-northeast-1.aliyuncs.com/raw/png/foo.png?OSSAccessKeyId=x",
      ),
    ).toBe("raw/png/foo.png");
  });

  it("strips the first path segment as bucket on OCI compat URLs (example-public 回归)", () => {
    // The bucket name example-public ends in "public": a naive prefix search cutting into the bucket name produces
    // a doubled `public/public/...` prefix → the gate never passes → batch_presign silently misses entries.
    expect(
      normalizeObjectKeyFromInput(
        "https://examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com/example-public/public/live2d_models/ainobi-teacher-001/ainobi-teacher-001.model3.json",
      ),
    ).toBe("public/live2d_models/ainobi-teacher-001/ainobi-teacher-001.model3.json");
    expect(
      normalizeObjectKeyFromInput(
        "https://examplenamespace.compat.objectstorage.ap-tokyo-1.oci.customer-oci.com/example-storage/raw/mp3/abc.mp3",
      ),
    ).toBe("raw/mp3/abc.mp3");
    expect(
      normalizeObjectKeyFromInput(
        "https://objectstorage.ap-tokyo-1.oraclecloud.com/n/examplenamespace/b/example-public/o/public/live2d_models/ainobi-teacher-001/ainobi-teacher-001.model3.json",
      ),
    ).toBe("public/live2d_models/ainobi-teacher-001/ainobi-teacher-001.model3.json");
  });

  it("extracts S3 courseware_assets/ and tts_outputs/ keys", () => {
    expect(normalizeObjectKeyFromInput("courseware_assets/icons/star.svg")).toBe(
      "courseware_assets/icons/star.svg",
    );
    expect(
      normalizeObjectKeyFromInput(
        "https://cdn.example.com/courseware_assets/models/global.model3.json?X-Amz-Signature=zzz",
      ),
    ).toBe("courseware_assets/models/global.model3.json");
    expect(normalizeObjectKeyFromInput("tts_outputs/global.mp3")).toBe("tts_outputs/global.mp3");
  });

  it("extracts keys after /courseware/asset/file/ marker", () => {
    expect(
      normalizeObjectKeyFromInput(
        "https://app.example.com/courseware/asset/file/courseware_assets/bg.png",
      ),
    ).toBe("courseware_assets/bg.png");
  });

  it("returns null for unsupported paths", () => {
    expect(normalizeObjectKeyFromInput("https://example.com/other/file.png")).toBeNull();
    expect(normalizeObjectKeyFromInput("")).toBeNull();
  });
});

describe("isAwsS3ObjectKey", () => {
  it("identifies S3 prefixes only", () => {
    assert.equal(isAwsS3ObjectKey("courseware_assets/a.png"), true);
    assert.equal(isAwsS3ObjectKey("tts_outputs/n.mp3"), true);
    assert.equal(isAwsS3ObjectKey("organization/org/logo.png"), true);
    assert.equal(isAwsS3ObjectKey("raw/png/a.png"), false);
    assert.equal(isAwsS3ObjectKey("artifact/html/x/index.html"), false);
  });
});

describe("agent direct OSS access helpers", () => {
  it("detects raw/ and artifact/ keys", () => {
    assert.equal(isAgentDirectOssObjectKey("raw/html/abc.html"), true);
    assert.equal(isAgentDirectOssObjectKey("artifact/pdf/x"), true);
    assert.equal(isAgentDirectOssObjectKey("courseware_assets/x.png"), false);
  });

  it("matches object keys referenced in scene JSON", () => {
    const content = {
      slide_elements: [
        {
          children_elements: [
            {
              element_type: "html",
              src: "https://courseware.example.com/raw/html/c7e365142cc15ac732ae2c486dfe0329.html",
            },
          ],
        },
      ],
    };
    assert.equal(
      coursewareContentReferencesObjectKey(content, "raw/html/c7e365142cc15ac732ae2c486dfe0329.html"),
      true,
    );
    assert.equal(coursewareContentReferencesObjectKey(content, "raw/html/missing.html"), false);
  });

  it("allows batch presign for registered assets or scene-referenced raw/artifact keys", () => {
    const content = {
      slide_elements: [
        {
          children_elements: [
            {
              element_type: "narration",
              segments: [{ audio_url: "raw/mp3/narration.mp3" }],
            },
          ],
        },
      ],
    };
    const registered = new Set(["courseware_assets/bg.png"]);
    assert.equal(
      isOssKeyAllowedForCoursewarePresign("courseware_assets/bg.png", content, registered),
      true,
    );
    assert.equal(isOssKeyAllowedForCoursewarePresign("raw/mp3/narration.mp3", content, registered), true);
    assert.equal(isOssKeyAllowedForCoursewarePresign("raw/mp3/other.mp3", content, registered), false);
    assert.equal(
      isOssKeyAllowedForCoursewarePresign("courseware_assets/unlisted.png", content, registered),
      false,
    );
  });
});

function expect(actual: string | null) {
  return {
    toBe(expected: string | null) {
      assert.equal(actual, expected);
    },
    toBeNull() {
      assert.equal(actual, null);
    },
  };
}
