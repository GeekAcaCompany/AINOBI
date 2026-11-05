// SPDX-License-Identifier: AGPL-3.0-only
import minimist from "minimist";

import "../src/ensure-env.ts";
import { resolveBrowserExecutablePath } from "../src/config/video-render.ts";
import { renderUrlToVideo } from "../src/services/video-render.ts";

function printUsage(): void {
  console.log(`用法:
  yarn render:url --url <页面URL> [选项]
  yarn render:url <页面URL> [选项]

选项:
  --url, -u          要渲染的页面地址（必填）
  --width            视频宽度（默认读取 AINOBI_VIDEO_RENDER_WIDTH 或 1920）
  --height           视频高度（默认读取 AINOBI_VIDEO_RENDER_HEIGHT 或 1080）
  --duration         视频时长，毫秒（courseware 默认用课件全长；仅调试时覆盖）
  --fps              帧率（默认读取 AINOBI_VIDEO_RENDER_FPS 或 30）
  --upload           渲染后上传到 OSS（覆盖环境变量）
  --no-upload        不上传 OSS（本地调试推荐）
  --progress         在终端显示 Hyperframes 渲染进度
  --help, -h         显示帮助

环境变量:
  AINOBI_OUTPUT_DIR                         本地 MP4 输出目录
  AINOBI_VIDEO_RENDER_OSS_UPLOAD            是否上传 OSS（默认 true）
  AINOBI_VIDEO_RENDER_BROWSER_EXECUTABLE    可选，指定 Chrome 可执行文件路径
  AINOBI_VIDEO_RENDER_PREPARE_TIMEOUT_MS    页面就绪超时（默认 10000）
  AINOBI_VIDEO_RENDER_BROWSER_USE_GPU       是否启用 GPU（默认 false）

示例:
  yarn render:url --url http://localhost:5173/courseware-renderer?courseware_id=... --no-upload
  yarn render:url http://localhost:8080/test.html --duration 5000 --width 1280 --height 720
`);
}

function parseOptionalPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`无效数值: ${value}`);
  }

  return Math.floor(parsed);
}

function resolveUploadFlag(args: Record<string, unknown>): boolean | undefined {
  if (args.upload === true) {
    return true;
  }
  if (args.upload === false || args["no-upload"] === true) {
    return false;
  }
  return undefined;
}

async function main(): Promise<void> {
  const args = minimist(process.argv.slice(2), {
    string: ["url", "u"],
    boolean: ["help", "h", "upload", "no-upload", "progress"],
    alias: {
      u: "url",
      h: "help",
    },
  });

  if (args.help) {
    printUsage();
    return;
  }

  const url = String(args.url || args._[0] || "").trim();
  if (!url) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (args.progress) {
    process.env.AINOBI_VIDEO_RENDER_SHOW_PROGRESS = "true";
  }

  const startedAt = Date.now();
  const browserExecutablePath = resolveBrowserExecutablePath();

  console.log(`[render] url=${url}`);
  console.log(`[render] browser=${browserExecutablePath ?? "Hyperframes bundled Chromium"}`);

  try {
    const result = await renderUrlToVideo({
      url,
      width: parseOptionalPositiveInt(args.width),
      height: parseOptionalPositiveInt(args.height),
      duration: parseOptionalPositiveInt(args.duration),
      fps: parseOptionalPositiveInt(args.fps),
      uploadToOss: resolveUploadFlag(args),
    });

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[render] 完成，耗时 ${elapsedSec}s`);
    console.log(`[render] jobId=${result.jobId}`);
    console.log(`[render] localPath=${result.localPath}`);
    console.log(
      `[render] duration=${Math.round(result.render.duration)}ms takes=${Math.round(result.render.takes)}ms rtf=${result.render.rtf.toFixed(2)}`,
    );

    if (result.ossUploadEnabled && result.oss) {
      console.log(`[render] oss=${result.oss.url}`);
    } else {
      console.log("[render] oss upload skipped");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[render] 失败:", message);
    if (/ECONNRESET|socket hang up|Target closed|window\.__hf not ready/i.test(message)) {
      console.error(
        "[render] 提示: Chrome 启动失败或页面未暴露 window.__hf。courseware-renderer 需带 hf=1；可设置 AINOBI_VIDEO_RENDER_BROWSER_EXECUTABLE 或增大 AINOBI_VIDEO_RENDER_PREPARE_TIMEOUT_MS。",
      );
    }
    process.exitCode = 1;
  }
}

void main();
