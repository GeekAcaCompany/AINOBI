// SPDX-License-Identifier: AGPL-3.0-only
import { test } from "vitest";
import assert from "node:assert/strict";
import { RouteRegistry, type RouteDef } from "./route-registry.ts";

function route(overrides: Partial<RouteDef>): RouteDef {
  return {
    method: "GET",
    path: "/",
    operationId: "test_op",
    handler: async () => null,
    ...overrides,
  };
}

test("路径参数提取与解码", () => {
  const registry = new RouteRegistry();
  registry.add([route({ method: "POST", path: "/organization/:org_id/course/:course_id/student" })]);

  const match = registry.match("POST", "v1", "/organization/org-1/course/42/student");
  assert.ok(match);
  assert.deepEqual(match.params, { org_id: "org-1", course_id: "42" });
});

test("percent-encoded 参数解码", () => {
  const registry = new RouteRegistry();
  registry.add([route({ path: "/user/:name/info" })]);

  const match = registry.match("GET", "v1", "/user/%E5%BC%A0%E4%B8%89/info");
  assert.ok(match);
  assert.equal(match.params.name, "张三");
});

test("挂载域隔离：v1 路径不匹配根域", () => {
  const registry = new RouteRegistry();
  registry.add([route({ method: "GET", path: "/health", mount: "root" })]);

  assert.ok(registry.match("GET", "root", "/health"));
  assert.equal(registry.match("GET", "v1", "/health"), null);
});

test("405 判定：路径存在但方法不符", () => {
  const registry = new RouteRegistry();
  registry.add([route({ method: "POST", path: "/user/login" })]);

  assert.equal(registry.match("GET", "v1", "/user/login"), null);
  assert.ok(registry.matchesAnyMethod("v1", "/user/login"));
});

test("HEAD 回退命中 GET 路由", () => {
  const registry = new RouteRegistry();
  registry.add([route({ method: "GET", path: "/user/me" })]);

  assert.ok(registry.match("HEAD", "v1", "/user/me"));
});

test("尾斜杠重定向目标探测", () => {
  const registry = new RouteRegistry();
  registry.add([route({ method: "GET", path: "/user/login" })]);

  // Slash-removal direction: /user/login/ → /user/login (Starlette redirect_slashes)
  assert.equal(registry.redirectTarget("v1", "/user/login/", "?x=1"), "/user/login?x=1");
  // An exact path already matches and does not redirect; unregistered paths do not redirect either
  assert.equal(registry.redirectTarget("v1", "/user/login", ""), null);
  assert.equal(registry.redirectTarget("v1", "/nope/", ""), null);
});

test("按注册顺序先匹配（FastAPI 语义）", () => {
  const registry = new RouteRegistry();
  registry.add([
    route({ method: "GET", path: "/course/:id/info", operationId: "first" }),
    route({ method: "GET", path: "/course/:course_id/detail", operationId: "second" }),
  ]);

  const match = registry.match("GET", "v1", "/course/42/info");
  assert.ok(match);
  assert.equal(match.route.def.operationId, "first");
});
