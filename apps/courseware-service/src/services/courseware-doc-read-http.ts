// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import busboy from 'busboy';

import {
  extensionFromPath,
  isDocReadExtensionSupported,
  normalizeDocReadExtension,
} from '@ainobi/courseware-cli/cli/doc-extensions.ts';
import { convertBufferToMarkdown } from '@ainobi/courseware-cli/cli/markitdown-convert.ts';
import { getAuthorizedSession } from '../api-auth.ts';
import { sendJsonWithCors } from '../http/cors.ts';
import { readJsonBody } from '../http/request.ts';
import { loadCoursewareByIdWithRequestAccess } from './courseware-org-guard.ts';
import { readCoursewareAssetBytes } from './courseware-asset-read-bytes.ts';
import {
  findCoursewareAssetByFileId,
  findCoursewareAssetByFileIdOnly,
} from './courseware-assets-service.ts';

const defaultMaxDocBytes = 100 * 1024 * 1024;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function orgAccessStatus(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  if (/unauthorized/i.test(message)) return 401;
  if (/not found/i.test(message)) return 404;
  if (/do not have access|forbidden|denied/i.test(message)) return 403;
  return null;
}

function maxDocReadBytes(): number {
  const n = Number(process.env.AINOBI_DOC_READ_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultMaxDocBytes;
}

const formatCliStdout = (data: unknown, pretty: boolean): string => {
  const envelope = { ok: true, data };
  return pretty ? `${JSON.stringify(envelope, null, 2)}\n` : `${JSON.stringify(envelope)}\n`;
};

const sendDocReadFailure = (
  res: ServerResponse,
  message: string,
  status = 200,
): void => {
  const stderr = JSON.stringify({
    ok: false,
    error: { code: 'IO_ERROR', message, issues: [] },
  });
  sendJsonWithCors(res, status, {
    ok: false,
    exit_code: 1,
    stdout: '',
    stderr: stderr.endsWith('\n') ? stderr : `${stderr}\n`,
    error: message,
  });
};

type ParsedMultipart = {
  fields: Record<string, string>;
  tmpFile: string;
  originalName: string;
};

type DocReadByFileIdBody = {
  file_id?: string;
  fileId?: string;
  courseware_id?: string;
  coursewareId?: string;
  file_extension?: string;
  llm_prompt?: string;
  no_llm?: boolean | string;
  pretty?: boolean | string;
};

function parseDocReadMultipart(req: IncomingMessage, maxBytes: number): Promise<ParsedMultipart> {
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    let sawFile = false;
    let tmpDir = '';
    let tmpFile = '';
    let originalName = 'upload';

    const bb = busboy({
      headers: req.headers,
      defParamCharset: 'utf8',
      limits: {
        fileSize: maxBytes,
        files: 1,
        fields: 16,
        fieldSize: 8192,
        parts: 24,
      },
    });

    bb.on('field', (name, val) => {
      fields[name] = val;
    });

    bb.on('file', (name, file, info) => {
      if (name !== 'file') {
        file.resume();
        return;
      }
      sawFile = true;
      originalName = info.filename?.trim() || 'upload';
      mkdtemp(join(tmpdir(), 'ainobi-doc-read-'))
        .then((dir) => {
          tmpDir = dir;
          tmpFile = join(dir, 'upload');
          return pipeline(file, createWriteStream(tmpFile));
        })
        .catch(reject);
    });

    bb.on('error', reject);
    bb.on('close', () => {
      if (!sawFile || !tmpFile) {
        reject(new Error('Missing multipart file field "file".'));
        return;
      }
      resolve({ fields, tmpFile, originalName });
    });

    req.pipe(bb);
  });
}

async function convertAndRespond(args: {
  res: ServerResponse;
  buffer: Buffer;
  extension: string;
  sourceLabel: string;
  llmPrompt?: string;
  noLlm: boolean;
  pretty: boolean;
}): Promise<void> {
  const converted = await convertBufferToMarkdown(args.buffer, {
    file_extension: args.extension,
    llm_prompt: args.llmPrompt,
    use_llm_for_images: !args.noLlm,
  });
  const stdout = formatCliStdout(
    {
      ...converted,
      source_path: args.sourceLabel,
      bytes: args.buffer.length,
    },
    args.pretty,
  );
  sendJsonWithCors(args.res, 200, { ok: true, exit_code: 0, stdout, stderr: '' });
}

async function handleDocReadByFileId(
  req: IncomingMessage,
  res: ServerResponse,
  body: DocReadByFileIdBody,
): Promise<void> {
  const fileId = (body.file_id ?? body.fileId)?.trim() ?? '';
  if (!fileId || !UUID_RE.test(fileId)) {
    sendJsonWithCors(res, 400, {
      ok: false,
      error: 'file_id must be a valid UUID (editor @ library files expose file_id, not the display name).',
    });
    return;
  }

  const requestedCoursewareId =
    body.courseware_id?.trim() || body.coursewareId?.trim() || '';
  let row = requestedCoursewareId
    ? await findCoursewareAssetByFileId(requestedCoursewareId, fileId)
    : null;
  if (!row) {
    row = await findCoursewareAssetByFileIdOnly(fileId);
  }
  if (!row) {
    sendJsonWithCors(res, 404, {
      ok: false,
      error: `Asset not found (fileId=${fileId}).`,
    });
    return;
  }

  try {
    await loadCoursewareByIdWithRequestAccess(req, row.coursewareId, 'write');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      orgAccessStatus(error) ??
      (message === 'Unauthorized' ? 401 : message.includes('not found') ? 404 : 403);
    sendJsonWithCors(res, status, { ok: false, error: message });
    return;
  }

  const objectKey = row.filePath?.trim().replace(/^\/+/, '') ?? '';
  if (!objectKey) {
    sendJsonWithCors(res, 502, { ok: false, error: 'Asset has no storage path.' });
    return;
  }

  const limit = maxDocReadBytes();
  if (typeof row.fileSize === 'number' && row.fileSize > limit) {
    sendJsonWithCors(res, 400, { ok: false, error: `File exceeds ${limit} byte limit.` });
    return;
  }

  const pretty = body.pretty !== false && String(body.pretty).trim() !== 'false';
  const noLlm = body.no_llm === true || body.no_llm === '1' || body.no_llm === 'true';
  const nameHint = row.fileName?.trim() || objectKey;
  const extension = normalizeDocReadExtension(
    body.file_extension?.trim() || extname(nameHint) || extensionFromPath(nameHint),
  );
  if (!isDocReadExtensionSupported(extension)) {
    sendJsonWithCors(res, 400, {
      ok: false,
      error: `Unsupported file extension "${extension}".`,
    });
    return;
  }

  try {
    const buffer = await readCoursewareAssetBytes(objectKey, limit);
    await convertAndRespond({
      res,
      buffer,
      extension,
      sourceLabel: `file_id:${fileId}`,
      llmPrompt: typeof body.llm_prompt === 'string' ? body.llm_prompt : undefined,
      noLlm,
      pretty,
    });
  } catch (error) {
    sendDocReadFailure(res, error instanceof Error ? error.message : String(error));
  }
}

/**
 * POST `/courseware/doc/read` — agent sandbox delegates document→markdown conversion to the host.
 * - Multipart: `file`, optional `file_extension`, `llm_prompt`, `no_llm`, `pretty`
 * - JSON: `{ file_id }` (host loads the courseware asset from OSS/S3; for Plan/Agent @ library files)
 */
export async function handleCoursewareDocRead(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!getAuthorizedSession(req)) {
    sendJsonWithCors(res, 401, { ok: false, error: 'Unauthorized' });
    return;
  }

  const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
  if (contentType.includes('application/json')) {
    let body: DocReadByFileIdBody;
    try {
      body = await readJsonBody<DocReadByFileIdBody>(req);
    } catch (error) {
      sendJsonWithCors(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    await handleDocReadByFileId(req, res, body);
    return;
  }

  const limit = maxDocReadBytes();
  let parsed: ParsedMultipart;
  try {
    parsed = await parseDocReadMultipart(req, limit);
  } catch (error) {
    sendJsonWithCors(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const tmpDir = join(parsed.tmpFile, '..');
  const pretty = parsed.fields.pretty?.trim() !== 'false';
  const noLlm = parsed.fields.no_llm === '1' || parsed.fields.no_llm === 'true';

  try {
    const fileSize = (await stat(parsed.tmpFile)).size;
    if (fileSize > limit) {
      sendJsonWithCors(res, 400, { ok: false, error: `File exceeds ${limit} byte limit.` });
      return;
    }

    const fromField = parsed.fields.file_extension?.trim();
    const extension = normalizeDocReadExtension(
      fromField || extname(parsed.originalName) || extensionFromPath(parsed.originalName),
    );
    if (!isDocReadExtensionSupported(extension)) {
      sendJsonWithCors(res, 400, {
        ok: false,
        error: `Unsupported file extension "${extension}".`,
      });
      return;
    }

    const buffer = await readFile(parsed.tmpFile);
    await convertAndRespond({
      res,
      buffer,
      extension,
      sourceLabel: parsed.originalName,
      llmPrompt: parsed.fields.llm_prompt,
      noLlm,
      pretty,
    });
  } catch (error) {
    sendDocReadFailure(res, error instanceof Error ? error.message : String(error));
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
