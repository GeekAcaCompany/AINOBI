// SPDX-License-Identifier: AGPL-3.0-only
import { ainobiBackendApiUrl } from '../config/ainobi-backend-api.ts';

export type SectionKnowledgeCatalogFile = {
  file_id: string;
  file_name: string;
  file_type: string;
  file_summary: string | null;
  file_text_length: number;
  is_primary: boolean;
  sort: number;
};

export type SectionKnowledgeAgentCatalog = {
  section_id: string;
  course_id: string;
  org_id: string;
  files: SectionKnowledgeCatalogFile[];
};

export type SectionKnowledgeTextSlice = {
  file_id: string;
  section_id: string;
  offset: number;
  limit: number;
  total_length: number;
  text: string;
  next_offset: number | null;
};

type PlatformEnvelope<T> = {
  code?: number;
  success?: boolean;
  message?: string;
  data?: T;
};

function unwrapPlatformData<T>(
  response: Response,
  body: PlatformEnvelope<T>,
  label: string,
): T {
  if (!response.ok || body.code !== 0 || body.success !== true || body.data == null) {
    const detail =
      body.message?.trim() ||
      `code=${String(body.code)} success=${String(body.success)} hasData=${body.data != null}`;
    throw new Error(`${label} rejected (HTTP ${response.status}): ${detail}`);
  }
  return body.data;
}

/** Fetch section-bound knowledge catalog (summaries only, no full text). */
export async function fetchSectionKnowledgeAgentCatalog(
  accessToken: string,
  sectionId: string,
): Promise<SectionKnowledgeAgentCatalog> {
  const id = sectionId.trim();
  if (!id) {
    throw new Error('sectionId is required');
  }

  const url = ainobiBackendApiUrl(
    `/course_section/${encodeURIComponent(id)}/knowledge_file/agent_catalog`,
  );
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
      },
    });
  } catch (error) {
    throw new Error(
      `Knowledge catalog request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let body: PlatformEnvelope<SectionKnowledgeAgentCatalog>;
  try {
    body = (await response.json()) as PlatformEnvelope<SectionKnowledgeAgentCatalog>;
  } catch {
    throw new Error('Knowledge catalog returned invalid JSON');
  }

  return unwrapPlatformData(response, body, 'Knowledge catalog');
}

/** Fetch a character slice of section-bound knowledge file text. */
export async function fetchSectionKnowledgeTextSlice(args: {
  accessToken: string;
  sectionId: string;
  fileId: string;
  offset?: number;
  limit?: number;
}): Promise<SectionKnowledgeTextSlice> {
  const sectionId = args.sectionId.trim();
  const fileId = args.fileId.trim();
  if (!sectionId || !fileId) {
    throw new Error('sectionId and fileId are required');
  }

  const offset = Math.max(0, Math.floor(args.offset ?? 0));
  const limit = Math.min(8000, Math.max(1, Math.floor(args.limit ?? 4000)));

  const url = new URL(
    ainobiBackendApiUrl(
      `/course_section/${encodeURIComponent(sectionId)}/knowledge_file/${encodeURIComponent(fileId)}/text_slice`,
    ),
  );
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('limit', String(limit));

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${args.accessToken}`,
        accept: 'application/json',
      },
    });
  } catch (error) {
    throw new Error(
      `Knowledge text_slice request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let body: PlatformEnvelope<SectionKnowledgeTextSlice>;
  try {
    body = (await response.json()) as PlatformEnvelope<SectionKnowledgeTextSlice>;
  } catch {
    throw new Error('Knowledge text_slice returned invalid JSON');
  }

  return unwrapPlatformData(response, body, 'Knowledge text_slice');
}
