// SPDX-License-Identifier: AGPL-3.0-only
import { coursewareApi } from "../../host/requester.ts";

/** The scene JSON fetch URL used when the agent / editor references another courseware (`GET /courseware?key=`). */
export function buildCoursewareSceneJsonUrl(coursewareKey: string): string {
  const key = coursewareKey.trim();
  const base = coursewareApi.baseUrl?.replace(/\/+$/, "") ?? "";
  if (!base || !key) return "";
  return `${base}/courseware?key=${encodeURIComponent(key)}`;
}
