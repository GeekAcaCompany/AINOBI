// SPDX-License-Identifier: AGPL-3.0-only
import config from "../../host/config.ts";

/** Whether courseware private assets use `batch_presign_urls` at runtime (see `modules.courseware.assetPresignEnabled`). */
export function isCoursewareAssetPresignEnabled(): boolean {
  return config.modules?.courseware?.assetPresignEnabled !== false;
}
