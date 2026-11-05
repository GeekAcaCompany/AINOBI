// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";
import { ELEMENT_INSERT_ARG_SPEC, validateCommandArgs } from "./command-args.ts";
import type { ParsedArgs } from "./args.ts";

const parsed = (flags: Record<string, string | boolean>): ParsedArgs => ({
  positionals: ["0"],
  flags,
  multi: {},
  raw: [],
});

test("element insert accepts --allow-slide-media and --center-x", () => {
  assert.doesNotThrow(() =>
    validateCommandArgs(
      parsed({
        type: "image",
        asset: "./x.png",
        "allow-slide-media": true,
        "center-x": true,
      }),
      ELEMENT_INSERT_ARG_SPEC,
      "element insert",
    ),
  );
});

test("element insert rejects unknown flags", () => {
  assert.throws(
    () =>
      validateCommandArgs(
        parsed({ type: "image", "not-a-flag": true }),
        ELEMENT_INSERT_ARG_SPEC,
        "element insert",
      ),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Unknown flag/);
      return true;
    },
  );
});
