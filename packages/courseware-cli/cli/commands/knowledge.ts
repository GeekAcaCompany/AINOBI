// SPDX-License-Identifier: AGPL-3.0-only
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { flagNumber, flagString, type ParsedArgs } from "../args.ts";
import { AinobiCliError } from "../errors.ts";
import { printSuccess, type OutputOptions } from "../output.ts";
import { cliEnv } from "../env.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CATALOG_FILENAME = "section-knowledge-catalog.json";

const knowledgeHostEndpoint = (): string => {
  const raw = cliEnv().AINOBI_KNOWLEDGE_HOST_URL?.trim();
  if (!raw) {
    throw new AinobiCliError(
      "USAGE",
      "Agent knowledge read requires `AINOBI_KNOWLEDGE_HOST_URL` (set by the AINOBI host).",
      {
        hint: "Run `ainobi knowledge read` from the courseware agent chat environment.",
      },
    );
  }
  return raw.replace(/\/$/, "");
};

const uploadAuthHeaders = (): Record<string, string> => {
  const key = cliEnv().AINOBI_AGENT_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
};

const resolveCatalogPath = (): string => {
  const override = cliEnv().AINOBI_KNOWLEDGE_CATALOG_PATH?.trim();
  if (override) {
    return resolve(override);
  }
  return resolve(process.cwd(), CATALOG_FILENAME);
};

export const handleKnowledgeList = async (
  _args: ParsedArgs,
  output: OutputOptions,
): Promise<void> => {
  const catalogPath = resolveCatalogPath();
  let raw: string;
  try {
    raw = await readFile(catalogPath, "utf8");
  } catch {
    throw new AinobiCliError(
      "NOT_FOUND",
      `Knowledge catalog not found at ${catalogPath}.`,
      {
        hint:
          "The host writes `section-knowledge-catalog.json` when the courseware is bound to a course section with knowledge files.",
      },
    );
  }

  let catalog: unknown;
  try {
    catalog = JSON.parse(raw);
  } catch {
    throw new AinobiCliError("IO_ERROR", "Knowledge catalog is not valid JSON.");
  }

  printSuccess(
    {
      catalog_path: CATALOG_FILENAME,
      catalog,
    },
    output,
  );
};

export const handleKnowledgeRead = async (
  args: ParsedArgs,
  output: OutputOptions,
): Promise<void> => {
  const fileId = flagString(args, "file-id")?.trim() || flagString(args, "file_id")?.trim();
  if (!fileId || !UUID_RE.test(fileId)) {
    throw new AinobiCliError(
      "USAGE",
      "`--file-id` must be a UUID from `section-knowledge-catalog.json`.",
      {
        hint: "Run `ainobi knowledge list` first, then `ainobi knowledge read --file-id <uuid>`.",
      },
    );
  }

  const offset = flagNumber(args, "offset") ?? 0;
  const limit = flagNumber(args, "limit") ?? 4000;
  const sectionId =
    flagString(args, "section-id")?.trim() ||
    flagString(args, "section_id")?.trim() ||
    cliEnv().AINOBI_SECTION_ID?.trim() ||
    "";

  const outRel =
    flagString(args, "out")?.trim() ||
    join("knowledge", `${fileId.slice(0, 8)}_${offset}_${limit}.md`);

  const endpoint = knowledgeHostEndpoint();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...uploadAuthHeaders(),
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        file_id: fileId,
        ...(sectionId ? { section_id: sectionId } : {}),
        offset,
        limit,
        out: outRel,
        workspace_dir: process.cwd(),
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw new AinobiCliError(
      "IO_ERROR",
      `Knowledge host request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const text = await response.text();
  let parsed: {
    ok?: boolean;
    error?: string;
    data?: {
      file_id?: string;
      offset?: number;
      limit?: number;
      total_length?: number;
      text?: string;
      next_offset?: number | null;
      markdown_path?: string;
    };
    stdout?: string;
  };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new AinobiCliError(
      "IO_ERROR",
      `Knowledge host returned non-JSON (HTTP ${response.status}).`,
    );
  }

  if (!response.ok || parsed.ok === false) {
    throw new AinobiCliError(
      "IO_ERROR",
      parsed.error?.trim() || `Knowledge host failed (HTTP ${response.status}).`,
    );
  }

  const data = parsed.data ?? {};
  let markdownPath = data.markdown_path?.trim() || outRel;

  // If host did not write the file, write locally from returned text.
  if (typeof data.text === "string" && data.text.length > 0) {
    const absolute = resolve(process.cwd(), markdownPath);
    await mkdir(dirname(absolute), { recursive: true });
    const header = [
      `# Knowledge slice`,
      ``,
      `- file_id: \`${data.file_id ?? fileId}\``,
      `- offset: ${data.offset ?? offset}`,
      `- limit: ${data.limit ?? limit}`,
      `- total_length: ${data.total_length ?? "?"}`,
      `- next_offset: ${data.next_offset ?? "null"}`,
      ``,
      `---`,
      ``,
      data.text,
    ].join("\n");
    await writeFile(absolute, header, "utf8");
  }

  printSuccess(
    {
      file_id: data.file_id ?? fileId,
      offset: data.offset ?? offset,
      limit: data.limit ?? limit,
      total_length: data.total_length,
      next_offset: data.next_offset ?? null,
      markdown_path: markdownPath,
      preview:
        typeof data.text === "string"
          ? data.text.length > 500
            ? `${data.text.slice(0, 500)}…`
            : data.text
          : undefined,
    },
    output,
  );
};
