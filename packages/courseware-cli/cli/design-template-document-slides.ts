// SPDX-License-Identifier: AGPL-3.0-only
import { buildPptSlideHtmlUrl } from "@ainobi/courseware-core/elements.ts";
import { cliEnv } from "./env.ts";
import { normalizeDocReadExtension } from "./doc-extensions.ts";

export type DocumentSlideImage = {
  mimeType: string;
  buffer: Buffer;
  label: string;
  bytes: number;
};

const DATA_URL_IMAGE_RE =
  /data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)/gi;

const PPTX_MEDIA_IMAGE_RE = /^ppt\/media\/[^/]+\.(png|jpe?g|webp)$/i;

const DEFAULT_MAX_SLIDES = 3;

/** Representative slide numbers (first, middle, last; at most maxSlides). */
export function selectRepresentativeSlideNumbers(
  slideCount: number,
  maxSlides = DEFAULT_MAX_SLIDES,
): number[] {
  const total = Math.max(0, Math.floor(slideCount));
  if (total <= 0) return [];
  if (total <= maxSlides) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const mid = Math.max(1, Math.ceil(total / 2));
  const picks = [1, mid, total];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const n of picks) {
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= maxSlides) break;
  }
  return out.sort((a, b) => a - b);
}

export function isDocumentVisionExtension(extension: string): boolean {
  const ext = normalizeDocReadExtension(extension);
  return ext === ".pdf" || ext === ".pptx";
}

/** Extract data URL images from the HTML, largest first. */
export function extractEmbeddedImagesFromHtml(html: string): DocumentSlideImage[] {
  const out: DocumentSlideImage[] = [];
  const re = new RegExp(DATA_URL_IMAGE_RE.source, "gi");
  let index = 0;
  for (const match of html.matchAll(re)) {
    index += 1;
    const rawMime = (match[1] ?? "image/png").toLowerCase();
    const mimeType = rawMime === "image/jpg" ? "image/jpeg" : rawMime;
    const b64 = (match[2] ?? "").replace(/\s+/g, "");
    if (!b64) continue;
    try {
      const buffer = Buffer.from(b64, "base64");
      if (buffer.byteLength <= 0) continue;
      out.push({
        mimeType,
        buffer,
        label: `embedded-${index}`,
        bytes: buffer.byteLength,
      });
    } catch {
      // ignore invalid base64
    }
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}

export function pickBestSlideImage(images: readonly DocumentSlideImage[]): DocumentSlideImage | null {
  if (images.length === 0) return null;
  return images[0] ?? null;
}

export async function fetchSlideHtml(artifactBaseUrl: string, slideNumber: number): Promise<string> {
  const url = buildPptSlideHtmlUrl(artifactBaseUrl, slideNumber);
  if (!url) {
    throw new Error("Missing artifact base URL.");
  }
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Failed to fetch slide HTML (${response.status}): ${url}`);
  }
  return response.text();
}

/** Extract the raster images (ppt/media/*) from the PPTX zip. */
export async function extractImagesFromPptxBuffer(buffer: Buffer): Promise<DocumentSlideImage[]> {
  const { unzipBuffer } = await import("./minimal-unzip.ts");
  const entries = unzipBuffer(buffer);
  const out: DocumentSlideImage[] = [];
  for (const [path, data] of Object.entries(entries)) {
    if (!PPTX_MEDIA_IMAGE_RE.test(path)) continue;
    const ext = path.split(".").pop()?.toLowerCase() ?? "png";
    const mimeType =
      ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "webp"
          ? "image/webp"
          : "image/png";
    const imageBuffer = Buffer.from(data);
    if (imageBuffer.byteLength <= 0) continue;
    out.push({
      mimeType,
      buffer: imageBuffer,
      label: path.split("/").pop() ?? path,
      bytes: imageBuffer.byteLength,
    });
  }
  const thumb = entries["docProps/thumbnail.jpeg"];
  if (thumb && thumb.byteLength > 0) {
    out.push({
      mimeType: "image/jpeg",
      buffer: Buffer.from(thumb),
      label: "thumbnail",
      bytes: thumb.byteLength,
    });
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}

/** Render the PDF to PNG when poppler's `pdftoppm` is available. */
export async function renderPdfPagesToPng(
  pdfBuffer: Buffer,
  pageNumbers: readonly number[],
): Promise<DocumentSlideImage[]> {
  if (pageNumbers.length === 0) return [];
  const { mkdtemp, writeFile, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  const pdftoppm = cliEnv().PDFTOPPM_PATH?.trim() || "pdftoppm";
  const workDir = await mkdtemp(join(tmpdir(), "ainobi-dt-pdf-"));
  try {
    const pdfPath = join(workDir, "source.pdf");
    await writeFile(pdfPath, pdfBuffer);
    const out: DocumentSlideImage[] = [];
    for (const page of pageNumbers) {
      const prefix = join(workDir, `page-${page}`);
      try {
        await execFileAsync(
          pdftoppm,
          ["-png", "-f", String(page), "-l", String(page), "-r", "120", pdfPath, prefix],
          { timeout: 60_000 },
        );
      } catch {
        continue;
      }
      const pngPath = `${prefix}-${page}.png`;
      try {
        const png = await readFile(pngPath);
        if (png.byteLength > 0) {
          out.push({
            mimeType: "image/png",
            buffer: png,
            label: `slide-${page}`,
            bytes: png.byteLength,
          });
        }
      } catch {
        // try alternate naming pdf-1.png style
      }
    }
    return out;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** Collect slide image candidates for vision from the artifact HTML and (for PPTX) the images in the zip. */
export async function collectDocumentSlideImages(args: {
  kind: "pdf" | "pptx";
  artifactBaseUrl: string;
  slideCount: number;
  rawDocumentBuffer?: Buffer | null;
  maxSlides?: number;
}): Promise<DocumentSlideImage[]> {
  const maxSlides = args.maxSlides ?? DEFAULT_MAX_SLIDES;
  const slideNumbers = selectRepresentativeSlideNumbers(args.slideCount, maxSlides);
  const collected: DocumentSlideImage[] = [];
  const seenBytes = new Set<number>();

  for (const slideNumber of slideNumbers) {
    try {
      const html = await fetchSlideHtml(args.artifactBaseUrl, slideNumber);
      const embedded = extractEmbeddedImagesFromHtml(html);
      const best = pickBestSlideImage(embedded);
      if (best && !seenBytes.has(best.bytes)) {
        seenBytes.add(best.bytes);
        collected.push({
          ...best,
          label: `slide-${slideNumber}`,
        });
      }
    } catch {
      // Skip a slide that fails to load
    }
  }

  if (collected.length > 0) {
    return collected.slice(0, maxSlides);
  }

  if (args.kind === "pptx" && args.rawDocumentBuffer && args.rawDocumentBuffer.byteLength > 0) {
    const fromZip = await extractImagesFromPptxBuffer(args.rawDocumentBuffer);
    if (fromZip.length > 0) return fromZip.slice(0, maxSlides);
  }

  if (args.kind === "pdf" && args.rawDocumentBuffer && args.rawDocumentBuffer.byteLength > 0) {
    const rendered = await renderPdfPagesToPng(args.rawDocumentBuffer, slideNumbers);
    if (rendered.length > 0) return rendered.slice(0, maxSlides);
  }

  return collected;
}
