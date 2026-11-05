// SPDX-License-Identifier: AGPL-3.0-only
// Persistence-time asset URL policy: depends on the deployment's storage backend and
// hosts (url-policy reads the environment), so it lives here rather than in the
// runtime-neutral engine. The parsing helpers come from @ainobi/courseware-core.
import {
  collapseDuplicateUrlPathSlashes,
  extractSignableFilePathFromUrl,
  stripPresignQueryParams,
} from "@ainobi/courseware-core/asset-url-normalize.ts";
import { prepareSceneAssetUrlsForPersistence } from "@ainobi/courseware-core/presign-scene.ts";
import type { Scene } from "@ainobi/courseware-core/scene.ts";
import {
  htmlAssetCdnOrigin,
  isCoursewarePersistenceUrl,
  isOciS3StorageUrl,
  ossVirtualHostedAccessBaseUrl,
  publicUrlForCoursewareObjectKey,
  resolveCoursewareStorageBackend,
  rewriteSignedUrlForPublicPersistence,
} from "./url-policy.ts";

/**
 * Hosts whose signed URLs must collapse to the bare object key at persistence
 * time (the ACTIVE aliyun bucket is PRIVATE: a persisted signature expires and
 * the reference 403s forever), or null when the collapse must not fire.
 *
 * - The signer (assets.ts) always emits the PUBLIC host — browsers cannot
 *   reach `-internal` — so when OSS_ENDPOINT is the VPC-internal endpoint the
 *   persisted URL shows the public twin of `ossVirtualHostedAccessBaseUrl()`.
 *   Both forms must match (Codex P1: matching only the configured endpoint
 *   let signed URLs persist signature-stripped and unreadable).
 * - The HTML custom domain (COURSEWARE_HTML_ASSET_BASE_URL) fronts the same
 *   private bucket — signed URLs on it collapse too.
 * - Under `STORAGE_BACKEND=oci_s3` the collapse never fires: bare keys
 *   re-sign against the ACTIVE backend, so an aliyun URL collapsed to a bare
 *   key would misroute legacy aliyun-only objects to OCI and 404 (grayscale
 *   transition; Codex P1 — keep the host family instead).
 */
const activeAliyunPersistenceCollapseHosts = (): Set<string> | null => {
  if (resolveCoursewareStorageBackend() !== "aliyun_oss") return null;
  const activeBase = ossVirtualHostedAccessBaseUrl();
  if (!activeBase) return null;
  const hosts = new Set<string>();
  try {
    const parsed = new URL(activeBase);
    hosts.add(parsed.host);
    hosts.add(parsed.host.replace("-internal.", "."));
  } catch {
    /* ignore */
  }
  const htmlOrigin = htmlAssetCdnOrigin();
  if (htmlOrigin) {
    try {
      hosts.add(new URL(htmlOrigin).host);
    } catch {
      /* ignore */
    }
  }
  return hosts.size > 0 ? hosts : null;
};

/**
 * Normalize a courseware asset URL before persisting scene JSON:
 * canonical public host + unsigned object path (editor presigns again on load).
 *
 * ★OCI-stored objects persist as the **bare object key** (unified 2026-09-07, merged with the
 * `persistenceUrlForObjectKey` policy of assets.ts): the native
 * `objectstorage…oraclecloud.com` form previously stored in scenes is an anonymous 404, so any consumer that does not re-sign
 * (agent self-checks / direct static references) misjudges the object as missing — an agent once regenerated a whole batch of narration because of it
 * (the 2026-09-07 case: 15 voice-over lines re-synthesized for 0.6 credits). Reads of a bare key are dispatched by the presign machinery on the
 * key prefix: public/ → public bucket compat echo (anonymous + CORS), everything else → private bucket
 * presign (see publicBucketEchoUrlForCoursewarePresign in courseware-asset-presign.ts).
 * Legacy aliyun URLs are kept as-is (publicly readable, unambiguous; legacy content is left untouched).
 */
export const normalizeCoursewareAssetUrlForPersistence = (value: string): string => {
  const raw = value.trim();
  if (!raw) return raw;

  const objectKey = extractSignableFilePathFromUrl(raw);
  if (objectKey) {
    // A bare storage key passes through (idempotent) — it already is the unified persisted form and must never be
    // rewritten back into an aliyun URL by the fallback branch of isCoursewarePersistenceUrl (always true for non-URLs)
    // (otherwise one save round would pollute the unified form back into the old one).
    if (!/^https?:\/\//i.test(raw)) {
      return raw;
    }
    if (isOciS3StorageUrl(raw)) {
      return objectKey;
    }
    if (isCoursewarePersistenceUrl(raw)) {
      if (resolveCoursewareStorageBackend() === "oci_s3") {
        // Grayscale transition: bare keys re-sign against the ACTIVE backend
        // (oci_s3), so an aliyun-host URL must keep its host family —
        // collapsing it here would also rebuild via the aliyun-unaware
        // `publicUrlForCoursewareObjectKey` below. Origin+pathname strips the
        // expiring signature; key extraction still works at read time.
        try {
          const url = new URL(raw);
          return collapseDuplicateUrlPathSlashes(`${url.origin}${url.pathname}`);
        } catch {
          return collapseDuplicateUrlPathSlashes(raw);
        }
      }
      // The ACTIVE aliyun bucket is PRIVATE (example-storage): persisting a
      // (re-)signed URL would expire and fail on load — persist the bare
      // object key so the read path re-signs it (OCI branch precedent).
      const collapseHosts = activeAliyunPersistenceCollapseHosts();
      if (collapseHosts) {
        try {
          if (collapseHosts.has(new URL(raw).host)) {
            return collapseDuplicateUrlPathSlashes(objectKey);
          }
        } catch {
          /* not an active-bucket host — fall through */
        }
      }
      return collapseDuplicateUrlPathSlashes(publicUrlForCoursewareObjectKey(objectKey));
    }
    if (/^https?:\/\//i.test(raw)) {
      try {
        const url = new URL(raw);
        // The ACTIVE aliyun bucket is PRIVATE (example-storage): persisting
        // origin+pathname strips the signature and the reference fails
        // immediately — persist the bare key so the read path re-signs it
        // (Codex review round 4, P1). The collapse hosts include the public
        // twin of the configured endpoint (the signer rewrites -internal) and
        // fire only while aliyun is the active backend.
        const collapseHosts = activeAliyunPersistenceCollapseHosts();
        if (collapseHosts?.has(url.host)) {
          return collapseDuplicateUrlPathSlashes(objectKey);
        }
        return collapseDuplicateUrlPathSlashes(`${url.origin}${url.pathname}`);
      } catch {
        return collapseDuplicateUrlPathSlashes(raw);
      }
    }
  }

  if (!isCoursewarePersistenceUrl(raw)) {
    return collapseDuplicateUrlPathSlashes(raw);
  }

  try {
    const url = new URL(raw);
    stripPresignQueryParams(url);
    // The ACTIVE aliyun bucket is PRIVATE (example-storage): a signed URL
    // persisted into a scene loses its signature on save and fails
    // immediately. Persist the bare object key instead — the read path
    // (batch_presign / response refresher) re-signs it.
    const collapseHosts = activeAliyunPersistenceCollapseHosts();
    if (collapseHosts?.has(url.host)) {
      // objectKey is null when the key sits outside SIGNABLE_FILE_PATH_PREFIXES
      // (e.g. model/live2d_model/…, which courseware-asset-presign.ts
      // supports): derive it from the pathname so the reference still
      // collapses to the re-signable bare-key form instead of persisting an
      // expiring signed URL (Codex P1 — passing null down used to throw into
      // the outer catch and keep the URL with its signature).
      return collapseDuplicateUrlPathSlashes(objectKey ?? url.pathname.replace(/^\/+/, ""));
    }
    return collapseDuplicateUrlPathSlashes(rewriteSignedUrlForPublicPersistence(url.toString()));
  } catch {
    return collapseDuplicateUrlPathSlashes(raw);
  }
};

/** Scene persistence with the CLI's deployment URL policy (what `ainobi save` writes). */
export const prepareSceneAssetUrlsForCliPersistence = (scene: Scene): Scene =>
  prepareSceneAssetUrlsForPersistence(scene, normalizeCoursewareAssetUrlForPersistence);
