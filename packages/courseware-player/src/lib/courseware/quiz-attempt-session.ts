// SPDX-License-Identifier: AGPL-3.0-only
import type { RefObject } from "react";

export const buildQuizAttemptSessionStorageKey = (params: {
  learnerId: string;
  /** Preview URLs may lack org_id; `_` is the default so attempt_session can still write sessionStorage. */
  orgId?: string | null;
  courseId: string;
  sectionId: string;
  coursewareId: string;
}): string =>
  [
    "coursewareQuizAttempt",
    params.learnerId,
    params.orgId?.trim() || "_",
    params.courseId,
    params.sectionId,
    params.coursewareId,
  ].join(":");

export const readQuizAttemptSessionId = (storageKey: string | null): string | null => {
  if (!storageKey || typeof window === "undefined") return null;
  return window.sessionStorage.getItem(storageKey);
};

export const persistQuizAttemptSessionId = (
  storageKey: string | null,
  attemptSessionIdRef: RefObject<string | null>,
  attemptSessionId: string,
): void => {
  attemptSessionIdRef.current = attemptSessionId;
  if (storageKey) {
    window.sessionStorage.setItem(storageKey, attemptSessionId);
  }
};

export const clearQuizAttemptSessionId = (
  storageKey: string | null,
  attemptSessionIdRef: RefObject<string | null>,
): void => {
  attemptSessionIdRef.current = null;
  if (storageKey) {
    window.sessionStorage.removeItem(storageKey);
  }
};
