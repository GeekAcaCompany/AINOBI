// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";

import { stripCoursewareAssetSignatureFromUrl } from "@ainobi/courseware-player/api/courseware";
import { stripAITeacherAssetUrlsFromMetadata } from "./ai-teacher-metadata-urls.ts";

describe("stripAITeacherAssetUrlsFromMetadata", () => {
  const normalize = (url: string) => stripCoursewareAssetSignatureFromUrl(url) || url;

  it("strips signed model and avatar URLs in narration-style metadata", () => {
    const signedModel =
      "https://example-storage-bucket-dev.s3.amazonaws.com/organization/org-1/ai_teachers/t1/live2d_model/Aka.inx?AWSAccessKeyId=AKIA&Signature=sig&Expires=1";
    const signedAvatar =
      "https://example-storage-bucket-dev.s3.amazonaws.com/public/avatar/ainobi-teacher-001.png?AWSAccessKeyId=AKIA&Signature=avatar&Expires=1";

    const metadata = {
      model_url: signedModel,
      ai_teacher_live2d_model_url: signedModel,
      ai_teacher_live2d_model_image_url: signedModel,
      ai_teacher_avatar_url: signedAvatar,
      ai_teacher_id: "t1",
    };

    const stripped = stripAITeacherAssetUrlsFromMetadata(metadata, normalize);

    expect(stripped.model_url).toBe(signedModel.split("?")[0]);
    expect(stripped.ai_teacher_live2d_model_url).toBe(signedModel.split("?")[0]);
    expect(stripped.ai_teacher_live2d_model_image_url).toBe(signedModel.split("?")[0]);
    expect(stripped.ai_teacher_avatar_url).toBe(signedAvatar.split("?")[0]);
    expect(stripped.ai_teacher_id).toBe("t1");
  });
});
