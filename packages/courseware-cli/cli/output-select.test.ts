// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

import { AinobiCliError } from "./errors.ts";
import { formatSelected, parseSelectPath, selectFromData } from "./output-select.ts";

const data = {
  slide: {
    name: "封面",
    children_elements: [
      { element_id: "el_text_1", name: "标题", element_type: "text", text: "Hello" },
      { element_id: "el_narr_1", name: "旁白", element_type: "narration", segments: [{ start: 0 }] },
    ],
  },
};

test("selects nested keys and array indexes (data. prefix optional)", () => {
  assert.equal(selectFromData(data, "slide.name"), "封面");
  assert.equal(selectFromData(data, "data.slide.children_elements[0].text"), "Hello");
  assert.deepEqual(selectFromData(data, ".slide.children_elements[-1].segments"), [{ start: 0 }]);
});

test("[] maps over arrays and {a,b} projects keys", () => {
  assert.deepEqual(selectFromData(data, "slide.children_elements[].element_id"), ["el_text_1", "el_narr_1"]);
  assert.deepEqual(selectFromData(data, "slide.children_elements[]{element_id,element_type}"), [
    { element_id: "el_text_1", element_type: "text" },
    { element_id: "el_narr_1", element_type: "narration" },
  ]);
});

test("missing keys report the available keys", () => {
  assert.throws(
    () => selectFromData(data, "slide.elements"),
    (error: unknown) =>
      error instanceof AinobiCliError &&
      error.code === "NOT_FOUND" &&
      /slide has no key "elements"/.test(error.message) &&
      /Keys at slide: name, children_elements/.test(error.hint ?? ""),
  );
  assert.throws(() => selectFromData(data, "slide.children_elements[5]"), /out of range/);
});

test("rejects malformed paths", () => {
  assert.throws(() => parseSelectPath("slide.children_elements[0"), /missing \]/);
  assert.throws(() => parseSelectPath("slide{a}.name"), /must be the last step/);
});

test("scalars print raw, structures as JSON", () => {
  assert.equal(formatSelected("a b", false), "a b");
  assert.equal(formatSelected(3, false), "3");
  assert.equal(formatSelected({ a: 1 }, false), '{"a":1}');
});

test("nested projections: every {…} field is a path of its own", () => {
  // The exact path an agent wrote in a prod-like session (previously a parse error).
  assert.deepEqual(
    selectFromData(data, "slide.{name,children_elements[]{element_id,name,element_type,text}}"),
    {
      name: "封面",
      children_elements: [
        { element_id: "el_text_1", name: "标题", element_type: "text", text: "Hello" },
        { element_id: "el_narr_1", name: "旁白", element_type: "narration" },
      ],
    },
  );
  assert.deepEqual(selectFromData(data, "{slide{name}}"), { slide: { name: "封面" } });
  assert.deepEqual(selectFromData(data, "slide.{children_elements[0].name}"), { children_elements: "标题" });
  assert.throws(() => parseSelectPath("slide.{name"), /missing \}/);
  assert.throws(() => parseSelectPath("slide.{}"), /empty \{\} projection/);
});
