// SPDX-License-Identifier: AGPL-3.0-only
import { AinobiCliError } from "./errors.ts";
import { CONTENT_LANGUAGES, isContentLanguage, SCENE_LANGUAGE_METADATA_KEY } from "@ainobi/courseware-core/content-language.ts";

const ELEMENT_ID_HINT = "element_id is generated automatically; never specify it externally.";

const hintForForbiddenKey = (key: string): string | undefined => {
  if (key === "element_id") return ELEMENT_ID_HINT;
  if (key === "children_elements") {
    return "Slides and elements cannot accept children via update/insert payloads. Use `element insert` (and dedicated tooling for group/html children).";
  }
  if (key === "scene_id") {
    return "scene_id is immutable after init/load.";
  }
  if (key === "slide_elements" || key === "vtuber_elements" || key === "audio_elements" || key === "quiz") {
    return "Manage slides, vtuber tracks, audio, and quiz through their dedicated commands.";
  }
  return undefined;
};

/** Reject externally supplied identity / structural fields in patch payloads (batch + operations). */
export const rejectForbiddenPatchKeys = (
  patch: Record<string, unknown>,
  forbidden: ReadonlySet<string>,
  label: string,
): void => {
  for (const key of Object.keys(patch)) {
    if (!forbidden.has(key)) continue;
    throw new AinobiCliError("INVALID_INPUT", `${label} must not contain "${key}".`, {
      hint: hintForForbiddenKey(key),
    });
  }
};

/**
 * `metadata.language` is the courseware content language the CLI bakes learner-visible
 * copy in; only zh / en / ja are accepted (scene update + batch scene.update).
 */
export const rejectInvalidContentLanguagePatch = (patch: Record<string, unknown>, label: string): void => {
  const metadata = patch.metadata;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return;
  if (!(SCENE_LANGUAGE_METADATA_KEY in metadata)) return;
  const value = (metadata as Record<string, unknown>)[SCENE_LANGUAGE_METADATA_KEY];
  if (isContentLanguage(value)) return;
  throw new AinobiCliError(
    "INVALID_INPUT",
    `${label}.metadata.language must be one of ${CONTENT_LANGUAGES.join(" / ")}; got ${JSON.stringify(value)}.`,
  );
};

export const SLIDE_PATCH_FORBIDDEN = new Set(["element_id", "children_elements"]);
export const ELEMENT_PATCH_FORBIDDEN = new Set(["element_id", "children_elements"]);
export const SCENE_PATCH_FORBIDDEN = new Set([
  "scene_id",
  "slide_elements",
  "vtuber_elements",
  "audio_elements",
  "quiz",
]);
