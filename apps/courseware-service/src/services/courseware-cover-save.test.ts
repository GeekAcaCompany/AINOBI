// SPDX-License-Identifier: AGPL-3.0-only
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { coverUrlForSave } from "./courseware-service.ts";

const envSnapshot = { ...process.env };

afterEach(() => {
  process.env = { ...envSnapshot };
});

describe("coverUrlForSave — cover ownership validation (Codex P0, signing oracle)", () => {
  it("adopts the bare key for the owning (org, courseware) pair", () => {
    process.env.OSS_BUCKET = "example-storage";
    process.env.OSS_ENDPOINT = "https://oss-cn-shenzhen.aliyuncs.com";

    const url =
      "https://example-storage.oss-cn-shenzhen.aliyuncs.com/courseware_covers/org-1/course-1/cover.png?OSSAccessKeyId=LTAI&Expires=1&Signature=x";
    assert.equal(
      coverUrlForSave(url, "org-1", "course-1", undefined, false, false),
      "courseware_covers/org-1/course-1/cover.png",
    );
  });

  it("rejects a same-org cover owned by a DIFFERENT courseware (round-7 P0)", () => {
    process.env.OSS_BUCKET = "example-storage";
    process.env.OSS_ENDPOINT = "https://oss-cn-shenzhen.aliyuncs.com";

    // An org-only check let is_public coursewares sign another courseware's
    // cover inside the same org — the full (org, courseware) prefix is required.
    const url =
      "https://example-storage.oss-cn-shenzhen.aliyuncs.com/courseware_covers/org-1/course-42/secret-cover.png?OSSAccessKeyId=LTAI&Expires=1&Signature=x";
    assert.throws(() => coverUrlForSave(url, "org-1", "course-1", undefined, false, false), /courseware_covers/);
  });

  it("rejects a courseware_covers key owned by another organization", () => {
    process.env.OSS_BUCKET = "example-storage";
    process.env.OSS_ENDPOINT = "https://oss-cn-shenzhen.aliyuncs.com";

    const url =
      "https://example-storage.oss-cn-shenzhen.aliyuncs.com/courseware_covers/org-999/course-42/secret-cover.png?OSSAccessKeyId=LTAI&Expires=1&Signature=x";
    assert.throws(() => coverUrlForSave(url, "org-1", "course-1", undefined, false, false), /courseware_covers/);
  });

  it("accepts a cover under the business-key namespace when uniqueness is verified (cover-http uploads by client-sent id-or-key)", () => {
    process.env.OSS_BUCKET = "example-storage";
    process.env.OSS_ENDPOINT = "https://oss-cn-shenzhen.aliyuncs.com";

    // Editors upload covers with coursewareId = the business key; the row's PK id is
    // a separate uuid. A save echoing the GET coverUrl must not be rejected
    // just because the object sits under the key namespace instead of the id.
    const url =
      "https://example-storage.oss-cn-shenzhen.aliyuncs.com/courseware_covers/org-1/cw-key-1/22eeb5f85bf43d263b604049470faf88.png?OSSAccessKeyId=LTAI&Expires=1&Signature=x";
    assert.equal(
      coverUrlForSave(url, "org-1", "cw-row-1", "cw-key-1", true, false),
      "courseware_covers/org-1/cw-key-1/22eeb5f85bf43d263b604049470faf88.png",
    );
    // Row-id namespace keeps working with or without the alias verdict.
    assert.equal(
      coverUrlForSave(
        "courseware_covers/org-1/cw-row-1/22eeb5f85bf43d263b604049470faf88.png",
        "org-1",
        "cw-row-1",
        "cw-key-1",
        false,
        false,
      ),
      "courseware_covers/org-1/cw-row-1/22eeb5f85bf43d263b604049470faf88.png",
    );
  });

  it("rejects the key namespace when uniqueness is NOT verified (case-colliding sibling shares lower(key) — Codex P0)", () => {
    // The physical object path is lower(key) (coursewareCoverObjectKey
    // casefolds before building the key) while the key unique index is
    // case-sensitive: rows "ABC-1" and "abc-1" in one org SHARE one physical
    // namespace. Without the uniqueness verdict, either row could claim the
    // alias and sign/refund/delete the sibling's cover.
    assert.throws(
      () =>
        coverUrlForSave(
          "courseware_covers/org-1/cw-key-1/22eeb5f85bf43d263b604049470faf88.png",
          "org-1",
          "cw-row-1",
          "cw-key-1",
          false,
          false,
        ),
      /courseware_covers/,
    );
  });

  it("rejects the row-ID namespace when a sibling's business key folds onto it (mirror collision — Codex P0)", () => {
    // Legacy rows where one row's key equals another row's uuid: the ID
    // prefix is physically shared, so the ID-owning row must not claim it
    // either (rowIdContested=true) — otherwise it could adopt, sign, refund
    // or delete the key-owning row's historical cover.
    assert.throws(
      () =>
        coverUrlForSave(
          "courseware_covers/org-1/cw-row-1/22eeb5f85bf43d263b604049470faf88.png",
          "org-1",
          "cw-row-1",
          "cw-key-1",
          true,
          true,
        ),
      /courseware_covers/,
    );
  });

  it("still rejects another courseware's key namespace even with the key alias", () => {
    assert.throws(
      () =>
        coverUrlForSave(
          "courseware_covers/org-1/cw-key-42/secret-cover.png",
          "org-1",
          "cw-row-1",
          "cw-key-1",
          true,
          false,
        ),
      /courseware_covers/,
    );
  });

  it("rejects any cover key on CREATE (no coursewareId yet — covers attach after creation)", () => {
    assert.throws(
      () => coverUrlForSave("courseware_covers/org-1/course-1/cover.png", "org-1", undefined, undefined, false, false),
      /courseware_covers/,
    );
  });

  it("rejects a bare foreign cover key even without a URL wrapper", () => {
    assert.throws(
      () => coverUrlForSave("courseware_covers/other-org/course-1/cover.png", "org-1", "course-1", undefined, false, false),
      /courseware_covers/,
    );
  });

  it("keeps non-storage (external) URLs on the normalization path", () => {
    process.env.OSS_BUCKET = "example-storage";
    process.env.OSS_ENDPOINT = "https://oss-cn-shenzhen.aliyuncs.com";

    // External URLs are outside courseware storage entirely — they pass
    // through the plain persistence normalization verbatim (slash collapse
    // only; query strings are the external site's own concern).
    const url = "https://cdn.example.com/images//cover.png?token=abc";
    const out = coverUrlForSave(url, "org-1", "course-1", undefined, false, false);
    assert.equal(out, "https://cdn.example.com/images/cover.png?token=abc");
  });

  it("normalizes non-cover storage references to the bare key (no cover anchor)", () => {
    // Non-courseware_covers storage references are not cover objects — the
    // cover oracle does not apply (the response refresher only signs keys
    // anchored on courseware_covers/), so the plain normalization runs.
    process.env.OSS_BUCKET = "example-storage";
    process.env.OSS_ENDPOINT = "https://oss-cn-shenzhen.aliyuncs.com";
    delete process.env.COURSEWARE_HTML_ASSET_BASE_URL;

    const url =
      "https://example-storage.oss-cn-shenzhen.aliyuncs.com/courseware_assets/org-1/a.png?OSSAccessKeyId=LTAI&Expires=1&Signature=x";
    assert.equal(coverUrlForSave(url, "org-1", "course-1", undefined, false, false), "courseware_assets/org-1/a.png");
  });
});
