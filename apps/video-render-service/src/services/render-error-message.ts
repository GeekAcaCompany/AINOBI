// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Map stored / thrown render-pipeline errors to short user-facing copy.
 * Raw technical messages stay in DB/logs; API + callback responses use this.
 */

const GENERIC_FAILURE = "视频渲染失败，请稍后重试";

type Rule = { test: RegExp; message: string };

const RULES: readonly Rule[] = [
  { test: /^cancelled:/i, message: "任务已取消" },
  {
    test: /^interrupted:(stale_heartbeat|service_restart)/i,
    message: "渲染任务中断，请重试",
  },
  {
    test: /window\.__hf not ready|FrameCapture|renderReady=false|player=false/i,
    message: "课件页面未准备就绪，可能是资源加载失败，请稍后重试",
  },
  {
    test: /Target closed|browser.*(crash|disconnect|closed)|Chrome.*(crash|failed)/i,
    message: "渲染浏览器异常退出，请稍后重试",
  },
  {
    test: /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up|net::ERR_/i,
    message: "网络异常，无法完成渲染，请稍后重试",
  },
  {
    test: /timed?\s*out|timeout|still waiting for browser/i,
    message: "渲染超时，请稍后重试",
  },
  {
    test: /403|Forbidden|Failed to load resource|XHRLoader/i,
    message: "课件资源无法访问，请检查资源权限后重试",
  },
  {
    test: /404|Not Found/i,
    message: "课件资源不存在或地址无效，请检查后重试",
  },
  {
    test: /\bOSS\b|ali-oss|upload.*(fail|error)|putObject/i,
    message: "视频上传失败，请稍后重试",
  },
  {
    test: /ffmpeg|ffprobe|cover extraction/i,
    message: "视频处理失败，请稍后重试",
  },
  {
    test: /out of memory|\bOOM\b|ENOMEM|Cannot allocate memory|memory limit/i,
    message: "渲染内存不足，请稍后重试或缩短课件",
  },
  {
    test: /navigation|page\.goto|net::ERR_NAME_NOT_RESOLVED/i,
    message: "无法打开课件页面，请检查链接后重试",
  },
];

/** Heuristic: looks like an internal/stack/diagnostic string, not product copy. */
const TECHNICAL_HINT =
  /[\[\]{}]|__hf|FrameCapture|ECONN|ETIMEDOUT|ENOTFOUND|ENOMEM|TypeError|ReferenceError|protocolTimeout|puppeteer|chromium|ffmpeg|ali-oss|Status \d{3}|window\.|renderReady|seek=|player=|at \w+\s*\(|Error:|failedStage|elapsedMs|\.ts:\d+/i;

/** Product copy we intentionally wrote (Chinese). Everything else unknown is treated as internal. */
const HAS_CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;

/**
 * Convert a raw render failure string into copy safe to show in product UI.
 * Returns `null` when input is nullish/blank (matches task `errorMessage` shape).
 */
export function toUserFacingRenderErrorMessage(raw: string | null | undefined): string | null {
  if (raw == null) {
    return null;
  }
  const message = raw.trim();
  if (!message) {
    return null;
  }

  for (const rule of RULES) {
    if (rule.test.test(message)) {
      return rule.message;
    }
  }

  // Intentional short Chinese product messages pass through; English/diagnostics do not.
  if (HAS_CJK.test(message) && !TECHNICAL_HINT.test(message) && message.length <= 80) {
    return message;
  }

  return GENERIC_FAILURE;
}
