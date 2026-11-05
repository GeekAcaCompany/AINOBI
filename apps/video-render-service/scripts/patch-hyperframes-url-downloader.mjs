// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Patch Hyperframes URL downloader for intermittent OSS failures.
 *
 * Upstream `downloadToTemp` has no retries, writes directly to the final path,
 * and on failure can leave a partial file that later runs treat as a cache hit —
 * matching random silent TTS segments with healthy lip-sync (browser decode path
 * is separate from FFmpeg mux downloads).
 *
 * Patches:
 * - `@hyperframes/engine/dist/utils/urlDownloader.js` (standalone engine)
 * - `@hyperframes/producer/dist/index.js` (bundled copy used by audio_process)
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const MARKER = "AINOBI_DOWNLOAD_RETRY_PATCH_V1";
/** Partial audio-track drops must abort the render instead of producing silent segments. */
const FAIL_HARD_MARKER = "AINOBI_AUDIO_FAIL_HARD_V1";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");

function resolvePackageRoot(name) {
  // Prefer walking from a resolvable subpath; fall back to node_modules layout.
  const candidates = [
    () => {
      try {
        return require.resolve(`${name}/dist/index.js`);
      } catch {
        return null;
      }
    },
    () => {
      try {
        return require.resolve(`${name}/dist/utils/urlDownloader.js`);
      } catch {
        return null;
      }
    },
  ];
  for (const getEntry of candidates) {
    const entry = getEntry();
    if (!entry) continue;
    let dir = dirname(entry);
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, "package.json"))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  const scoped = join(repoRoot, "node_modules", ...name.split("/"));
  if (existsSync(join(scoped, "package.json"))) return scoped;

  // When invoked from deploy/, packages live under deploy/node_modules.
  const cwdScoped = join(process.cwd(), "node_modules", ...name.split("/"));
  if (existsSync(join(cwdScoped, "package.json"))) return cwdScoped;

  // pnpm keeps transitive dependencies inside <store-root>/node_modules/.pnpm/<pkg>+<version>/node_modules/<pkg>;
  // standalone installs keep the store at the package root, workspaces keep it at the
  // workspace root, so search upward instead of assuming where it lives.
  let storeDir = repoRoot;
  for (let i = 0; i < 6; i++) {
    const pnpmRoot = join(storeDir, "node_modules", ".pnpm");
    if (existsSync(pnpmRoot)) {
      const prefix = `${name.replace("/", "+")}@`;
      const hit = readdirSync(pnpmRoot).find(
        (entry) => entry.startsWith(prefix) && existsSync(join(pnpmRoot, entry, "node_modules", ...name.split("/"), "package.json")),
      );
      if (hit) return join(pnpmRoot, hit, "node_modules", ...name.split("/"));
    }
    const parent = dirname(storeDir);
    if (parent === storeDir) break;
    storeDir = parent;
  }

  throw new Error(`[patch-hyperframes] could not resolve package root for ${name}`);
}

function patchEngineUrlDownloader(root) {
  const filePath = join(root, "dist/utils/urlDownloader.js");
  if (!existsSync(filePath)) {
    console.warn(`[patch-hyperframes] skip missing ${filePath}`);
    return false;
  }
  let source = readFileSync(filePath, "utf8");
  if (source.includes(MARKER)) {
    console.log(`[patch-hyperframes] already patched ${filePath}`);
    return false;
  }

  // Engine module uses createWriteStream / Readable / finished from top-level imports,
  // and existsSync/mkdirSync/join from fs/path. Keep those; rewrite downloadToTemp only.
  const engineVersion = `export async function downloadToTemp(url, destDir, timeoutMs = 300000) {
    // ${MARKER}
    assertPublicHttpsUrl(url);
    const cachedPath = downloadPathCache.get(url);
    if (cachedPath && existsSync(cachedPath)) {
        return cachedPath;
    }
    const inFlight = inFlightDownloads.get(url);
    if (inFlight) {
        return inFlight;
    }
    if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
    }
    const filename = getFilenameFromUrl(url);
    const localPath = join(destDir, filename);
    if (existsSync(localPath)) {
        downloadPathCache.set(url, localPath);
        return localPath;
    }
    const maxAttempts = 5;
    const downloadPromise = (async () => {
        let lastError;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const tmpPath = \`\${localPath}.part.\${process.pid}.\${attempt}\`;
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
                const response = await fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (!response.ok) {
                    throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
                }
                if (!response.body) {
                    throw new Error("Response body is empty");
                }
                const fileStream = createWriteStream(tmpPath);
                const readableStream = Readable.fromWeb(response.body);
                await finished(readableStream.pipe(fileStream));
                const { renameSync, unlinkSync } = await import("fs");
                try {
                    renameSync(tmpPath, localPath);
                }
                catch (renameErr) {
                    if (existsSync(tmpPath)) {
                        try {
                            unlinkSync(tmpPath);
                        }
                        catch { }
                    }
                    throw renameErr;
                }
                downloadPathCache.set(url, localPath);
                if (attempt > 1) {
                    console.warn(\`[URLDownloader] recovered after \${attempt} attempts: \${url}\`);
                }
                return localPath;
            }
            catch (err) {
                lastError = err;
                try {
                    const { unlinkSync } = await import("fs");
                    if (existsSync(tmpPath))
                        unlinkSync(tmpPath);
                    if (existsSync(localPath))
                        unlinkSync(localPath);
                }
                catch { }
                const message = err instanceof Error ? err.message : String(err);
                const retryable = /aborted|timeout|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|ENOTFOUND|socket|network|fetch failed|Connection closed|HTTP 5\\d\\d/i.test(message);
                if (!retryable || attempt === maxAttempts) {
                    if (message.includes("aborted")) {
                        throw new Error(\`[URLDownloader] Download timeout after \${timeoutMs / 1000}s: \${url}\`);
                    }
                    throw new Error(\`[URLDownloader] Download failed: \${message}\`);
                }
                const backoffMs = Math.min(4000, 200 * 2 ** (attempt - 1));
                console.warn(\`[URLDownloader] attempt \${attempt}/\${maxAttempts} failed; retry in \${backoffMs}ms: \${message}\`);
                await new Promise((resolve) => setTimeout(resolve, backoffMs));
            }
        }
        throw lastError instanceof Error ? lastError : new Error(\`[URLDownloader] Download failed: \${String(lastError)}\`);
    })();
    inFlightDownloads.set(url, downloadPromise);
    return downloadPromise.finally(() => {
        inFlightDownloads.delete(url);
    });
}`;

  const replaced = source.replace(
    /export async function downloadToTemp\(url, destDir, timeoutMs = 300000\) \{[\s\S]*?\n\}/,
    engineVersion,
  );
  if (replaced === source) {
    throw new Error(`[patch-hyperframes] failed to locate downloadToTemp in ${filePath}`);
  }
  writeFileSync(filePath, replaced);
  console.log(`[patch-hyperframes] patched ${filePath}`);
  return true;
}

function patchProducerBundle(root) {
  const filePath = join(root, "dist/index.js");
  if (!existsSync(filePath)) {
    console.warn(`[patch-hyperframes] skip missing ${filePath}`);
    return false;
  }
  let source = readFileSync(filePath, "utf8");
  if (source.includes(MARKER)) {
    console.log(`[patch-hyperframes] already patched ${filePath}`);
    return false;
  }

  // Bundled producer uses aliased imports (existsSync8, mkdirSync4, join9, createWriteStream2…).
  // Match the original function and replace with a robust version using those aliases.
  const start = source.indexOf("async function downloadToTemp(url, destDir, timeoutMs = 3e5)");
  if (start < 0) {
    // try non-minified form
    const alt = source.indexOf("async function downloadToTemp(url, destDir, timeoutMs = 300000)");
    if (alt < 0) {
      throw new Error(`[patch-hyperframes] downloadToTemp not found in ${filePath}`);
    }
  }
  const fnStart = source.indexOf("async function downloadToTemp(url, destDir, timeoutMs =");
  // Find matching closing brace of the function by scanning from fnStart.
  let i = source.indexOf("{", fnStart);
  let depth = 0;
  let end = -1;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) {
    throw new Error(`[patch-hyperframes] could not find end of downloadToTemp in ${filePath}`);
  }

  // Detect which identifier aliases this bundle uses by peeking at the original body.
  const original = source.slice(fnStart, end);
  const existsSyncId = (original.match(/existsSync\w*/)?.[0]) ?? "existsSync";
  const mkdirSyncId = (original.match(/mkdirSync\w*/)?.[0]) ?? "mkdirSync";
  const joinId = (original.match(/\bjoin\d*\(/)?.[0]?.replace("(", "")) ?? "join";
  const createWriteStreamId =
    (original.match(/createWriteStream\w*/)?.[0]) ?? "createWriteStream";

  const bundled = `async function downloadToTemp(url, destDir, timeoutMs = 3e5) {
  // ${MARKER}
  assertPublicHttpsUrl(url);
  const cachedPath = downloadPathCache.get(url);
  if (cachedPath && ${existsSyncId}(cachedPath)) {
    return cachedPath;
  }
  const inFlight = inFlightDownloads.get(url);
  if (inFlight) {
    return inFlight;
  }
  if (!${existsSyncId}(destDir)) {
    ${mkdirSyncId}(destDir, { recursive: true });
  }
  const filename = getFilenameFromUrl(url);
  const localPath = ${joinId}(destDir, filename);
  if (${existsSyncId}(localPath)) {
    downloadPathCache.set(url, localPath);
    return localPath;
  }
  const maxAttempts = 5;
  const downloadPromise = (async () => {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const tmpPath = \`\${localPath}.part.\${process.pid}.\${attempt}\`;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) {
          throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
        }
        if (!response.body) {
          throw new Error("Response body is empty");
        }
        const fileStream = ${createWriteStreamId}(tmpPath);
        const readableStream = Readable.fromWeb(response.body);
        await finished(readableStream.pipe(fileStream));
        const fsMod = await import("fs");
        try {
          fsMod.renameSync(tmpPath, localPath);
        } catch (renameErr) {
          if (fsMod.existsSync(tmpPath)) {
            try { fsMod.unlinkSync(tmpPath); } catch {}
          }
          throw renameErr;
        }
        downloadPathCache.set(url, localPath);
        if (attempt > 1) {
          console.warn(\`[URLDownloader] recovered after \${attempt} attempts: \${url}\`);
        }
        return localPath;
      } catch (err) {
        lastError = err;
        try {
          const fsMod = await import("fs");
          if (fsMod.existsSync(tmpPath)) fsMod.unlinkSync(tmpPath);
          if (fsMod.existsSync(localPath)) fsMod.unlinkSync(localPath);
        } catch {}
        const message = err instanceof Error ? err.message : String(err);
        const retryable = /aborted|timeout|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|ENOTFOUND|socket|network|fetch failed|Connection closed|HTTP 5\\d\\d/i.test(message);
        if (!retryable || attempt === maxAttempts) {
          if (message.includes("aborted")) {
            throw new Error(\`[URLDownloader] Download timeout after \${timeoutMs / 1e3}s: \${url}\`);
          }
          throw new Error(\`[URLDownloader] Download failed: \${message}\`);
        }
        const backoffMs = Math.min(4000, 200 * 2 ** (attempt - 1));
        console.warn(\`[URLDownloader] attempt \${attempt}/\${maxAttempts} failed; retry in \${backoffMs}ms: \${message}\`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(\`[URLDownloader] Download failed: \${String(lastError)}\`);
  })();
  inFlightDownloads.set(url, downloadPromise);
  return downloadPromise.finally(() => {
    inFlightDownloads.delete(url);
  });
}`;

  source = source.slice(0, fnStart) + bundled + source.slice(end);
  writeFileSync(filePath, source);
  console.log(`[patch-hyperframes] patched download retry in ${filePath}`);
  return true;
}

/**
 * Make partial audio-track failures abort the render.
 * Upstream keeps mixing remaining tracks and only warns — that yields silent TTS.
 */
function patchAudioFailHard(producerRoot, engineRoot) {
  let changed = false;

  const engineMixer = join(engineRoot, "dist/services/audioMixer.js");
  if (existsSync(engineMixer)) {
    let source = readFileSync(engineMixer, "utf8");
    if (!source.includes(FAIL_HARD_MARKER)) {
      const before = source;
      source = source.replace(
        /return \{\s*\.\.\.mixResult,\s*durationMs: Date\.now\(\) - startMs,\s*error: errors\.length > 0 \? `Warnings: \$\{errors\.join\(", "\)\}` : mixResult\.error,\s*\};/,
        `return {
        // ${FAIL_HARD_MARKER}
        ...mixResult,
        // Any per-track download/prepare failure must fail the mix — silent drops are worse than aborting.
        success: errors.length > 0 ? false : mixResult.success,
        durationMs: Date.now() - startMs,
        error: errors.length > 0 ? \`Audio track failures: \${errors.join(", ")}\` : mixResult.error,
    };`,
      );
      if (source === before) {
        console.warn(`[patch-hyperframes] could not locate processCompositionAudio return in ${engineMixer}`);
      } else {
        writeFileSync(engineMixer, source);
        console.log(`[patch-hyperframes] fail-hard audio mix in ${engineMixer}`);
        changed = true;
      }
    }
  }

  const producerFile = join(producerRoot, "dist/index.js");
  if (!existsSync(producerFile)) return changed;
  let source = readFileSync(producerFile, "utf8");
  if (source.includes(FAIL_HARD_MARKER) && !source.includes("output will be video-only")) {
    // Already fully patched (fail-hard + throw).
    return changed;
  }

  // 1) processCompositionAudio: treat per-track errors as mix failure.
  if (!source.includes(FAIL_HARD_MARKER)) {
    const before = source;
    source = source.replace(
      /return \{\s*\.\.\.mixResult,\s*durationMs: Date\.now\(\) - startMs,\s*error: errors\.length > 0 \? `Warnings: \$\{errors\.join\(", "\)\}` : mixResult\.error\s*\};/,
      `return {
    // ${FAIL_HARD_MARKER}
    ...mixResult,
    success: errors.length > 0 ? false : mixResult.success,
    durationMs: Date.now() - startMs,
    error: errors.length > 0 ? \`Audio track failures: \${errors.join(", ")}\` : mixResult.error
  };`,
    );
    if (source === before) {
      console.warn("[patch-hyperframes] could not locate bundled processCompositionAudio return");
    } else {
      changed = true;
    }
  }

  // 2) runAudioStage: also fail when error string indicates track drops (belt-and-suspenders
  // for older patch that only warned).
  if (source.includes("Audio track warnings (partial drop possible)")) {
    source = source.replace(
      /hasAudio = audioResult\.success;\s*if \(!hasAudio\) audioError = audioResult\.error \?\? "[^"]+";\s*else if \(audioResult\.error\) console\.warn\(`\[Render\] Audio track warnings \(partial drop possible\): \$\{audioResult\.error\}`\);/,
      `hasAudio = audioResult.success;
    if (!hasAudio) audioError = audioResult.error ?? "audio mix failed for an unknown reason";
    else if (audioResult.error && /Audio track failures|Warnings:/.test(audioResult.error)) {
      hasAudio = false;
      audioError = audioResult.error;
    }`,
    );
    changed = true;
  } else if (!source.includes("Audio track failures|Warnings:")) {
    const before = source;
    source = source.replace(
      /hasAudio = audioResult\.success;\s*if \(!hasAudio\) audioError = audioResult\.error \?\? "[^"]+";/,
      `hasAudio = audioResult.success;
    if (!hasAudio) audioError = audioResult.error ?? "audio mix failed for an unknown reason";
    else if (audioResult.error && /Audio track failures|Warnings:/.test(audioResult.error)) {
      hasAudio = false;
      audioError = audioResult.error;
    }`,
    );
    if (source !== before) changed = true;
  }

  // 3) Call sites: abort render instead of continuing video-only.
  const softWarn =
    /if \(audioResult\.audioError\) \{\s*log\.warn\(`\[Render\] Audio mix failed \\u2014 output will be video-only: \$\{audioResult\.audioError\}`\);\s*\}/g;
  if (softWarn.test(source)) {
    source = source.replace(
      softWarn,
      `if (audioResult.audioError) {
      throw new Error(\`[Render] Audio mix failed — aborting render (refusing silent/partial audio): \${audioResult.audioError}\`);
    }`,
    );
    changed = true;
  } else {
    // Non-escaped em dash variant
    const softWarn2 =
      /if \(audioResult\.audioError\) \{\s*log\.warn\(`\[Render\] Audio mix failed — output will be video-only: \$\{audioResult\.audioError\}`\);\s*\}/g;
    if (softWarn2.test(source)) {
      source = source.replace(
        softWarn2,
        `if (audioResult.audioError) {
      throw new Error(\`[Render] Audio mix failed — aborting render (refusing silent/partial audio): \${audioResult.audioError}\`);
    }`,
      );
      changed = true;
    }
  }

  if (changed) {
    writeFileSync(producerFile, source);
    console.log(`[patch-hyperframes] fail-hard audio abort in ${producerFile}`);
  }
  return changed;
}

function main() {
  const engineRoot = resolvePackageRoot("@hyperframes/engine");
  const producerRoot = resolvePackageRoot("@hyperframes/producer");
  const a = patchEngineUrlDownloader(engineRoot);
  const b = patchProducerBundle(producerRoot);
  const c = patchAudioFailHard(producerRoot, engineRoot);
  if (!a && !b && !c) {
    console.log("[patch-hyperframes] nothing to do");
  }
}

main();
