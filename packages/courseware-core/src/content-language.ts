// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Courseware content language — the language the CLI writes newly generated
 * on-slide copy in (default quiz labels, placeholder titles, …).
 *
 * The value lives in `scene.metadata.language` and is set explicitly at creation
 * (`ainobi init --language`, MCP `courseware_create`) after the agent confirms it
 * with the user. There is intentionally NO default: builders take the language as
 * a required argument and callers must resolve it from the scene first.
 *
 * Same key as the console / student editor (`SCENE_LANGUAGE_METADATA_KEY`).
 */

/** Supported courseware content languages (platform scope: zh / en / ja only). */
export const CONTENT_LANGUAGES = ["zh", "en", "ja"] as const;

export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number];

/** `scene.metadata` key holding the content language; shared with the console / student editor. */
export const SCENE_LANGUAGE_METADATA_KEY = "language";

/** Exact-match guard for `ContentLanguage` (case-sensitive; no locale normalization). */
export const isContentLanguage = (value: unknown): value is ContentLanguage =>
  typeof value === "string" && (CONTENT_LANGUAGES as readonly string[]).includes(value);

/** Read `scene.metadata.language`; `null` when missing or not a supported code. Never mutates. */
export const readSceneContentLanguage = (
  scene: { metadata?: unknown } | Record<string, unknown>,
): ContentLanguage | null => {
  const metadata = (scene as { metadata?: unknown }).metadata;
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return null;
  const raw = (metadata as Record<string, unknown>)[SCENE_LANGUAGE_METADATA_KEY];
  return isContentLanguage(raw) ? raw : null;
};
