// SPDX-License-Identifier: AGPL-3.0-only
import {
  extractCoursewareAssetFilePath,
  stripCoursewareAssetSignatureFromUrl,
} from "../../api/courseware.ts";

/**
 * Asset reference rewriting of HTML slides (embedded via srcdoc).
 *
 * Background: slide HTML is produced by pdf/pptx conversion and references images and other assets by relative paths (`assets/…`) or old
 * absolute URLs (the aliyun public bucket). After example-public went private, relative paths land on
 * `raw/html/assets/…` and always 404 without a signature (404+nosniff then blocked by ORB as
 * net::ERR_BLOCKED_BY_ORB); aliyun is retired infrastructure and shouldn't be relied on any more.
 *
 * Handling: before embedding, normalize every src/href/poster/url() reference into a storage key, presign in bulk,
 * and rewrite to absolute signed URLs. References to objects that don't exist stay as-is (hidden by the onerror fallback).
 */

const ATTR_REF_RE = /(\s(?:src|href|poster|data-src)\s*=\s*)("([^"]*)"|'([^']*)')/gi;
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

export function collectHtmlAssetRefs(html: string): string[] {
  const refs = new Set<string>();
  for (const m of html.matchAll(ATTR_REF_RE)) {
    const v = (m[3] ?? m[4] ?? "").trim();
    if (v) refs.add(v);
  }
  for (const m of html.matchAll(CSS_URL_RE)) {
    const v = (m[2] ?? "").trim();
    if (v && !v.startsWith("data:")) refs.add(v);
  }
  return [...refs];
}

const isNonAssetRef = (raw: string): boolean =>
  !raw ||
  raw.startsWith("data:") ||
  raw.startsWith("#") ||
  raw.startsWith("javascript:") ||
  raw.startsWith("blob:") ||
  raw.startsWith("mailto:") ||
  /^about:/i.test(raw);

/**
 * Reference → storage key.
 * - absolute URLs (our own storage forms such as OCI/aliyun) → extractCoursewareAssetFilePath extracts the key;
 * - relative paths → resolved against the html's own key directory (`assets/a.png` @ `raw/html/x.html`
 *   → `raw/html/assets/a.png`, the same semantics as browser <base> resolution);
 * - external URLs (third-party CDNs) and anything that can't be normalized → null (kept as-is).
 */
export function resolveHtmlRefToKey(ref: string, htmlKey: string | null): string | null {
  const raw = ref.trim().replace(/^["']|["']$/g, "");
  if (isNonAssetRef(raw)) return null;
  if (/^https?:\/\//i.test(raw) || /^(\/\/)/.test(raw)) {
    return extractCoursewareAssetFilePath(stripCoursewareAssetSignatureFromUrl(raw));
  }
  if (!htmlKey) return null;
  const baseDir = htmlKey.slice(0, htmlKey.lastIndexOf("/") + 1);
  const joined = raw.startsWith("/") ? raw.slice(1) : baseDir + raw;
  const stack: string[] = [];
  for (const part of joined.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  const key = stack.join("/");
  return key || null;
}

/** Rewrite the reference occurrences in the html in a single pass; references without a signature mapping stay as-is. */
export function rewriteHtmlWithSignedRefs(
  html: string,
  lookup: (ref: string) => string | undefined,
): string {
  const byAttr = (ref: string): string | undefined =>
    lookup(ref) ?? lookup(ref.replace(/&amp;/g, "&"));
  let out = html.replace(ATTR_REF_RE, (full, lead: string, _q: string, dq?: string, sq?: string) => {
    const v = dq ?? sq ?? "";
    if (!v) return full;
    const signed = byAttr(v);
    return signed ? `${lead}"${signed}"` : full;
  });
  out = out.replace(CSS_URL_RE, (full, q: string, v: string) => {
    const signed = byAttr(v);
    return signed ? `url(${q}${signed}${q})` : full;
  });
  return out;
}

export interface HtmlAssetRewriteOptions {
  coursewareId?: string | null;
  presign: (keys: string[]) => Promise<Record<string, string>>;
}

/**
 * Orchestrator: collect → normalize keys → bulk presign → rewrite.
 * Any failing step returns the original (embedding must not fail to render because rewriting failed).
 */
export async function rewriteHtmlSlideAssets(
  html: string,
  sourceUrl: string | null,
  options: HtmlAssetRewriteOptions,
): Promise<string> {
  try {
    const coursewareId = options.coursewareId?.trim();
    if (!coursewareId) return html;
    const htmlKey = sourceUrl
      ? extractCoursewareAssetFilePath(stripCoursewareAssetSignatureFromUrl(sourceUrl.trim()))
      : null;
    const refs = collectHtmlAssetRefs(html);
    if (refs.length === 0) return html;

    const keyByRef = new Map<string, string>();
    const keys = new Set<string>();
    for (const ref of refs) {
      const key = resolveHtmlRefToKey(ref, htmlKey);
      if (!key) continue;
      keyByRef.set(ref, key);
      keys.add(key);
    }
    if (keys.size === 0) return html;

    const signed = await options.presign([...keys]);
    if (Object.keys(signed).length === 0) return html;

    const lookup = (ref: string): string | undefined => {
      const key = keyByRef.get(ref);
      if (!key) return undefined;
      return signed[key] ?? undefined;
    };
    return rewriteHtmlWithSignedRefs(html, lookup);
  } catch {
    return html;
  }
}
