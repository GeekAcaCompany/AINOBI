// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import {
  _resetFcRenderInstanceExitForTests,
  registerFcRenderInstanceExitHandler,
  requestFcRenderInstanceExit,
  shouldExitFcRenderInstanceAfterTask,
} from "./fc-instance-lifecycle.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    _resetFcRenderInstanceExitForTests();
  }
}

test("shouldExitFcRenderInstanceAfterTask follows explicit function role", () => {
  // Exit-after-task is an FC container-lifecycle behavior only: Kubernetes
  // workers are long-lived Deployment pods and must never exit after a task.
  withEnv(
    { AINOBI_VIDEO_RENDER_FUNCTION_ROLE: "render", FC_FUNCTION_NAME: "render" },
    () => {
      assert.equal(shouldExitFcRenderInstanceAfterTask(), true);
    },
  );

  withEnv(
    { AINOBI_VIDEO_RENDER_FUNCTION_ROLE: "render", FC_FUNCTION_NAME: undefined },
    () => {
      assert.equal(shouldExitFcRenderInstanceAfterTask(), false);
    },
  );

  withEnv(
    { AINOBI_VIDEO_RENDER_FUNCTION_ROLE: "render", FC_SERVICE_NAME: "svc" },
    () => {
      assert.equal(shouldExitFcRenderInstanceAfterTask(), true);
    },
  );

  withEnv({ AINOBI_VIDEO_RENDER_FUNCTION_ROLE: "query" }, () => {
    assert.equal(shouldExitFcRenderInstanceAfterTask(), false);
  });

  withEnv({ AINOBI_VIDEO_RENDER_FUNCTION_ROLE: undefined }, () => {
    assert.equal(shouldExitFcRenderInstanceAfterTask(), false);
  });
});

test("requestFcRenderInstanceExit invokes registered handler once", () => {
  withEnv(
    { AINOBI_VIDEO_RENDER_FUNCTION_ROLE: "render", FC_FUNCTION_NAME: "render" },
    () => {
      const reasons: string[] = [];
      registerFcRenderInstanceExitHandler((reason) => reasons.push(reason));
      requestFcRenderInstanceExit("task=abc finished");
      requestFcRenderInstanceExit("ignored duplicate");
      assert.deepEqual(reasons, ["task=abc finished"]);
    },
  );

  withEnv({ AINOBI_VIDEO_RENDER_FUNCTION_ROLE: "render" }, () => {
    const reasons: string[] = [];
    registerFcRenderInstanceExitHandler((reason) => reasons.push(reason));
    requestFcRenderInstanceExit("k8s worker keeps running");
    assert.deepEqual(reasons, []);
  });
});
