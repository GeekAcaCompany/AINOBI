// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path';

import { attachAuthorizedSession } from '../api-auth.ts';
import { assertOrgIdAccess, normalizeOrgId } from '../auth/ainobi-org-access.ts';
import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import { ensureDataSource } from '../db/ensure-data-source.ts';
import {
  extensionFromPath,
  isDocReadExtensionSupported,
  normalizeDocReadExtension,
} from '@ainobi/courseware-cli/cli/doc-extensions.ts';
import { convertBufferToMarkdown } from '@ainobi/courseware-cli/cli/markitdown-convert.ts';
import {
  normalizeAssetExtension,
  SUPPORTED_COURSEWARE_ASSET_EXTENSIONS,
} from '@ainobi/courseware-cli/cli/asset-extension.ts';
import { AinobiCliError } from '@ainobi/courseware-cli/cli/errors.ts';
import { fetchOrgTtsFromPlatform } from '../services/ainobi-tts.ts';
import { patchSessionNarrationCatalogs } from '../services/narration-tts-preauth.ts';
import {
  CoursewareAssetUploadFinalizeError,
  finalizeCoursewareAssetUpload,
} from '../services/courseware-asset-upload-finalize.ts';
import { readCoursewareAssetBytes } from '../services/courseware-asset-read-bytes.ts';
import {
  findCoursewareAssetByFileId,
  listCoursewareAssets,
} from '../services/courseware-assets-service.ts';
import {
  preauthImageGenerateCredits,
  settleImageGenerateCredits,
} from '../services/courseware-image-ai-credits.ts';
import {
  COURSEWARE_IMAGE_GENERATE_MAX_PROMPT_CHARS,
  runCoursewareImageGenerate,
} from '../services/courseware-image-generate-service.ts';
import {
  DEFAULT_IMAGE_GENERATE_CREDITS_SERVICE_CODE,
} from '../services/ainobi-credits.ts';
import {
  assertCoursewareRequestAccess,
  CoursewareOrgAccessError,
} from '../services/courseware-org-guard.ts';
import { getCoursewareEntityById } from '../services/courseware-service.ts';
import type { CodexMcpWorkspaceSession } from './codex-mcp-session.ts';
import {
  ensureHydratedWorkspace,
  isToolError,
  requireOwnedSession,
  resolveCatalogOrgIdForMcpSession,
  toolError,
} from './codex-mcp-tool-shared.ts';

/** Soft ceiling for MCP doc_read (mirrors HTTP AINOBI_DOC_READ_MAX_BYTES default). */
const DEFAULT_MCP_DOC_READ_MAX_BYTES = 100 * 1024 * 1024;
/** MCP upload size cap (decoded bytes for base64; workspace files share the same soft ceiling). */
const MAX_MCP_UPLOAD_BYTES = 20 * 1024 * 1024;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function maxMcpDocReadBytes(): number {
  const n = Number(process.env.AINOBI_DOC_READ_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MCP_DOC_READ_MAX_BYTES;
}

function createAuthorizedRequest(session: AinobiAuthorizedSession): IncomingMessage {
  const req = {
    headers: {
      authorization: `Bearer ${session.accessToken}`,
    },
  } as IncomingMessage;
  attachAuthorizedSession(req, session);
  return req;
}

function resolveWorkspaceRelativePath(workspaceDir: string, relativePath: string): string | null {
  const rel = relativePath.trim();
  if (!rel || isAbsolute(rel) || rel.includes('..')) {
    return null;
  }
  const root = resolve(workspaceDir);
  const candidate = normalize(resolve(root, rel));
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    return null;
  }
  return candidate;
}

function decodeBase64Payload(raw: string, maxDecodedBytes: number): Buffer | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const comma = trimmed.indexOf(',');
  const payload =
    trimmed.startsWith('data:') && comma >= 0 ? trimmed.slice(comma + 1) : trimmed;
  // Reject oversized encoded payloads before allocating decoded buffers.
  // Base64 expands ~4/3; also reject obviously too-long ASCII wrappers.
  const maxEncoded = Math.ceil(maxDecodedBytes * 1.37) + 128;
  if (payload.length > maxEncoded) {
    return null;
  }
  try {
    const buf = Buffer.from(payload, 'base64');
    if (buf.length === 0 || buf.length > maxDecodedBytes) {
      return null;
    }
    return buf;
  } catch {
    return null;
  }
}

function slimAsset(asset: {
  fileId: string;
  fileName: string;
  fileUrl: string | null;
  filePath?: string | null;
  fileSize: number;
  contentType: string | null;
}) {
  return {
    file_id: asset.fileId,
    file_name: asset.fileName,
    // Durable object key — file_url is the stable persistence form (unsigned);
    // playable/fetchable URLs come from host read paths on demand.
    file_path: asset.filePath ?? null,
    source: asset.fileUrl,
    file_url: asset.fileUrl,
    file_size: asset.fileSize,
    content_type: asset.contentType,
  };
}

export async function coursewareImageGenerateTool(
  caller: AinobiAuthorizedSession,
  args: {
    mcp_session_id?: string;
    prompt?: string;
    size?: string;
    quality?: string;
    file_name?: string;
  },
): Promise<Record<string, unknown>> {
  const session = await requireOwnedSession(caller, args.mcp_session_id);
  if (isToolError(session)) {
    return session;
  }

  const prompt = args.prompt?.trim();
  if (!prompt) {
    return toolError('prompt is required', 'USAGE');
  }
  if (prompt.length > COURSEWARE_IMAGE_GENERATE_MAX_PROMPT_CHARS) {
    return toolError(
      `prompt must be at most ${COURSEWARE_IMAGE_GENERATE_MAX_PROMPT_CHARS} characters`,
      'USAGE',
    );
  }

  const req = createAuthorizedRequest(caller);
  const conversationId = `codex-mcp-${session.mcpSessionId}`;
  const billingModel =
    process.env.OPENAI_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_GENERATE_CREDITS_SERVICE_CODE;
  try {
    await ensureDataSource();

    // Validate courseware write access before consuming credits.
    const cw = await getCoursewareEntityById(session.coursewareId);
    if (!cw) {
      return toolError(`Courseware missing: ${session.coursewareId}`, 'NOT_FOUND');
    }
    try {
      await assertCoursewareRequestAccess(caller, cw, 'write');
    } catch (error) {
      if (error instanceof CoursewareOrgAccessError) {
        return toolError('Forbidden: no write access to this courseware', 'FORBIDDEN');
      }
      throw error;
    }
    if (!cw.orgId?.trim() && !session.coursewareOrgId?.trim()) {
      return toolError('Courseware org_id is not set', 'USAGE');
    }

    // Bill first: refuse OpenAI/OSS work when credits preauth fails.
    const preauth = await preauthImageGenerateCredits({
      session: caller,
      model: billingModel,
      coursewareOrgId: session.coursewareOrgId ?? cw.orgId,
      coursewareId: session.coursewareId,
      conversationId,
    });
    if (preauth.kind === 'failed') {
      return toolError(`Image credits preauth failed: ${preauth.error}`, 'CREDITS_FAILED');
    }

    let result;
    try {
      result = await runCoursewareImageGenerate(req, caller, {
        prompt,
        courseware_id: session.coursewareId,
        courseware_org_id: session.coursewareOrgId ?? undefined,
        ...(args.size?.trim() ? { size: args.size.trim() } : {}),
        ...(args.quality?.trim() ? { quality: args.quality.trim() } : {}),
        ...(args.file_name?.trim() ? { file_name: args.file_name.trim() } : {}),
      });
    } catch (error) {
      if (preauth.kind === 'charged') {
        console.warn(
          `[credits] image generate preauth charged but generation failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      throw error;
    }

    const billing = await settleImageGenerateCredits({
      session: caller,
      usage: result.usage,
      model: result.model,
      coursewareOrgId: result.orgId,
      coursewareId: result.coursewareId,
      conversationId,
      preauthTokens: preauth.preauthTokens,
    });
    if (billing.kind === 'failed') {
      return toolError(
        `Image generated but credits settlement failed: ${billing.error}`,
        'CREDITS_FAILED',
      );
    }

    const creditsImage =
      billing.kind === 'charged'
        ? {
            serviceCode: billing.result.serviceCode,
            creditsConsumed: billing.result.creditsConsumed,
            remainingCredits: billing.result.remainingCredits,
          }
        : preauth.kind === 'charged'
          ? {
              serviceCode: preauth.result.serviceCode,
              creditsConsumed: preauth.result.creditsConsumed,
              remainingCredits: preauth.result.remainingCredits,
            }
          : undefined;

    return {
      ok: true,
      data: {
        ...slimAsset(result.asset),
        model: result.model,
        size: result.size,
        quality: result.quality,
        next: 'FALLBACK path only. Preferred: Codex generates the image → courseware_asset_upload { content_base64, file_name } → ainobi_exec element insert --type image --set source=<file_url>.',
      },
      ...(creditsImage ? { creditsImage } : {}),
    };
  } catch (error) {
    if (error instanceof AinobiCliError) {
      return toolError(error.message, error.code);
    }
    if (error instanceof CoursewareOrgAccessError) {
      return toolError('Forbidden: no write access to this courseware', 'FORBIDDEN');
    }
    if (error instanceof CoursewareAssetUploadFinalizeError) {
      return toolError(error.message, 'ASSET_UPLOAD_FAILED');
    }
    return toolError(error instanceof Error ? error.message : String(error), 'IMAGE_GENERATE_FAILED');
  }
}

export async function coursewareAssetsListTool(
  caller: AinobiAuthorizedSession,
  args: {
    mcp_session_id?: string;
    page_number?: number;
    page_size?: number;
    file_name?: string;
    order?: 'asc' | 'desc';
  },
): Promise<Record<string, unknown>> {
  const session = await requireOwnedSession(caller, args.mcp_session_id);
  if (isToolError(session)) {
    return session;
  }

  await ensureDataSource();
  const cw = await getCoursewareEntityById(session.coursewareId);
  if (!cw) {
    return toolError(`Courseware missing: ${session.coursewareId}`, 'NOT_FOUND');
  }
  try {
    await assertCoursewareRequestAccess(caller, cw, 'write');
  } catch (error) {
    if (error instanceof CoursewareOrgAccessError) {
      return toolError('Forbidden: no write access to this courseware', 'FORBIDDEN');
    }
    throw error;
  }

  const pageNumber = Math.max(1, Math.floor(args.page_number ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(args.page_size ?? 20)));
  const result = await listCoursewareAssets({
    coursewareId: session.coursewareId,
    pageNumber,
    pageSize,
    order: args.order === 'asc' ? 'asc' : 'desc',
    ...(args.file_name?.trim() ? { fileName: args.file_name.trim() } : {}),
  });

  return {
    ok: true,
    data: {
      courseware_id: session.coursewareId,
      items: result.data.map((a) => slimAsset(a)),
      pagination: result.pagination,
      next: 'Use source/file_url on image/pdf/html elements; pass file_id to courseware_doc_read for documents.',
    },
  };
}

export async function coursewareAssetsUploadTool(
  caller: AinobiAuthorizedSession,
  args: {
    mcp_session_id?: string;
    file_name?: string;
    content_base64?: string;
    workspace_path?: string;
  },
): Promise<Record<string, unknown>> {
  const session = await requireOwnedSession(caller, args.mcp_session_id);
  if (isToolError(session)) {
    return session;
  }

  const fileName = args.file_name?.trim() || basename(args.workspace_path?.trim() || '') || '';
  if (!fileName) {
    return toolError('file_name is required (or derive from workspace_path)', 'USAGE');
  }

  let extension: string;
  try {
    extension = normalizeAssetExtension(extname(fileName));
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error), 'USAGE');
  }
  if (!SUPPORTED_COURSEWARE_ASSET_EXTENSIONS.has(extension)) {
    return toolError(
      `Unsupported extension ${extension}. Supported: ${[...SUPPORTED_COURSEWARE_ASSET_EXTENSIONS].join(', ')}`,
      'USAGE',
    );
  }

  let buffer: Buffer | null = null;
  let tmpOwned: string | null = null;
  let tmpFilePath: string;

  try {
    // Re-check write access before any upload work (covers content_base64 that used to skip hydrate).
    const accessErr = await ensureHydratedWorkspace(caller, session);
    if (accessErr) {
      return accessErr;
    }

    if (args.content_base64?.trim()) {
      buffer = decodeBase64Payload(args.content_base64, MAX_MCP_UPLOAD_BYTES);
      if (!buffer) {
        return toolError(
          `content_base64 is invalid or exceeds ${MAX_MCP_UPLOAD_BYTES} bytes`,
          'USAGE',
        );
      }
      const tmpDir = await mkdtemp(join(tmpdir(), 'ainobi-mcp-upload-'));
      tmpOwned = tmpDir;
      tmpFilePath = join(tmpDir, `upload${extension}`);
      await writeFile(tmpFilePath, buffer);
    } else if (args.workspace_path?.trim()) {
      const abs = resolveWorkspaceRelativePath(session.workspaceDir, args.workspace_path);
      if (!abs) {
        return toolError(
          'workspace_path must be relative to the MCP workspace and cannot contain ..',
          'USAGE',
        );
      }
      buffer = await readFile(abs);
      if (buffer.length > MAX_MCP_UPLOAD_BYTES * 5) {
        return toolError(
          `workspace file exceeds ${MAX_MCP_UPLOAD_BYTES * 5} bytes`,
          'USAGE',
        );
      }
      tmpFilePath = abs;
    } else {
      return toolError('Provide content_base64 or workspace_path', 'USAGE');
    }

    const contentMd5 = createHash('md5').update(buffer).digest('hex');
    const req = createAuthorizedRequest(caller);
    const orgId = session.coursewareOrgId?.trim();
    if (!orgId) {
      return toolError('Courseware org_id is not set on MCP session', 'ORG_REQUIRED');
    }

    await ensureDataSource();
    const finalized = await finalizeCoursewareAssetUpload({
      req,
      coursewareId: session.coursewareId,
      coursewareOrgId: orgId,
      fileName: fileName.slice(0, 255),
      contentMd5,
      extension,
      fileSize: buffer.length,
      tmpFilePath,
    });

    return {
      ok: true,
      data: {
        ...slimAsset(finalized.asset),
        upload: finalized.upload,
        next: 'Use source/file_url on image/pdf/html elements or quiz media; pass file_id to courseware_doc_read for documents.',
      },
    };
  } catch (error) {
    if (error instanceof CoursewareOrgAccessError) {
      return toolError('Forbidden: no write access to this courseware', 'FORBIDDEN');
    }
    if (error instanceof CoursewareAssetUploadFinalizeError) {
      return toolError(error.message, 'ASSET_UPLOAD_FAILED');
    }
    return toolError(error instanceof Error ? error.message : String(error), 'ASSET_UPLOAD_FAILED');
  } finally {
    if (tmpOwned) {
      await rm(tmpOwned, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export async function coursewareDocReadTool(
  caller: AinobiAuthorizedSession,
  args: {
    mcp_session_id?: string;
    file_id?: string;
    content_base64?: string;
    file_name?: string;
    file_extension?: string;
    llm_prompt?: string;
    no_llm?: boolean;
  },
): Promise<Record<string, unknown>> {
  const session = await requireOwnedSession(caller, args.mcp_session_id);
  if (isToolError(session)) {
    return session;
  }

  await ensureDataSource();
  const cw = await getCoursewareEntityById(session.coursewareId);
  if (!cw) {
    return toolError(`Courseware missing: ${session.coursewareId}`, 'NOT_FOUND');
  }
  try {
    await assertCoursewareRequestAccess(caller, cw, 'write');
  } catch (error) {
    if (error instanceof CoursewareOrgAccessError) {
      return toolError('Forbidden: no write access to this courseware', 'FORBIDDEN');
    }
    throw error;
  }

  let buffer: Buffer;
  let extension: string;
  let sourceLabel: string;

  const fileId = args.file_id?.trim();
  if (fileId) {
    if (!UUID_RE.test(fileId)) {
      return toolError(
        'file_id must be a valid UUID (library files expose file_id, not the display name)',
        'USAGE',
      );
    }
    const asset = await findCoursewareAssetByFileId(session.coursewareId, fileId);
    if (!asset) {
      return toolError(`Unknown file_id for this courseware: ${fileId}`, 'NOT_FOUND');
    }
    const objectKey = asset.filePath?.trim().replace(/^\/+/, '') ?? '';
    if (!objectKey) {
      return toolError('Asset has no storage path', 'NOT_FOUND');
    }
    const limit = maxMcpDocReadBytes();
    if (typeof asset.fileSize === 'number' && asset.fileSize > limit) {
      return toolError(`File exceeds ${limit} byte limit`, 'USAGE');
    }
    buffer = await readCoursewareAssetBytes(objectKey, limit);
    extension = normalizeDocReadExtension(
      args.file_extension?.trim() || extensionFromPath(asset.fileName) || '',
    );
    sourceLabel = asset.fileName;
  } else if (args.content_base64?.trim()) {
    const decoded = decodeBase64Payload(args.content_base64, MAX_MCP_UPLOAD_BYTES);
    if (!decoded) {
      return toolError(
        `content_base64 is invalid or exceeds ${MAX_MCP_UPLOAD_BYTES} bytes`,
        'USAGE',
      );
    }
    buffer = decoded;
    extension = normalizeDocReadExtension(
      args.file_extension?.trim() ||
        extensionFromPath(args.file_name?.trim() || '') ||
        '',
    );
    sourceLabel = args.file_name?.trim() || `upload.${extension || 'bin'}`;
  } else {
    return toolError('Provide file_id or content_base64', 'USAGE');
  }

  if (!extension || !isDocReadExtensionSupported(extension)) {
    return toolError(
      `Unsupported doc extension "${extension || '(empty)'}". Use a library file_id or pass file_extension.`,
      'USAGE',
    );
  }

  try {
    const converted = await convertBufferToMarkdown(buffer, {
      file_extension: extension,
      ...(args.llm_prompt?.trim() ? { llm_prompt: args.llm_prompt.trim() } : {}),
      use_llm_for_images: args.no_llm !== true,
    });
    return {
      ok: true,
      data: {
        title: converted.title,
        markdown: converted.markdown,
        llm_used: converted.llm_used,
        source: sourceLabel,
        bytes: buffer.length,
        extension,
      },
    };
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error), 'DOC_READ_FAILED');
  }
}

export async function coursewareTtsListTool(
  caller: AinobiAuthorizedSession,
  args: {
    mcp_session_id?: string;
    org_id?: string;
    provider?: string;
    language?: string;
    status?: string;
  },
): Promise<Record<string, unknown>> {
  let mcpSession: CodexMcpWorkspaceSession | undefined;
  if (args.mcp_session_id?.trim()) {
    const session = await requireOwnedSession(caller, args.mcp_session_id);
    if (isToolError(session)) {
      return session;
    }
    mcpSession = session;
  }

  const catalogOrg = resolveCatalogOrgIdForMcpSession({
    mcpSession,
    requestedOrgId: args.org_id,
    callerOrgId: caller.currentOrgId,
  });
  if (!catalogOrg.ok) {
    return catalogOrg.error;
  }
  const requestedOrgId = catalogOrg.orgIdRaw;
  const orgId = normalizeOrgId(requestedOrgId);
  if (!orgId) {
    return toolError('org_id is required', 'ORG_REQUIRED');
  }

  try {
    // Catalog read: member org for humans; same-org for Org Agent.
    await assertOrgIdAccess(caller, requestedOrgId);
  } catch (error) {
    if (error instanceof CoursewareOrgAccessError) {
      return toolError('Forbidden: cannot query TTS voices for this organization', 'FORBIDDEN');
    }
    return toolError(error instanceof Error ? error.message : String(error), 'FORBIDDEN');
  }

  try {
    const result = await fetchOrgTtsFromPlatform(caller.accessToken, orgId, {
      fetchAllPages: true,
      ...(args.provider?.trim() ? { ttsProvider: args.provider.trim() } : {}),
      ...(args.language?.trim() ? { ttsLanguage: args.language.trim() } : {}),
      ttsStatus: args.status?.trim() || 'active',
    });
    if (mcpSession) {
      const hydrateErr = await ensureHydratedWorkspace(caller, mcpSession);
      if (hydrateErr) {
        return hydrateErr;
      }
      // Persist full voice rows (incl. tts_voice) so courseware_narration --tts-id resolves.
      await patchSessionNarrationCatalogs({
        stateDir: mcpSession.stateDir,
        shellSession: mcpSession.shellSession,
        ttsVoices: [...result.voices],
      });
    }
    const items = result.voices.map((v) => ({
      tts_id: v.tts_id,
      tts_name: v.tts_name,
      tts_provider: v.tts_provider,
      tts_language: v.tts_language ?? null,
      tts_model: v.tts_model ?? null,
    }));
    return {
      ok: true,
      data: {
        source: 'platform',
        org_id: result.orgId,
        count: items.length,
        total_count: result.totalCount,
        empty_catalog: items.length === 0,
        catalog_saved: Boolean(mcpSession),
        items,
        next: 'Prefer courseware_ai_teachers for narration (teacher binds a voice). Use --tts-id on courseware_narration only when overriding voice; --tts-style overrides the delivery style (recommended key or concise custom English description, <=200 chars).',
      },
    };
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error), 'TTS_LIST_FAILED');
  }
}
