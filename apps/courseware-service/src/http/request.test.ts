// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { test } from "node:test";

import { writeSseComment } from "./request.ts";

test("writeSseComment writes SSE comment line", () => {
  const chunks: string[] = [];
  const res = new EventEmitter() as ServerResponse;
  res.write = (chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  };

  writeSseComment(res);
  assert.equal(chunks.join(""), ": ping\n\n");

  writeSseComment(res, "keep-alive");
  assert.equal(chunks.join(""), ": ping\n\n: keep-alive\n\n");
});
