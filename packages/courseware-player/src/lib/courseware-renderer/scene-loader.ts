// SPDX-License-Identifier: AGPL-3.0-only
import coursewareAgentApi, {
  dedupeSceneElementIds,
  isCoursewareApiConfigured,
} from "../../api/courseware_agent.ts";
import {
  applyCoursewareApiTitleToScene,
  CoursewareAccessForbiddenError,
  clearCoursewareEditorLocalDraft,
  evaluateCoursewareRemoteAccess,
} from "../courseware-access.ts";
import {
  deserializeScene,
  tryPresignSceneAssetUrls,
  type OssPresignNetwork,
  type Scene,
} from "../courseware/index.ts";
import { makePreviewStorageKey, readPreviewSceneBundle } from "../coursewarePreviewSceneStorage.ts";
import type { CoursewareTranslateFn } from "../i18n/coursewareRoutesI18n.ts";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const decodeBase64ToUtf8 = (value: string): string => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

export const parseSceneFromBase64 = (base64Data: string): Scene => {
  const jsonText = decodeBase64ToUtf8(base64Data);
  const parsed = JSON.parse(jsonText) as Scene;
  return deserializeScene(parsed);
};

export const parseSceneFromSerialized = (serialized: unknown): Scene =>
  deserializeScene(serialized as Scene);

export const normalizeInitialSlideIndex = (value: unknown, slideCount: number): number => {
  const index =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : 0;
  if (!Number.isFinite(index) || slideCount <= 0) return 0;
  return clamp(Math.trunc(index), 0, slideCount - 1);
};

export interface PreviewStorageScene {
  scene: Scene;
  revision: string | null;
  htmlIframeLayoutScale?: number;
}

export const readSceneFromPreviewStorage = async (
  id: string,
  t: CoursewareTranslateFn,
): Promise<PreviewStorageScene> => {
  const parsed = await readPreviewSceneBundle(makePreviewStorageKey(id));
  if (!parsed) throw new Error(t("coursewarePreview.errors.previewDataNotFound", { id }));
  if (!("scene" in parsed)) {
    throw new Error(t("coursewarePreview.errors.invalidPreviewData"));
  }
  return {
    scene: parseSceneFromSerialized(parsed.scene),
    revision: typeof parsed.revision === "string" ? parsed.revision : null,
    htmlIframeLayoutScale:
      typeof parsed.htmlIframeLayoutScale === "number" &&
      Number.isFinite(parsed.htmlIframeLayoutScale) &&
      parsed.htmlIframeLayoutScale > 0
        ? parsed.htmlIframeLayoutScale
        : undefined,
  };
};

export const rendererLoadsRemoteCoursewareOnly = (): boolean => {
  if (typeof window === "undefined") return false;
  const search = new URLSearchParams(window.location.search);
  return Boolean(search.get("courseware_id")?.trim()) && !search.get("id") && !search.get("data");
};

export const loadSceneFromRemoteCourseware = async (
  coursewareId: string,
  t: CoursewareTranslateFn,
  options?: { authRequired?: boolean; renderToken?: string },
): Promise<Scene> => {
  if (!isCoursewareApiConfigured()) {
    throw new Error(t("coursewarePreview.errors.serviceNotConfigured"));
  }
  const remote = await coursewareAgentApi.getCourseware(coursewareId, undefined, {
    authRequired: options?.authRequired,
    renderToken: options?.renderToken,
  });
  const access = evaluateCoursewareRemoteAccess(remote, { lockWhenNotPublic: false });
  if (access.kind === "locked") {
    await clearCoursewareEditorLocalDraft(coursewareId);
    throw new CoursewareAccessForbiddenError(access.error ?? "Forbidden");
  }
  if (access.kind !== "ok") {
    throw new Error(
      access.error ?? t("coursewarePreview.errors.notFoundOnServer", { coursewareId }),
    );
  }
  return applyCoursewareApiTitleToScene(
    dedupeSceneElementIds(deserializeScene(access.courseware.content)),
    access.courseware.title,
  );
};

export const presignLoadedScene = async (
  scene: Scene,
  coursewareId: string | null,
  options?: { network?: OssPresignNetwork; renderToken?: string },
): Promise<Scene> => tryPresignSceneAssetUrls(scene, coursewareId, options);
