// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { getAuthorizedSession } from '../api-auth.ts';
import { sendJsonWithCors } from '../http/cors.ts';
import { readJsonBody } from '../http/request.ts';
import { fetchSectionKnowledgeTextSlice } from './ainobi-section-knowledge.ts';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type KnowledgeReadBody = {
  file_id?: string;
  section_id?: string;
  offset?: number;
  limit?: number;
  out?: string;
  workspace_dir?: string;
};

/**
 * POST `/courseware/knowledge/read` — agent sandbox delegates section knowledge
 * text_slice to the host (education API + user Bearer).
 */
export async function handleCoursewareKnowledgeRead(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const session = getAuthorizedSession(req);
  if (!session?.accessToken) {
    sendJsonWithCors(res, 401, { ok: false, error: 'Unauthorized' });
    return;
  }

  let body: KnowledgeReadBody;
  try {
    body = (await readJsonBody(req)) as KnowledgeReadBody;
  } catch {
    sendJsonWithCors(res, 400, { ok: false, error: 'Invalid JSON body' });
    return;
  }

  const fileId = body.file_id?.trim() || '';
  const sectionId = body.section_id?.trim() || '';
  if (!UUID_RE.test(fileId)) {
    sendJsonWithCors(res, 400, {
      ok: false,
      error: 'file_id must be a UUID from section-knowledge-catalog.json',
    });
    return;
  }
  if (!UUID_RE.test(sectionId)) {
    sendJsonWithCors(res, 400, {
      ok: false,
      error: 'section_id is required in the request body',
    });
    return;
  }

  const offset = typeof body.offset === 'number' ? body.offset : 0;
  const limit = typeof body.limit === 'number' ? body.limit : 4000;

  try {
    const slice = await fetchSectionKnowledgeTextSlice({
      accessToken: session.accessToken,
      sectionId,
      fileId,
      offset,
      limit,
    });

    let markdown_path: string | undefined;
    const workspaceDir = body.workspace_dir?.trim();
    const outRel = body.out?.trim();
    if (workspaceDir && outRel) {
      const root = resolve(workspaceDir);
      const outPath = resolve(root, outRel);
      const rel = outPath.startsWith(root + '/') || outPath === root
        ? outPath.slice(root.length).replace(/^\//, '')
        : null;
      if (!rel || rel.includes('..')) {
        sendJsonWithCors(res, 400, {
          ok: false,
          error: 'out path must stay under workspace_dir',
        });
        return;
      }
      await mkdir(dirname(outPath), { recursive: true });
      const header = [
        `# Knowledge slice`,
        ``,
        `- file_id: \`${slice.file_id}\``,
        `- section_id: \`${slice.section_id}\``,
        `- offset: ${slice.offset}`,
        `- limit: ${slice.limit}`,
        `- total_length: ${slice.total_length}`,
        `- next_offset: ${slice.next_offset ?? 'null'}`,
        ``,
        `---`,
        ``,
        slice.text,
      ].join('\n');
      await writeFile(outPath, header, 'utf8');
      markdown_path = outRel;
    }

    sendJsonWithCors(res, 200, {
      ok: true,
      exit_code: 0,
      stdout: JSON.stringify(
        {
          ok: true,
          data: {
            ...slice,
            markdown_path,
          },
        },
        null,
        2,
      ),
      stderr: '',
      data: {
        ...slice,
        markdown_path,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[knowledge/read]', message);
    sendJsonWithCors(res, 502, {
      ok: false,
      error: message,
      exit_code: 1,
      stdout: '',
      stderr: message,
    });
  }
}
