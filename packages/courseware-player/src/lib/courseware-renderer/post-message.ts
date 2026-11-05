// SPDX-License-Identifier: AGPL-3.0-only
export const RENDERER_PATHNAME = "/courseware-renderer";

export type CoursewareRendererOutboundMessage =
  | { type: "courseware-renderer:ready" }
  | {
      type: "courseware-renderer:scene-loaded";
      sceneId: string;
      slideCount: number;
      durationMs: number;
    }
  | { type: "courseware-renderer:preload-complete" }
  | { type: "courseware-renderer:playback-started" }
  | { type: "courseware-renderer:playback-complete" }
  | { type: "courseware-renderer:error"; message: string };

export type CoursewareRendererInboundMessage =
  | { type: "courseware-renderer:load-scene"; previewId: string; slideIndex?: number }
  | { type: "courseware-renderer:start-playback" }
  | { type: "courseware-renderer:seek"; sceneTimeMs: number };

export function postCoursewareRendererMessage(message: CoursewareRendererOutboundMessage): void {
  if (typeof window === "undefined") return;
  window.parent.postMessage(message, "*");
}

export function isRendererLoadSceneMessage(
  data: unknown,
): data is Extract<CoursewareRendererInboundMessage, { type: "courseware-renderer:load-scene" }> {
  if (!data || typeof data !== "object") return false;
  const payload = data as { type?: unknown; previewId?: unknown };
  return payload.type === "courseware-renderer:load-scene" && typeof payload.previewId === "string";
}

export function isRendererStartPlaybackMessage(data: unknown): boolean {
  return Boolean(
    data &&
      typeof data === "object" &&
      (data as { type?: unknown }).type === "courseware-renderer:start-playback",
  );
}

export function isRendererSeekMessage(
  data: unknown,
): data is Extract<CoursewareRendererInboundMessage, { type: "courseware-renderer:seek" }> {
  if (!data || typeof data !== "object") return false;
  const payload = data as { type?: unknown; sceneTimeMs?: unknown };
  return payload.type === "courseware-renderer:seek" && typeof payload.sceneTimeMs === "number";
}
