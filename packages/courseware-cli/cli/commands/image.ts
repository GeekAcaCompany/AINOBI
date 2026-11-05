// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

import { flagBool, flagNumber, flagString, type ParsedArgs } from "../args.ts";
import { extensionFromPath, isDocReadImageExtension } from "../doc-extensions.ts";
import { AinobiCliError } from "../errors.ts";
import { generateImageWithOpenAi } from "../image-generate.ts";
import { runImageGenerateViaHost } from "../image-generate-host-job.ts";
import { replicateImageBufferToHtml } from "../image-replicate-html.ts";
import { runImageReplicateViaHost } from "../image-replicate-host-job.ts";
import { printSuccess, type OutputOptions } from "../output.ts";
import { maybeQuietMutationData } from "../quiet-output.ts";
import { isImageGenerateHostFlush, isImageReplicateHostFlush } from "../runtime.ts";
import { hasSession, readSessionRaw } from "../state.ts";
import { cliEnv } from "../env.ts";

const DEFAULT_PREVIEW_CHARS = 4000;
const DEFAULT_MAX_OUTPUT_CHARS = 200_000;

const maxUploadBytes = (): number => {
  const parsed = Number(cliEnv().AINOBI_DOC_READ_MAX_BYTES ?? 100 * 1024 * 1024);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 100 * 1024 * 1024;
};

const defaultHtmlOutPath = (sourcePath: string, workDir: string | null): string => {
  const base = basename(sourcePath, extname(sourcePath)) || "image";
  const dir = workDir ?? dirname(resolve(sourcePath));
  return join(dir, `${base}.replica.html`);
};

const resolveSourcePath = (
  raw: string,
  options: { from_work_dir: boolean; work_dir: string | null },
): { source_path: string; absolute_path: string } => {
  if (options.from_work_dir) {
    if (!options.work_dir) {
      throw new AinobiCliError("USAGE", "`--from-work-dir` requires a loaded session with `work_dir`.", {
        hint: "Run `ainobi status` or place the file in the agent workspace and use a relative path.",
      });
    }
    const absolute_path = resolve(options.work_dir, raw);
    return { source_path: raw, absolute_path };
  }
  const absolute_path = resolve(raw);
  return { source_path: raw, absolute_path };
};

const defaultHtmlOutBesideSource = (absoluteSource: string): string => {
  const base = basename(absoluteSource, extname(absoluteSource)) || "image";
  return join(dirname(absoluteSource), `${base}.replica.html`);
};

const buildPreview = (html: string, maxChars: number): { preview: string; truncated: boolean } => {
  if (html.length <= maxChars) {
    return { preview: html, truncated: false };
  }
  return {
    preview: `${html.slice(0, maxChars)}\n\n…`,
    truncated: true,
  };
};

export const handleImageReplicateHtml = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  const rawPath = args.positionals[0];
  if (!rawPath) {
    throw new AinobiCliError("USAGE", "Missing image file path.", {
      hint: "Usage: ainobi image replicate-html <path> [--out <html-path>] [--preview-chars N] [--no-save]",
    });
  }

  const from_work_dir = flagBool(args, "from-work-dir", false);
  const workDir = hasSession() ? readSessionRaw()?.work_dir ?? null : null;
  const { source_path, absolute_path } = resolveSourcePath(rawPath, {
    from_work_dir,
    work_dir: workDir,
  });
  const extension = extensionFromPath(absolute_path);
  if (!isDocReadImageExtension(extension)) {
    throw new AinobiCliError("USAGE", `Unsupported image type "${extension}".`, {
      hint: "Supported: .png, .jpg, .jpeg, .gif, .webp, .bmp, .tif, .tiff",
    });
  }

  let statSize = 0;
  try {
    const fileStat = await stat(absolute_path);
    if (!fileStat.isFile()) {
      throw new AinobiCliError("INVALID_INPUT", "Path is not a file.", {
        issues: [{ path: source_path, message: "Path is not a file." }],
      });
    }
    statSize = fileStat.size;
  } catch (error) {
    if (error instanceof AinobiCliError) throw error;
    throw new AinobiCliError("IO_ERROR", `Cannot read file: ${source_path}`, {
      hint: error instanceof Error ? error.message : String(error),
    });
  }

  const limit = maxUploadBytes();
  if (statSize > limit) {
    throw new AinobiCliError("INVALID_INPUT", `File exceeds ${limit} byte limit.`, {
      issues: [{ path: source_path, message: `File exceeds ${limit} byte limit.` }],
    });
  }

  const llm_prompt = flagString(args, "llm-prompt");
  const no_save = flagBool(args, "no-save", false);
  const outFlag = flagString(args, "out");
  const previewChars = flagNumber(args, "preview-chars") ?? DEFAULT_PREVIEW_CHARS;
  const maxOutputChars = flagNumber(args, "max-output-chars") ?? DEFAULT_MAX_OUTPUT_CHARS;

  const cwd = resolve(process.cwd());
  const sourceInCwd =
    absolute_path === cwd || absolute_path.startsWith(`${cwd}/`);
  const html_path = outFlag
    ? resolve(outFlag)
    : sourceInCwd
      ? defaultHtmlOutBesideSource(absolute_path)
      : defaultHtmlOutPath(absolute_path, workDir);

  let replicated: { html: string; model: string; prompt_chars: number };
  if (isImageReplicateHostFlush()) {
    replicated = await runImageReplicateViaHost(
      { source_path, absolute_path, llm_prompt, pretty: output.pretty },
      output,
    );
  } else {
    const buffer = await readFile(absolute_path);
    replicated = await replicateImageBufferToHtml(buffer, {
      file_extension: extension,
      llm_prompt,
    });
  }

  let html = replicated.html;
  let output_truncated = false;
  if (html.length > maxOutputChars) {
    html = `${html.slice(0, maxOutputChars)}\n\n…`;
    output_truncated = true;
  }

  if (!no_save) {
    await mkdir(dirname(html_path), { recursive: true });
    await writeFile(html_path, replicated.html, "utf8");
  }

  const { preview, truncated: preview_truncated } = buildPreview(
    html,
    Math.max(0, Math.floor(previewChars)),
  );

  printSuccess(
    {
      source_path,
      html_path: no_save ? null : html_path,
      bytes: statSize,
      html_chars: replicated.html.length,
      model: replicated.model,
      prompt_chars: replicated.prompt_chars,
      preview,
      preview_truncated,
      output_truncated,
      no_save,
    },
    output,
  );
};

const defaultGeneratedImagePath = (workDir: string | null): string => {
  const dir = workDir ?? resolve(process.cwd());
  return join(dir, `ai-image-${Date.now()}.png`);
};

/**
 * `ainobi image generate` — text-to-image (gpt-image-2).
 * Agent runtime (host flush): delegates image generation to the host, which stores it as a courseware asset, and returns a URL usable for `image.source`.
 * Local runtime: calls OpenAI directly and writes the PNG into work_dir (then upload it with `ainobi asset upload`).
 */
export const handleImageGenerate = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  const prompt = (flagString(args, "prompt") ?? args.positionals.join(" ")).trim();
  if (!prompt) {
    throw new AinobiCliError("USAGE", "Missing image prompt.", {
      hint: 'Usage: ainobi image generate --prompt "..." [--size auto|1024x1024|1536x1024|1024x1536] [--quality auto|low|medium|high] [--name <file.png>]',
    });
  }

  const size = flagString(args, "size");
  const quality = flagString(args, "quality");
  const fileName = flagString(args, "name");

  if (isImageGenerateHostFlush()) {
    const result = await runImageGenerateViaHost({
      prompt,
      size,
      quality,
      file_name: fileName,
      courseware_id: flagString(args, "courseware-id"),
      courseware_org_id: flagString(args, "courseware-org-id"),
    });
    // Quiet (agent default): drop fat `asset` echo; keep `source`/`file_id` for insert.
    // Full `asset` only with `--no-quiet` (avoids archive stubs that bury the URL).
    printSuccess(
      maybeQuietMutationData(
        {
          prompt_chars: prompt.length,
          model: result.model,
          size: result.size,
          quality: result.quality,
          asset: result.asset,
          // Note: use `source` (= asset.fileUrl) as the image element's `source` (already stored in the courseware asset library).
          source: result.asset.fileUrl,
          file_id: result.asset.fileId,
          file_name: result.asset.fileName,
        },
        output.quiet,
      ),
      output,
    );
    return;
  }

  const workDir = hasSession() ? readSessionRaw()?.work_dir ?? null : null;
  const outFlag = flagString(args, "out");
  const outPath = outFlag ? resolve(outFlag) : defaultGeneratedImagePath(workDir);
  const noSave = flagBool(args, "no-save", false);

  const generated = await generateImageWithOpenAi({ prompt, size, quality });
  const buffer = Buffer.from(generated.base64, "base64");
  if (!noSave) {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, buffer);
  }

  printSuccess(
    {
      prompt_chars: prompt.length,
      model: generated.model,
      size: generated.size,
      quality: generated.quality,
      bytes: buffer.length,
      image_path: noSave ? null : outPath,
      usage: generated.usage,
      no_save: noSave,
    },
    output,
  );
};
