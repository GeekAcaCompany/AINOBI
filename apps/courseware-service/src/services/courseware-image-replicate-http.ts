// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import busboy from 'busboy';

import {
  extensionFromPath,
  isDocReadImageExtension,
  normalizeDocReadExtension,
} from '@ainobi/courseware-cli/cli/doc-extensions.ts';
import { replicateImageBufferToHtml } from '@ainobi/courseware-cli/cli/image-replicate-html.ts';
import { getAuthorizedSession } from '../api-auth.ts';
import { sendJsonWithCors } from '../http/cors.ts';

const defaultMaxDocBytes = 100 * 1024 * 1024;

function maxImageReplicateBytes(): number {
  const n = Number(process.env.AINOBI_DOC_READ_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultMaxDocBytes;
}

const formatCliStdout = (data: unknown, pretty: boolean): string => {
  const envelope = { ok: true, data };
  return pretty ? `${JSON.stringify(envelope, null, 2)}\n` : `${JSON.stringify(envelope)}\n`;
};

type ParsedMultipart = {
  fields: Record<string, string>;
  tmpFile: string;
  originalName: string;
};

function parseImageReplicateMultipart(req: IncomingMessage, maxBytes: number): Promise<ParsedMultipart> {
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
      mkdtemp(join(tmpdir(), 'ainobi-image-replicate-'))
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

/**
 * POST `/courseware/image/replicate-html` — agent sandbox delegates image→HTML vision replication to the host.
 * Multipart: `file`, optional `file_extension`, `llm_prompt`, `pretty`.
 */
export async function handleCoursewareImageReplicateHtml(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!getAuthorizedSession(req)) {
    sendJsonWithCors(res, 401, { ok: false, error: 'Unauthorized' });
    return;
  }

  const limit = maxImageReplicateBytes();
  let parsed: ParsedMultipart;
  try {
    parsed = await parseImageReplicateMultipart(req, limit);
  } catch (error) {
    sendJsonWithCors(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const tmpDir = join(parsed.tmpFile, '..');
  const pretty = parsed.fields.pretty?.trim() !== 'false';

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
    if (!isDocReadImageExtension(extension)) {
      sendJsonWithCors(res, 400, {
        ok: false,
        error: `Unsupported image extension "${extension}".`,
      });
      return;
    }

    const { readFile } = await import('node:fs/promises');
    const buffer = await readFile(parsed.tmpFile);
    const replicated = await replicateImageBufferToHtml(buffer, {
      file_extension: extension,
      llm_prompt: parsed.fields.llm_prompt,
    });

    const stdout = formatCliStdout(replicated, pretty);
    sendJsonWithCors(res, 200, { ok: true, exit_code: 0, stdout, stderr: '' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stderr = JSON.stringify({
      ok: false,
      error: { code: 'IO_ERROR', message, issues: [] },
    });
    sendJsonWithCors(res, 200, {
      ok: false,
      exit_code: 1,
      stdout: '',
      stderr: stderr.endsWith('\n') ? stderr : `${stderr}\n`,
      error: message,
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
