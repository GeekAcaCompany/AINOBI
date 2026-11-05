// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

import { flagBool, flagNumber, flagString, type ParsedArgs } from "../args.ts";
import { extensionFromPath, formatDocReadExtensionsHint, isDocReadExtensionSupported } from "../doc-extensions.ts";
import { AinobiCliError } from "../errors.ts";
import { convertBufferToMarkdown } from "../markitdown-convert.ts";
import { runDocReadViaHost } from "../doc-host-job.ts";
import { printSuccess, type OutputOptions } from "../output.ts";
import { isDocHostFlush } from "../runtime.ts";
import { cliEnv } from "../env.ts";
import { hasSession, readSessionRaw } from "../state.ts";

const DEFAULT_PREVIEW_CHARS = 4000;
const DEFAULT_MAX_OUTPUT_CHARS = 200_000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const maxUploadBytes = (): number => {
  const parsed = Number(cliEnv().AINOBI_DOC_READ_MAX_BYTES ?? 100 * 1024 * 1024);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 100 * 1024 * 1024;
};

const defaultMarkdownOutPath = (sourcePath: string, workDir: string | null): string => {
  const base = basename(sourcePath, extname(sourcePath)) || "document";
  const dir = workDir ?? dirname(resolve(sourcePath));
  return join(dir, `${base}.md`);
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

const defaultMarkdownOutBesideSource = (absoluteSource: string): string => {
  const base = basename(absoluteSource, extname(absoluteSource)) || "document";
  return join(dirname(absoluteSource), `${base}.md`);
};

const buildPreview = (markdown: string, maxChars: number): { preview: string; truncated: boolean } => {
  if (markdown.length <= maxChars) {
    return { preview: markdown, truncated: false };
  }
  return {
    preview: `${markdown.slice(0, maxChars)}\n\n…`,
    truncated: true,
  };
};

export const handleDocRead = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  const fileId = flagString(args, "file-id")?.trim() || flagString(args, "file_id")?.trim();
  const rawPath = args.positionals[0];

  if (fileId && rawPath) {
    throw new AinobiCliError("USAGE", "Pass either a local <path> or `--file-id`, not both.", {
      hint: "Editor @ library files: `ainobi doc read --file-id <uuid>`. Local files: `ainobi doc read ./report.pdf`.",
    });
  }

  if (fileId) {
    if (!UUID_RE.test(fileId)) {
      throw new AinobiCliError(
        "USAGE",
        "`--file-id` must be a UUID from editor context (not the PDF display name).",
        {
          hint:
            "Look for `file_id` / `fileId` in the editor @ library section. Example: `ainobi doc read --file-id 8a1b…`.",
        },
      );
    }
    if (!isDocHostFlush()) {
      throw new AinobiCliError(
        "USAGE",
        "`--file-id` requires the AINOBI agent host (Plan/Agent runtime).",
        {
          hint: "Outside the agent, download the file locally and run `ainobi doc read <path>`.",
        },
      );
    }

    const llm_prompt = flagString(args, "llm-prompt");
    const no_llm = flagBool(args, "no-llm", false);
    const no_save = flagBool(args, "no-save", false);
    const outFlag = flagString(args, "out");
    const previewChars = flagNumber(args, "preview-chars") ?? DEFAULT_PREVIEW_CHARS;
    const maxOutputChars = flagNumber(args, "max-output-chars") ?? DEFAULT_MAX_OUTPUT_CHARS;
    const workDir = hasSession() ? readSessionRaw()?.work_dir ?? null : null;
    const source_path = `file_id:${fileId}`;
    const markdown_path = outFlag
      ? resolve(outFlag)
      : defaultMarkdownOutPath(`${fileId}.pdf`, workDir ?? resolve(process.cwd()));

    const converted = await runDocReadViaHost(
      {
        source_path,
        file_id: fileId,
        courseware_id: cliEnv().AINOBI_COURSEWARE_ID?.trim() || undefined,
        llm_prompt,
        no_llm,
        pretty: output.pretty,
      },
      output,
    );

    let markdown = converted.markdown;
    let output_truncated = false;
    if (markdown.length > maxOutputChars) {
      markdown = `${markdown.slice(0, maxOutputChars)}\n\n…`;
      output_truncated = true;
    }

    if (!no_save) {
      await mkdir(dirname(markdown_path), { recursive: true });
      await writeFile(markdown_path, converted.markdown, "utf8");
    }

    const { preview, truncated: preview_truncated } = buildPreview(
      markdown,
      Math.max(0, Math.floor(previewChars)),
    );

    printSuccess(
      {
        source_path: converted.source_path || source_path,
        file_id: fileId,
        markdown_path: no_save ? null : markdown_path,
        title: converted.title,
        markdown_chars: converted.markdown.length,
        llm_used: converted.llm_used,
        preview,
        preview_truncated,
        output_truncated,
        no_save,
      },
      output,
    );
    return;
  }

  if (!rawPath) {
    throw new AinobiCliError("USAGE", "Missing document file path or --file-id.", {
      hint:
        "Usage: `ainobi doc read <path>` or `ainobi doc read --file-id <uuid>` (editor @ library files).",
    });
  }

  const from_work_dir = flagBool(args, "from-work-dir", false);
  const workDir = hasSession() ? readSessionRaw()?.work_dir ?? null : null;
  const { source_path, absolute_path } = resolveSourcePath(rawPath, {
    from_work_dir,
    work_dir: workDir,
  });
  const extension = extensionFromPath(absolute_path);
  if (!isDocReadExtensionSupported(extension)) {
    throw new AinobiCliError("USAGE", `Unsupported file type "${extension}".`, {
      hint: `Supported: ${formatDocReadExtensionsHint()}`,
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
  const no_llm = flagBool(args, "no-llm", false);
  const no_save = flagBool(args, "no-save", false);
  const outFlag = flagString(args, "out");
  const previewChars = flagNumber(args, "preview-chars") ?? DEFAULT_PREVIEW_CHARS;
  const maxOutputChars = flagNumber(args, "max-output-chars") ?? DEFAULT_MAX_OUTPUT_CHARS;

  const cwd = resolve(process.cwd());
  const sourceInCwd =
    absolute_path === cwd || absolute_path.startsWith(`${cwd}/`);
  const markdown_path = outFlag
    ? resolve(outFlag)
    : sourceInCwd
      ? defaultMarkdownOutBesideSource(absolute_path)
      : defaultMarkdownOutPath(absolute_path, workDir);

  let converted: { title: string | null; markdown: string; llm_used: boolean };
  if (isDocHostFlush()) {
    converted = await runDocReadViaHost(
      { source_path, absolute_path, llm_prompt, no_llm, pretty: output.pretty },
      output,
    );
  } else {
    const buffer = await readFile(absolute_path);
    converted = await convertBufferToMarkdown(buffer, {
      file_extension: extension,
      llm_prompt,
      use_llm_for_images: !no_llm,
    });
  }

  let markdown = converted.markdown;
  let output_truncated = false;
  if (markdown.length > maxOutputChars) {
    markdown = `${markdown.slice(0, maxOutputChars)}\n\n…`;
    output_truncated = true;
  }

  if (!no_save) {
    await mkdir(dirname(markdown_path), { recursive: true });
    await writeFile(markdown_path, converted.markdown, "utf8");
  }

  const { preview, truncated: preview_truncated } = buildPreview(
    markdown,
    Math.max(0, Math.floor(previewChars)),
  );

  printSuccess(
    {
      source_path,
      markdown_path: no_save ? null : markdown_path,
      title: converted.title,
      bytes: statSize,
      markdown_chars: converted.markdown.length,
      llm_used: converted.llm_used,
      preview,
      preview_truncated,
      output_truncated,
      no_save,
    },
    output,
  );
};
