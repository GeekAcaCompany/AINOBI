// SPDX-License-Identifier: AGPL-3.0-only
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  buildReferenceSceneBrief,
} from "@ainobi/courseware-core/reference-scene-brief.ts";
import type { AinobiAuthorizedSession } from "../auth/ainobi-user-session.ts";
import { writeSceneJsonToAgentWorkspace } from "./courseware-cli-preload.ts";
import { assertCoursewareRequestAccess } from "./courseware-org-guard.ts";
import { getCoursewareEntityById } from "./courseware-service.ts";

export type ReferencedCoursewareInput = {
  id: string;
  key: string;
  title: string;
  courseId?: string;
  courseTitle?: string;
};

export type StagedReferencedCourseware = {
  id: string;
  key: string;
  title: string;
  sceneRelPath: string;
  briefRelPath: string;
  slideCount: number;
  slideSummaryLines: string[];
};

/** File name of a staged reference courseware: `{title slug}-{first 8 characters of the key}.scene.json` */
export function referenceSceneBasename(title: string, key: string): string {
  const slug =
    title
      .trim()
      .slice(0, 48)
      .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "courseware";
  const keyShort = key.replace(/-/g, "").slice(0, 8);
  return `${slug}-${keyShort}`;
}

export function summarizeReferencedSceneSlides(content: Record<string, unknown>): {
  slideCount: number;
  lines: string[];
} {
  const brief = buildReferenceSceneBrief(content);
  const lines: string[] = [];
  for (const slide of brief.slides) {
    const idPart = slide.element_id ? ` (${slide.element_id})` : "";
    const bgPart = slide.background_color ? `, bg ${slide.background_color}` : "";
    lines.push(
      `  [${slide.index}] ${slide.name}${idPart} — ${slide.children_count} top-level element(s)${bgPart}`,
    );
  }
  return { slideCount: brief.slide_count, lines };
}

function writeReferenceBriefToAgentWorkspace(params: {
  briefPath: string;
  content: Record<string, unknown>;
}): void {
  const brief = buildReferenceSceneBrief(params.content);
  mkdirSync(dirname(params.briefPath), { recursive: true });
  writeFileSync(params.briefPath, `${JSON.stringify(brief, null, 2)}\n`, "utf8");
}

function isSameAsEditingCourseware(
  ref: ReferencedCoursewareInput,
  editingCoursewareKey?: string | null,
  editingCoursewareId?: string | null,
): boolean {
  const refKey = ref.key?.trim();
  const refId = ref.id?.trim();
  const editKey = editingCoursewareKey?.trim();
  const editId = editingCoursewareId?.trim();
  if (refKey && editKey && refKey === editKey) return true;
  if (refId && editId && refId === editId) return true;
  return false;
}

/**
 * Fetch the reference coursewares the user @-mentioned from the DB and write them into the agent workspace:
 * - `./reference/*.scene.json` (pretty Scene JSON, without `ainobi load`)
 * - `./reference/*.brief.json` (layout/text summary, for Read or `ainobi reference inspect`)
 */
export async function stageReferencedCoursewareForAgent(params: {
  workspaceDir: string;
  refs: readonly ReferencedCoursewareInput[];
  session: AinobiAuthorizedSession | null | undefined;
  editingCoursewareKey?: string | null;
  editingCoursewareId?: string | null;
}): Promise<{ editorContextSection: string; staged: StagedReferencedCourseware[] }> {
  const seen = new Set<string>();
  const staged: StagedReferencedCourseware[] = [];
  const failures: string[] = [];

  for (const ref of params.refs) {
    const key = ref.key?.trim();
    if (!key || seen.has(key)) continue;
    if (isSameAsEditingCourseware(ref, params.editingCoursewareKey, params.editingCoursewareId)) {
      continue;
    }
    seen.add(key);

    const lookup = ref.id?.trim() || key;
    const cw = await getCoursewareEntityById(lookup);
    if (!cw) {
      failures.push(`${ref.title?.trim() || key}: courseware not found`);
      continue;
    }
    if (params.session) {
      try {
        await assertCoursewareRequestAccess(params.session, cw, "read");
      } catch {
        failures.push(`${ref.title?.trim() || key}: access denied`);
        continue;
      }
    }

    const title = ref.title?.trim() || cw.title?.trim() || cw.key;
    const basename = referenceSceneBasename(title, cw.key);
    const sceneRelPath = `reference/${basename}.scene.json`;
    const briefRelPath = `reference/${basename}.brief.json`;
    const scenePath = resolve(params.workspaceDir, sceneRelPath);
    const briefPath = resolve(params.workspaceDir, briefRelPath);
    writeSceneJsonToAgentWorkspace({ scenePath, content: cw.content, pretty: true });
    writeReferenceBriefToAgentWorkspace({ briefPath, content: cw.content });
    const { slideCount, lines } = summarizeReferencedSceneSlides(cw.content);
    staged.push({
      id: cw.id,
      key: cw.key,
      title,
      sceneRelPath,
      briefRelPath,
      slideCount,
      slideSummaryLines: lines,
    });
  }

  if (staged.length === 0 && failures.length === 0) {
    return { editorContextSection: "", staged: [] };
  }

  const out: string[] = ["[User @ Referenced Courseware Library]"];
  if (staged.length > 0) {
    out.push(
      "Read-only reference decks staged by the host. Do NOT run `ainobi load` or `ainobi init` for these — the editor session already has the user's courseware preloaded.",
      "Inspect layout/style with `ainobi reference inspect ./<brief.json>` for a quick overview. For fine-grained read-only inspection on the staged `.scene.json`, use `ainobi reference slide list|get` and `reference element list|get`. To copy pages into the CURRENT editing session: `ainobi reference import ./<scene.json> --slides all` or `--slides 0,2-4` (optional `--at N`). Do not `ainobi load` references or paste full scene JSON by hand.",
    );
    for (const item of staged) {
      const courseLabel = refCourseLabel(params.refs, item.key);
      out.push(
        `- ${item.title}${courseLabel} | courseware_id: ${item.id} | key: ${item.key} | brief: ./${item.briefRelPath} | scene: ./${item.sceneRelPath} | ${item.slideCount} slide(s)`,
      );
      if (item.slideSummaryLines.length > 0) {
        out.push(...item.slideSummaryLines);
      }
    }
  }
  if (failures.length > 0) {
    out.push("", "[Reference staging skipped]");
    for (const failure of failures) {
      out.push(`- ${failure}`);
    }
  }

  return { editorContextSection: out.join("\n"), staged };
}

function refCourseLabel(
  refs: readonly ReferencedCoursewareInput[],
  key: string,
): string {
  const ref = refs.find((item) => item.key?.trim() === key);
  const courseTitle = ref?.courseTitle?.trim();
  if (courseTitle) return ` | course: ${courseTitle}`;
  const courseId = ref?.courseId?.trim();
  if (courseId) return ` | course_id: ${courseId}`;
  return "";
}
