// SPDX-License-Identifier: AGPL-3.0-only
export function isCoursewareRendererUrl(url: string): boolean {
  try {
    return new URL(url).pathname.replace(/\/$/, "").endsWith("/courseware-renderer");
  } catch {
    return url.includes("courseware-renderer");
  }
}

export interface CoursewareRendererRenderParams {
  width: number;
  height: number;
  /** Omit or 0 to use scene total duration from the loaded courseware. */
  durationMs?: number;
}

/** Query params for Hyperframes headless capture (autoplay off, seek via window.__hf). */
export function withCoursewareRendererRenderParams(
  url: string,
  options: CoursewareRendererRenderParams,
): string {
  const parsed = new URL(url);
  parsed.searchParams.set("autoplay", "0");
  parsed.searchParams.set("hf", "1");
  parsed.searchParams.set("hf_width", String(options.width));
  parsed.searchParams.set("hf_height", String(options.height));
  if (options.durationMs != null && options.durationMs > 0) {
    parsed.searchParams.set("hf_duration_ms", String(options.durationMs));
  } else {
    parsed.searchParams.delete("hf_duration_ms");
  }
  return parsed.toString();
}

/** @deprecated Use withCoursewareRendererRenderParams */
export function withCoursewareRendererAutoplayDisabled(
  url: string,
  options: CoursewareRendererRenderParams = {
    width: 1920,
    height: 1080,
    durationMs: 10_000,
  },
): string {
  return withCoursewareRendererRenderParams(url, options);
}
