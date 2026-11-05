// SPDX-License-Identifier: AGPL-3.0-only
import { normalizeAssetExtension } from "@ainobi/courseware-cli/cli/asset-extension.ts";
import { coursewareHtmlAssetBaseUrl } from "@ainobi/courseware-cli/cli/url-policy.ts";

export interface DocumentConversionResult {
  artifact_src: string;
  slide_count: number;
  conversion: Record<string, unknown>;
}

const artifactBaseObjectKey = (kind: "pdf" | "pptx", fileId: string): string =>
  `artifact/${kind}/${fileId}`;

const publicArtifactUrl = (objectKey: string): string => {
  const base = coursewareHtmlAssetBaseUrl();
  return `${base}/${objectKey}`;
};

const conversionServiceUrl = (kind: "pdf" | "pptx"): URL => {
  const base =
    kind === "pdf"
      ? process.env.PDF2HTML_SERVICE_URL || process.env.PDF2HTML_URL || "http://localhost:3020"
      : process.env.PPTX2HTML_SERVICE_URL || process.env.PPTX2HTML_URL || "http://localhost:3010";
  const path =
    kind === "pdf"
      ? process.env.PDF2HTML_ENDPOINT || "/api/pdf2html"
      : process.env.PPTX2HTML_ENDPOINT || "/api/pptx2html";
  return new URL(path, base.endsWith("/") ? base : `${base}/`);
};

const postConversion = async (kind: "pdf" | "pptx", fileId: string): Promise<Record<string, unknown>> => {
  const url = conversionServiceUrl(kind);
  const body = new URLSearchParams();
  body.set(kind === "pdf" ? "pdfId" : "pptx_id", fileId);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (error) {
    const envKey = kind === "pdf" ? "PDF2HTML_SERVICE_URL" : "PPTX2HTML_SERVICE_URL";
    const serviceName = kind === "pdf" ? "ainobi-pdf2html-service" : "ainobi-pptx2html-service";
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? error.cause.message
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(
      `${kind}2html service unreachable at ${url.href} (${cause}). Start ${serviceName} or set ${envKey}.`,
      { cause: error instanceof Error ? error : undefined },
    );
  }
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!response.ok) {
    const message =
      typeof parsed === "object" && parsed !== null && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : text;
    throw new Error(`${kind}2html service failed: ${message}`);
  }
  return (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
};

/**
 * Trigger pdf2html / pptx2html for a PDF/PPTX already uploaded to OSS (`fileId` is a 32-character MD5 hex).
 * Called only in the AINOBI host process; never run inside the agent sandbox (to avoid leaking the conversion service URLs).
 */
export async function convertUploadedDocumentAsset(
  fileIdMd5Hex: string,
  extension: string,
): Promise<DocumentConversionResult> {
  const normalized = normalizeAssetExtension(extension);
  if (normalized !== ".pdf" && normalized !== ".pptx") {
    throw new Error("Only .pdf and .pptx assets can be converted to embedded PPT sources.");
  }

  const kind = normalized === ".pdf" ? "pdf" : "pptx";
  const fileId = fileIdMd5Hex.trim().toLowerCase();
  if (fileId.length !== 32 || !/^[0-9a-f]{32}$/.test(fileId)) {
    throw new Error("Invalid MD5 digest for document conversion.");
  }

  const conversion = await postConversion(kind, fileId);
  const slideCount = Number(conversion.slide_count ?? conversion.slideCount ?? 0);
  const artifactSrc = publicArtifactUrl(artifactBaseObjectKey(kind, fileId));

  return {
    artifact_src: artifactSrc,
    slide_count: Number.isFinite(slideCount) ? slideCount : 0,
    conversion,
  };
}
