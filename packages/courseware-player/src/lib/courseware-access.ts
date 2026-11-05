// SPDX-License-Identifier: AGPL-3.0-only
import type { CoursewareAgentPersistenceResponse, CoursewareAgentPersistedDto } from "../api/courseware_agent.ts";
import type { Scene } from "@ainobi/courseware-core/scene.ts";
import { makeEditorAgentThreadStorageKey } from "./editorAgentThreadStorage.ts";
import {
  makeEditorStorageKey,
  removeEditorSceneRecord,
} from "./coursewareEditorSceneStorage.ts";

/** Matches ainobi-courseware-agent org access denial (e.g. HTTP 403 body `error`). */
export const COURSEWARE_ACCESS_FORBIDDEN_RE =
  /forbidden|no access to this organization courseware/i;

export class CoursewareAccessForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoursewareAccessForbiddenError";
  }
}

export class CoursewareAccessNotPublicError extends Error {
  constructor(message = "此课件未公开") {
    super(message);
    this.name = "CoursewareAccessNotPublicError";
  }
}

export const isCoursewareAccessForbiddenMessage = (message: string): boolean =>
  COURSEWARE_ACCESS_FORBIDDEN_RE.test(message);

export const isCoursewareAccessForbiddenError = (error: unknown): boolean => {
  if (error instanceof CoursewareAccessForbiddenError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return isCoursewareAccessForbiddenMessage(message);
};

export const isCoursewareAccessNotPublicError = (error: unknown): boolean =>
  error instanceof CoursewareAccessNotPublicError;

/** Editor lock overlay (403 without organization rights, or `isPublic === false` without `canManage`). */
export const isCoursewareAccessLockedError = (error: unknown): boolean =>
  isCoursewareAccessForbiddenError(error) || isCoursewareAccessNotPublicError(error);

export type CoursewareRemoteAccessVerdict =
  | { kind: "ok"; courseware: CoursewareAgentPersistedDto }
  | { kind: "locked"; reason: "forbidden" | "not_public"; error?: string }
  | { kind: "unavailable"; error: string };

export type EvaluateCoursewareRemoteAccessOptions = {
  /** true by default; the preview page passes false so it isn't blocked by `isPublic === false`. */
  lockWhenNotPublic?: boolean;
};

export const evaluateCoursewareRemoteAccess = (
  remote: CoursewareAgentPersistenceResponse,
  options?: EvaluateCoursewareRemoteAccessOptions,
): CoursewareRemoteAccessVerdict => {
  const lockWhenNotPublic = options?.lockWhenNotPublic !== false;
  if (!remote.ok) {
    const err = remote.error ?? "";
    if (isCoursewareAccessForbiddenMessage(err)) {
      return { kind: "locked", reason: "forbidden", error: err };
    }
    return { kind: "unavailable", error: err || "invalid response" };
  }
  const courseware = remote.courseware;
  if (!courseware?.content) {
    return { kind: "unavailable", error: "missing courseware content" };
  }
  if (lockWhenNotPublic && courseware.isPublic === false && !courseware.canManage) {
    return { kind: "locked", reason: "not_public" };
  }
  return { kind: "ok", courseware };
};

/**
 * The courseware API `title` and the scene JSON `name` may be out of sync (e.g. the management side changed only title).
 * When loading a remote courseware, the API title wins and is written back to `scene.name` for the editor top bar.
 */
export const applyCoursewareApiTitleToScene = (
  scene: Scene,
  apiTitle: string | null | undefined,
): Scene => {
  const trimmed = apiTitle?.trim();
  if (!trimmed || scene.name === trimmed) return scene;
  return { ...scene, name: trimmed };
};

/** Clear the editor scene draft and the assistant thread local cache of this courseware id. */
export const clearCoursewareEditorLocalDraft = async (coursewareId: string): Promise<void> => {
  const id = coursewareId.trim();
  if (!id) return;
  await removeEditorSceneRecord(makeEditorStorageKey(id));
  try {
    localStorage.removeItem(makeEditorAgentThreadStorageKey(id));
  } catch {
    // ignore
  }
};
