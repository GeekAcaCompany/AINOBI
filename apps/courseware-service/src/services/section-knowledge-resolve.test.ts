// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import test from "node:test";

/**
 * Pure precedence helper mirroring chat-http section knowledge resolution.
 * Kept local so we can unit-test without DB.
 */
function resolveSectionKnowledgeTarget(args: {
  preferredSectionId?: string | null;
  bindingSectionId?: string | null;
  preferredCourseId?: string | null;
  bindingCourseId?: string | null;
}): { sectionId: string; courseId: string; via: string } {
  const preferredSectionId = args.preferredSectionId?.trim() || null;
  const bindingSectionId = args.bindingSectionId?.trim() || null;
  const sectionId = (preferredSectionId || bindingSectionId || "").trim();
  const courseId = (
    args.preferredCourseId?.trim() ||
    args.bindingCourseId?.trim() ||
    ""
  ).trim();
  const via = preferredSectionId
    ? "request.sectionId"
    : bindingSectionId
      ? "binding"
      : "unknown";
  return { sectionId, courseId, via };
}

test("URL sectionId wins over binding sectionId", () => {
  const r = resolveSectionKnowledgeTarget({
    preferredSectionId: "section-b",
    bindingSectionId: "section-a",
    preferredCourseId: "course-1",
    bindingCourseId: "course-0",
  });
  assert.equal(r.sectionId, "section-b");
  assert.equal(r.courseId, "course-1");
  assert.equal(r.via, "request.sectionId");
});

test("falls back to binding when URL has no section", () => {
  const r = resolveSectionKnowledgeTarget({
    preferredSectionId: null,
    bindingSectionId: "section-a",
    preferredCourseId: null,
    bindingCourseId: "course-0",
  });
  assert.equal(r.sectionId, "section-a");
  assert.equal(r.courseId, "course-0");
  assert.equal(r.via, "binding");
});

test("empty when neither URL nor binding present", () => {
  const r = resolveSectionKnowledgeTarget({});
  assert.equal(r.sectionId, "");
  assert.equal(r.via, "unknown");
});
