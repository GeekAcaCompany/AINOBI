// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { isRouteAllowedForFunctionRole } from "./function-role.ts";

test("render role allows run/cancel/assemble/chunk-run and sync video only", () => {
  assert.equal(isRouteAllowedForFunctionRole("POST", "/render/video", "render"), true);
  assert.equal(isRouteAllowedForFunctionRole("POST", "/render/tasks", "render"), false);
  assert.equal(isRouteAllowedForFunctionRole("POST", "/render/tasks/uuid/run", "render"), true);
  assert.equal(isRouteAllowedForFunctionRole("POST", "/render/tasks/uuid/assemble", "render"), true);
  assert.equal(
    isRouteAllowedForFunctionRole("POST", "/render/tasks/uuid/chunks/0/run", "render"),
    true,
  );
  assert.equal(isRouteAllowedForFunctionRole("POST", "/render/tasks/uuid/retry", "render"), false);
  assert.equal(isRouteAllowedForFunctionRole("POST", "/render/tasks/uuid/cancel", "render"), true);
  assert.equal(isRouteAllowedForFunctionRole("GET", "/render/tasks", "render"), false);
  assert.equal(isRouteAllowedForFunctionRole("GET", "/render/tasks/uuid", "render"), false);
  assert.equal(isRouteAllowedForFunctionRole("DELETE", "/render/tasks/uuid", "render"), false);
});

test("query role allows create/list/get/delete/retry", () => {
  assert.equal(isRouteAllowedForFunctionRole("POST", "/render/tasks", "query"), true);
  assert.equal(isRouteAllowedForFunctionRole("GET", "/render/tasks", "query"), true);
  assert.equal(isRouteAllowedForFunctionRole("GET", "/render/tasks/uuid", "query"), true);
  assert.equal(isRouteAllowedForFunctionRole("DELETE", "/render/tasks/uuid", "query"), true);
  assert.equal(isRouteAllowedForFunctionRole("POST", "/render/tasks/uuid/retry", "query"), true);
  assert.equal(isRouteAllowedForFunctionRole("POST", "/render/tasks/uuid/run", "query"), false);
  assert.equal(isRouteAllowedForFunctionRole("POST", "/render/tasks/uuid/assemble", "query"), false);
  assert.equal(
    isRouteAllowedForFunctionRole("POST", "/render/tasks/uuid/chunks/0/run", "query"),
    false,
  );
  assert.equal(isRouteAllowedForFunctionRole("POST", "/render/tasks/uuid/cancel", "query"), false);
  assert.equal(isRouteAllowedForFunctionRole("POST", "/render/video", "query"), false);
});

test("all role allows every route", () => {
  assert.equal(isRouteAllowedForFunctionRole("POST", "/render/tasks", "all"), true);
  assert.equal(isRouteAllowedForFunctionRole("GET", "/render/tasks/uuid", "all"), true);
  assert.equal(isRouteAllowedForFunctionRole("POST", "/render/tasks/uuid/run", "all"), true);
});

test("health is allowed on every role", () => {
  for (const role of ["render", "query", "all"] as const) {
    assert.equal(isRouteAllowedForFunctionRole("GET", "/health", role), true);
  }
});
