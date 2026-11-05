// SPDX-License-Identifier: AGPL-3.0-only
import { spawn } from "node:child_process";

import { resolveFfmpegExecutablePath } from "../config/video-render.ts";

function resolveFfmpegBinary(): string {
  return resolveFfmpegExecutablePath() || "ffmpeg";
}

/**
 * Extract a single JPEG frame from a rendered MP4 (default t=1s).
 * Best-effort: callers should catch and continue without a cover on failure.
 */
export async function extractVideoCoverJpeg(
  videoPath: string,
  outputPath: string,
  timeSec = 1,
): Promise<void> {
  const ffmpeg = resolveFfmpegBinary();
  const safeTime = Math.max(0, timeSec);

  await new Promise<void>((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(safeTime),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      "-y",
      outputPath,
    ];
    const proc = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `ffmpeg exited with code ${code ?? "unknown"}`));
    });
  });
}
