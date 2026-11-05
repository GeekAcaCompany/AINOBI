// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Scene presign for the student app: the engine's presign pass
 * (`@ainobi/courseware-core/presign-scene.ts`) wired to this app's courseware-assets
 * client, plus the FC render page's intranet-reachability fallback.
 */
import coursewareAssetsApi from "../../api/courseware_assets.ts";
import type { Scene } from "@ainobi/courseware-core/scene.ts";
import { tryPresignSceneAssetUrls as presignSceneAssetUrls } from "@ainobi/courseware-core/presign-scene.ts";
import { probeUrlFetchable } from "./oss-internal-reachability-probe.ts";

export {
  applySignedUrlsToSceneElements,
  collectSignableUrlsForPresign,
} from "@ainobi/courseware-core/presign-scene.ts";

/** "internal": only for the FC headless render page, see the comment in `@/api/courseware_assets`. */
export type OssPresignNetwork = "public" | "internal";

/**
 * The internal host is unreachable from the internet: with `network: "internal"` **every** signed URL gets a GET reachability probe
 * (consistent with the Hyperframes FFmpeg download), and unreachable entries are re-signed for the public host individually, avoiding "the sample is reachable but an individual
 * MP3 fails over the internal network", which would leave individual TTS segments silent in the output. With `network` `"public"` / unspecified, results
 * pass straight through without probing (keeping the default path free of extra cost).
 *
 * Extracted as a pure function (injecting `presign`/`probe`) so the decision logic can be unit tested.
 */
export async function presignBatchWithInternalNetworkFallback(
  presign: (network: OssPresignNetwork | undefined) => Promise<Record<string, string>>,
  network: OssPresignNetwork | undefined,
  probe: (url: string) => Promise<boolean> = probeUrlFetchable,
): Promise<Record<string, string>> {
  const signed = await presign(network);
  if (network !== "internal") return signed;

  const entries = Object.entries(signed);
  if (entries.length === 0) return signed;

  const unreachableOriginals: string[] = [];
  await Promise.all(
    entries.map(async ([original, signedUrl]) => {
      if (await probe(signedUrl)) return;
      unreachableOriginals.push(original);
    }),
  );

  if (unreachableOriginals.length === 0) return signed;

  if (unreachableOriginals.length === entries.length) {
    console.warn(
      "[presign] OSS intranet batch unreachable from this runtime; falling back to public URLs.",
    );
    return presign("public");
  }

  console.warn(
    `[presign] ${unreachableOriginals.length}/${entries.length} OSS intranet URL(s) unreachable; re-signing those as public.`,
  );
  const publicSigned = await presign("public");
  const merged = { ...signed };
  for (const original of unreachableOriginals) {
    const fallback = publicSigned[original];
    if (fallback) merged[original] = fallback;
  }
  return merged;
}

/**
 * Batch-presign courseware asset URLs in a scene (slides, global audio, vtuber models, **quiz media**).
 * Used by the editor on load and by preview after reading unsigned JSON from storage.
 */
export async function tryPresignSceneAssetUrls(
  scene: Scene,
  coursewareId?: string | null,
  options?: { network?: OssPresignNetwork; renderToken?: string },
): Promise<Scene> {
  const cwId = coursewareId?.trim();
  if (!cwId) return scene;
  const renderToken = options?.renderToken?.trim() || undefined;
  return presignSceneAssetUrls(scene, cwId, (urls) =>
    presignBatchWithInternalNetworkFallback(
      (network) => coursewareAssetsApi.batchPresignUrls(cwId, urls, undefined, network, renderToken),
      options?.network,
    ),
  );
}
