// SPDX-License-Identifier: AGPL-3.0-only
import { extname } from "node:path";

import { normalizeAssetExtension } from "@ainobi/courseware-cli/cli/asset-extension.ts";
import {
  collectDocumentSlideImages,
  isDocumentVisionExtension,
} from "@ainobi/courseware-cli/cli/design-template-document-slides.ts";
import {
  extractContentTemplateMarkdownFromDocumentSlides,
  extractContentTemplateMarkdownFromImage,
  extractContentTemplateMarkdownFromSource,
} from "@ainobi/courseware-cli/cli/content-template-extract.ts";
import { imageMimeFromExtension } from "@ainobi/courseware-cli/cli/image-replicate-html.ts";
import {
  convertBufferToMarkdown,
} from "@ainobi/courseware-cli/cli/markitdown-convert.ts";
import {
  isDocReadImageExtension,
  normalizeDocReadExtension,
} from "@ainobi/courseware-cli/cli/doc-extensions.ts";
import type { AinobiAuthorizedSession } from "../auth/ainobi-user-session.ts";
import { actorFromSession } from "../auth/ainobi-org-access.ts";
import { readCoursewareAssetBytes } from "./courseware-asset-read-bytes.ts";
import { convertUploadedDocumentAsset } from "./courseware-document-conversion.ts";
import { findCoursewareAssetByFileIdOnly } from "./courseware-assets-service.ts";
import {
  assertOrgIdManageAccess,
  createContentTemplate,
  type ContentTemplateDto,
} from "./courseware-content-templates-service.ts";
import {
  assertCoursewareRequestAccess,
  loadCoursewareByIdWithRequestAccess,
} from "./courseware-org-guard.ts";
import { getCoursewareEntityById } from "./courseware-service.ts";
import { buildReferenceSceneBrief } from "@ainobi/courseware-core/reference-scene-brief.ts";
import {
  normalizeTemplateExtractLanguage,
  type TemplateExtractLanguage,
} from "@ainobi/courseware-cli/cli/template-extract-language.ts";
import { dataSource } from "../db/db.ts";
import {
  CoursewareAsset,
  type CoursewareAssetFileArtifactMetadata,
} from "../models/courseware-assets.ts";
import type { IncomingMessage } from "node:http";

const ASSET_READ_MAX_BYTES = 20 * 1024 * 1024;

export type ExtractContentTemplateResult = {
  template: ContentTemplateDto;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

export type ExtractContentTemplateInput = {
  orgId: string;
  name: string;
  sourceType: "courseware" | "asset";
  coursewareId?: string;
  assetId?: string;
  description?: string | null;
  language?: TemplateExtractLanguage;
};

async function ensureAssetDocumentArtifact(
  asset: CoursewareAsset,
): Promise<{
  artifactBaseUrl: string;
  slideCount: number;
  kind: "pdf" | "pptx";
}> {
  const ext = normalizeAssetExtension(extname(asset.fileName));
  if (ext !== ".pdf" && ext !== ".pptx") {
    throw new Error("Only PDF/PPTX assets support document vision extraction.");
  }
  const kind = ext === ".pdf" ? "pdf" : "pptx";

  let artifactBaseUrl = asset.fileArtifactUrl?.trim() ?? "";
  let slideCount = asset.fileArtifactMetadata?.slide_count ?? 0;

  if (!artifactBaseUrl || slideCount <= 0) {
    const converted = await convertUploadedDocumentAsset(asset.contentMd5, ext);
    artifactBaseUrl = converted.artifact_src.trim();
    slideCount = converted.slide_count;
    const metadata: CoursewareAssetFileArtifactMetadata = {
      slide_count: slideCount,
      kind,
      conversion: converted.conversion,
    };
    asset.fileArtifactUrl = artifactBaseUrl.slice(0, 2048);
    asset.fileArtifactMetadata = metadata;
    await dataSource.getRepository(CoursewareAsset).save(asset);
  }

  if (!artifactBaseUrl || slideCount <= 0) {
    throw new Error("Document conversion produced no slide artifacts.");
  }

  return { artifactBaseUrl, slideCount, kind };
}

async function resolveCoursewareContent(
  req: IncomingMessage,
  session: AinobiAuthorizedSession,
  coursewareId: string,
): Promise<Record<string, unknown>> {
  const { courseware } = await loadCoursewareByIdWithRequestAccess(req, coursewareId, "read");
  await assertCoursewareRequestAccess(session, courseware, "read");
  return courseware.content;
}

export async function runContentTemplateExtract(
  req: IncomingMessage,
  session: AinobiAuthorizedSession,
  input: ExtractContentTemplateInput,
): Promise<ExtractContentTemplateResult> {
  const orgId = input.orgId.trim();
  await assertOrgIdManageAccess(session, orgId);
  const name = input.name.trim();
  if (!name) {
    throw new Error("Template name is required.");
  }

  const actor = actorFromSession(session);
  const language = normalizeTemplateExtractLanguage(input.language);
  let markdown = "";
  let model = "";
  let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let sourceMeta: Record<string, unknown> = {
    extractedAt: new Date().toISOString(),
    outputLanguage: language,
  };

  if (input.sourceType === "courseware") {
    const coursewareId = input.coursewareId?.trim();
    if (!coursewareId) {
      throw new Error("coursewareId is required for courseware extraction.");
    }
    const content = await resolveCoursewareContent(req, session, coursewareId);
    // Content templates need lesson copy / outline signals — not styleOnly.
    const brief = buildReferenceSceneBrief(content);
    const cw = await getCoursewareEntityById(coursewareId);
    sourceMeta = {
      ...sourceMeta,
      coursewareId,
      coursewareKey: cw?.key ?? null,
      coursewareTitle: cw?.title ?? null,
    };
    const extracted = await extractContentTemplateMarkdownFromSource({
      name,
      sourceKind: "courseware",
      sourcePayload: JSON.stringify(brief, null, 2),
      language,
    });
    markdown = extracted.markdown;
    model = extracted.model;
    usage = extracted.usage;
  } else if (input.sourceType === "asset") {
    const assetId = input.assetId?.trim();
    if (!assetId) {
      throw new Error("assetId is required for asset extraction.");
    }
    const asset = await findCoursewareAssetByFileIdOnly(assetId);
    if (!asset) {
      throw new Error("Asset not found.");
    }
    if (asset.orgId?.trim() && asset.orgId.trim() !== orgId) {
      throw new Error("Asset does not belong to this organization.");
    }
    const ext = normalizeDocReadExtension(extname(asset.fileName) || asset.contentType);
    sourceMeta = {
      ...sourceMeta,
      assetId,
      fileName: asset.fileName,
      extension: ext,
      coursewareId: asset.coursewareId,
    };

    if (asset.markdownContent?.trim()) {
      const extracted = await extractContentTemplateMarkdownFromSource({
        name,
        sourceKind: "asset_doc",
        sourcePayload: asset.markdownContent.trim(),
        language,
      });
      markdown = extracted.markdown;
      model = extracted.model;
      usage = extracted.usage;
    } else if (isDocumentVisionExtension(ext)) {
      const { artifactBaseUrl, slideCount, kind } = await ensureAssetDocumentArtifact(asset);
      const rawDocumentBuffer = await readCoursewareAssetBytes(asset.filePath, ASSET_READ_MAX_BYTES);
      const slideImages = await collectDocumentSlideImages({
        kind,
        artifactBaseUrl,
        slideCount,
        rawDocumentBuffer,
      });
      if (slideImages.length === 0) {
        throw new Error(
          "Could not collect slide images from the document. Ensure pdf2html/pptx2html conversion completed.",
        );
      }
      const extracted = await extractContentTemplateMarkdownFromDocumentSlides({
        name,
        slides: slideImages.map((img) => ({
          buffer: img.buffer,
          mimeType: img.mimeType,
          label: img.label,
        })),
        language,
      });
      markdown = extracted.markdown;
      model = extracted.model;
      usage = extracted.usage;
      sourceMeta = {
        ...sourceMeta,
        extractionMode: "document_vision",
        slideCount,
        slidesAnalyzed: slideImages.map((img) => img.label),
        artifactBaseUrl,
      };
    } else if (isDocReadImageExtension(ext)) {
      const buffer = await readCoursewareAssetBytes(asset.filePath, ASSET_READ_MAX_BYTES);
      const mimeType = imageMimeFromExtension(ext);
      if (!mimeType) {
        throw new Error(`Unsupported image extension "${ext}".`);
      }
      const converted = await convertBufferToMarkdown(buffer, {
        file_extension: ext,
        use_llm_for_images: true,
      });
      const extracted = await extractContentTemplateMarkdownFromImage({
        name,
        buffer,
        mimeType,
        imageAnalysis: converted.markdown,
        language,
      });
      markdown = extracted.markdown;
      model = extracted.model;
      usage = extracted.usage;
      sourceMeta = { ...sourceMeta, extractionMode: "image_vision" };
    } else {
      const buffer = await readCoursewareAssetBytes(asset.filePath, ASSET_READ_MAX_BYTES);
      const converted = await convertBufferToMarkdown(buffer, {
        file_extension: ext,
        use_llm_for_images: true,
      });
      const extracted = await extractContentTemplateMarkdownFromSource({
        name,
        sourceKind: "asset_doc",
        sourcePayload: converted.markdown,
        language,
      });
      markdown = extracted.markdown;
      model = extracted.model;
      usage = extracted.usage;
      sourceMeta = { ...sourceMeta, extractionMode: "asset_doc_text" };
    }
  } else {
    throw new Error("Invalid sourceType.");
  }

  const template = await createContentTemplate({
    orgId,
    name,
    content: markdown,
    description: input.description ?? null,
    sourceType: "extracted",
    sourceMeta,
    createdBy: actor.userId,
  });
  return { template, model, usage };
}
