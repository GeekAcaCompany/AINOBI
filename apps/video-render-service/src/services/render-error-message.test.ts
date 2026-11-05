// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { toUserFacingRenderErrorMessage } from "./render-error-message.ts";

test("maps __hf / FrameCapture probe timeout to a product message", () => {
  const raw =
    "[FrameCapture] window.__hf not ready after 120000ms. Page must expose window.__hf = { duration, seek }.\n" +
    "  State: __hf=false, seek=false, player=false, renderReady=false, duration=-1";
  assert.equal(
    toUserFacingRenderErrorMessage(raw),
    "课件页面未准备就绪，可能是资源加载失败，请稍后重试",
  );
});

test("maps interrupted and cancelled codes", () => {
  assert.equal(toUserFacingRenderErrorMessage("interrupted:stale_heartbeat"), "渲染任务中断，请重试");
  assert.equal(toUserFacingRenderErrorMessage("interrupted:service_restart"), "渲染任务中断，请重试");
  assert.equal(toUserFacingRenderErrorMessage("cancelled:user"), "任务已取消");
});

test("maps common infra failures", () => {
  assert.equal(
    toUserFacingRenderErrorMessage("socket hang up"),
    "网络异常，无法完成渲染，请稍后重试",
  );
  assert.equal(
    toUserFacingRenderErrorMessage("Target closed"),
    "渲染浏览器异常退出，请稍后重试",
  );
  assert.equal(
    toUserFacingRenderErrorMessage("[XHRLoader] Failed to load resource as json (Status 403)"),
    "课件资源无法访问，请检查资源权限后重试",
  );
  assert.equal(
    toUserFacingRenderErrorMessage("OSS putObject failed: AccessDenied"),
    "视频上传失败，请稍后重试",
  );
});

test("passes through short non-technical messages", () => {
  assert.equal(toUserFacingRenderErrorMessage("课件链接无效"), "课件链接无效");
});

test("falls back for unknown technical errors", () => {
  assert.equal(
    toUserFacingRenderErrorMessage("Unexpected internal failure in renderOrchestrator.ts:42"),
    "视频渲染失败，请稍后重试",
  );
  assert.equal(
    toUserFacingRenderErrorMessage("JavaScript heap out of memory"),
    "渲染内存不足，请稍后重试或缩短课件",
  );
});

test("nullish / blank stay null", () => {
  assert.equal(toUserFacingRenderErrorMessage(null), null);
  assert.equal(toUserFacingRenderErrorMessage(undefined), null);
  assert.equal(toUserFacingRenderErrorMessage("   "), null);
});
