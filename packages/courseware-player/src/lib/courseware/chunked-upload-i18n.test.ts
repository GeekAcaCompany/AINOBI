// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { uploadCoursewareAssetChunked } from "./chunked-asset-upload.ts";
import { uploadQuizAnswerRecordingChunked } from "./chunked-quiz-answer-recording-upload.ts";
import coursewareAssetsApi from "../../api/courseware_assets.ts";

// FT6: upload guard errors localize via options.language (default zh). The
// guards throw before any network access, so no mocking is needed.

const someFile = new File(["x"], "a.bin");
const emptyFile = new File([], "empty.bin");

describe("uploadCoursewareAssetChunked i18n", () => {
  it("keeps Chinese guard messages by default", async () => {
    await expect(
      uploadCoursewareAssetChunked({ coursewareId: " ", file: someFile }),
    ).rejects.toThrow("缺少 courseware_id，无法上传素材");
    await expect(
      uploadCoursewareAssetChunked({ coursewareId: "cw_1", file: emptyFile }),
    ).rejects.toThrow("不能上传空文件");
  });

  it("localizes guard messages for en/ja", async () => {
    await expect(
      uploadCoursewareAssetChunked({ coursewareId: " ", file: someFile, language: "en" }),
    ).rejects.toThrow("Missing courseware_id; cannot upload assets");
    await expect(
      uploadCoursewareAssetChunked({ coursewareId: "cw_1", file: emptyFile, language: "ja" }),
    ).rejects.toThrow("空のファイルはアップロードできません");
  });
});

describe("coursewareAssetsApi.uploadAsset guard i18n", () => {
  it("uses the explicit language for the missing-id guard", async () => {
    await expect(
      coursewareAssetsApi.uploadAsset(" ", someFile, { language: "ja" }),
    ).rejects.toThrow("courseware_id がないため教材素材にアクセスできません");
  });

  it("falls back to the declared zh default when language is omitted", async () => {
    await expect(coursewareAssetsApi.uploadAsset(" ", someFile)).rejects.toThrow(
      "缺少 courseware_id，无法访问课件素材",
    );
  });
});

describe("uploadQuizAnswerRecordingChunked i18n", () => {
  it("keeps Chinese guard messages by default", async () => {
    await expect(
      uploadQuizAnswerRecordingChunked({ coursewareId: " ", file: someFile }),
    ).rejects.toThrow("缺少 courseware_id，无法上传答题录音");
  });

  it("localizes guard messages for en", async () => {
    await expect(
      uploadQuizAnswerRecordingChunked({ coursewareId: " ", file: someFile, language: "en" }),
    ).rejects.toThrow("Missing courseware_id; cannot upload answer recording");
  });
});
