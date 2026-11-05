// SPDX-License-Identifier: AGPL-3.0-only
import { requestPathname } from "../http/request.ts";

/** POST paths under `/courseware/assets/*` served by {@link handleCoursewareAssetsPost}. */
export function isCoursewareAssetsPostPath(url: string | undefined): boolean {
  const p = requestPathname(url);
  return (
    p === "/courseware/assets/upload" ||
    p === "/courseware/assets/upload/init" ||
    p === "/courseware/assets/upload/chunk" ||
    p === "/courseware/assets/upload/complete" ||
    p === "/courseware/assets/upload/abort" ||
    p === "/courseware/assets/list" ||
    p === "/courseware/assets/delete" ||
    p === "/courseware/assets/batch_presign_urls" ||
    p === "/courseware/assets/get" ||
    p === "/courseware/assets/read_text"
  );
}
