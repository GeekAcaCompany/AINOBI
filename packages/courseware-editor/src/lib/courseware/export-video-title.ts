// SPDX-License-Identifier: AGPL-3.0-only
/** `课件名 20260709-1613` — safe default export title with a filesystem-friendly timestamp. */
export function buildDefaultExportVideoTitle(coursewareName: string, at = new Date()): string {
  const base = coursewareName.trim() || "courseware";
  const stamp = formatExportVideoTitleTimestamp(at);
  return `${base} ${stamp}`;
}

export function formatExportVideoTitleTimestamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function sanitizeExportVideoFilename(title: string): string {
  const trimmed = title
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 180);
  return trimmed || "export";
}

export function resolveRenderTaskTitle(task: { request?: { title?: string | null } }): string {
  const title = task.request?.title?.trim();
  return title || "";
}

/** Download a remote file in the browser with a chosen local filename. */
export async function downloadExportVideoFile(url: string, filename: string): Promise<void> {
  const triggerAnchor = (href: string, downloadName: string): void => {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = downloadName;
    anchor.rel = "noreferrer";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      triggerAnchor(objectUrl, filename);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    triggerAnchor(url, filename);
  }
}
