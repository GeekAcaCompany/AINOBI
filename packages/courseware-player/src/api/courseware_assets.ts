// SPDX-License-Identifier: AGPL-3.0-only
import { coursewareApi } from "../host/requester.ts";
import { translate, type SupportedLanguage } from "../lib/i18n/index.ts";
import { resolveInitialUiLanguage } from "../lib/i18n/ui-language-preference.ts";
import {
  uploadCoursewareAssetChunked,
  type ChunkedCoursewareAssetUploadOptions,
  type CoursewareAssetUploadProgress,
} from "../lib/courseware/chunked-asset-upload.ts";
import { isCoursewareAssetPresignEnabled } from "../lib/courseware/asset-presign-enabled.ts";
import { fileWithSanitizedAssetName } from "../lib/courseware/sanitize-asset-filename.ts";
import type { TTSGenerateUrlResponse } from "../schemas/tts.ts";
import type { PaginationInfo } from "@ainobi/web-kit/schemas/response/common";
import {
  COURSEWARE_ASSET_ACCEPTED_EXTENSIONS,
  extractCoursewareAssetFilePath,
  stripCoursewareAssetSignatureFromUrl,
  type CoursewareAssetExtension,
  type CoursewareAssetFileArtifactMetadata,
  type CoursewareAssetItem,
  type CoursewareAssetKindFilter,
  type ListCoursewareAssetsParams,
  type ListCoursewareAssetsResponse,
  type UploadCoursewareAssetResponse,
} from "./courseware.ts";

/** File name prefix used when the preview page uploads quiz answer recordings (assets stored here by mistake in the past must be hidden from the asset library). */
export const QUIZ_ANSWER_RECORDING_FILE_NAME_PREFIX = "quiz-answer.";

export function isQuizAnswerRecordingAsset(
  asset: Pick<CoursewareAssetItem, "name">,
): boolean {
  return asset.name.trim().toLowerCase().startsWith(QUIZ_ANSWER_RECORDING_FILE_NAME_PREFIX);
}

/**
 * Courseware assets: talks to courseware-service
 * Chunked direct upload to OSS: `upload/init` → `upload/chunk` (each chunk uploadPart'ed immediately) → `upload/complete` (merge + store)
 * `POST /courseware/assets/upload` stays for single multipart uploads from the CLI
 * (see courseware-service `services/courseware-assets-http.ts`)
 */

const IMAGE_EXTS = new Set<CoursewareAssetExtension>([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "svg",
  "tiff",
]);
const VIDEO_EXTS = new Set<CoursewareAssetExtension>(["mp4", "webm"]);
const AUDIO_EXTS = new Set<CoursewareAssetExtension>(["mp3", "aac", "wav", "ogg"]);
const HTML_EXTS = new Set<CoursewareAssetExtension>(["html"]);
const PPT_EXTS = new Set<CoursewareAssetExtension>(["pdf", "pptx"]);

/** webm/mp4 are shared audio/video containers: microphone recordings upload with an audio/* MIME and should count as audio, not video. */
export function isAudioContainerAsset(
  extension: CoursewareAssetExtension,
  mimeType?: string,
): boolean {
  return (
    (extension === "webm" || extension === "mp4") &&
    !!mimeType?.toLowerCase().startsWith("audio/")
  );
}

function mapExtensionToAssetKindFilter(
  extension: CoursewareAssetExtension,
  mimeType?: string,
): CoursewareAssetKindFilter {
  if (isAudioContainerAsset(extension, mimeType)) return "audio";
  if (IMAGE_EXTS.has(extension)) return "image";
  if (VIDEO_EXTS.has(extension)) return "video";
  if (AUDIO_EXTS.has(extension)) return "audio";
  if (HTML_EXTS.has(extension)) return "html";
  if (PPT_EXTS.has(extension)) return "ppt";
  return "other";
}

function requireCoursewareId(
  coursewareId: string | undefined | null,
  // Callers with an explicit `language` contract pass it; the rest resolve the
  // current UI language at call time.
  language?: SupportedLanguage,
): string {
  const id = coursewareId?.trim();
  if (!id) {
    throw new Error(
      translate(language ?? resolveInitialUiLanguage(), "coursewareLib.assets.missingCoursewareId"),
    );
  }
  return id;
}

/** Same as the agent's `normalizeObjectKeyFromInput`, used to map the response `filePath` back to the original URL/path. */
function normalizeObjectKeyFromInput(value: string): string | null {
  return extractCoursewareAssetFilePath(value);
}

function resolveExtension(fileName: string): CoursewareAssetExtension | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  return COURSEWARE_ASSET_ACCEPTED_EXTENSIONS.includes(ext as CoursewareAssetExtension)
    ? (ext as CoursewareAssetExtension)
    : null;
}

type AgentAssetDto = {
  fileId: string;
  contentMd5?: string;
  coursewareId: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  filePath: string;
  fileUrl: string;
  fileArtifactUrl?: string | null;
  fileArtifactMetadata?: unknown;
  createdAt: string | null;
  updatedAt: string | null;
};

function normalizeFileArtifactMetadata(
  raw: unknown,
  extension: CoursewareAssetExtension,
): CoursewareAssetFileArtifactMetadata | null {
  if (extension !== "pdf" && extension !== "pptx") return null;
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const conv =
    o.conversion && typeof o.conversion === "object" ? (o.conversion as Record<string, unknown>) : null;
  const topSc = o.slide_count;
  const convSc = conv?.slide_count;
  let n: number | null = null;
  if (typeof topSc === "number" && Number.isFinite(topSc)) n = topSc;
  else if (typeof convSc === "number" && Number.isFinite(convSc)) n = convSc;
  if (n == null || n < 1) return null;
  const slideCount = Math.floor(n);
  const kindRaw = o.kind;
  const kind: "pdf" | "pptx" =
    kindRaw === "pdf" || kindRaw === "pptx" ? kindRaw : extension === "pdf" ? "pdf" : "pptx";
  return {
    slide_count: slideCount,
    kind,
    ...(conv ? { conversion: conv } : {}),
  };
}

function mapAgentDtoToItem(row: AgentAssetDto): CoursewareAssetItem | null {
  const extension = resolveExtension(row.fileName);
  if (!extension) return null;
  return {
    id: row.fileId,
    contentMd5: row.contentMd5,
    name: row.fileName,
    url: row.fileUrl || row.filePath,
    fileArtifactUrl: row.fileArtifactUrl ?? null,
    fileArtifactMetadata: normalizeFileArtifactMetadata(row.fileArtifactMetadata, extension),
    extension,
    mimeType: row.contentType || "application/octet-stream",
    size: row.fileSize,
    createdAt: row.createdAt || row.updatedAt || "",
  };
}

function toPaginationInfo(p: {
  pageNumber: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}): PaginationInfo {
  return {
    page_number: p.pageNumber,
    page_size: p.pageSize,
    total_count: p.totalCount,
    total_pages: p.totalPages,
    has_next_page: p.hasNextPage,
    has_previous_page: p.hasPreviousPage,
  };
}

let listAllCacheCoursewareId: string | null = null;
let listAllCacheItems: CoursewareAssetItem[] | null = null;
let listAllCacheAt = 0;
let listAllInflight: Promise<CoursewareAssetItem[]> | null = null;

const LIST_ALL_CACHE_TTL_MS = 12_000;

/** Called on upload / delete / when the list must be refreshed, so `asset_kind` client-side paging doesn't read a stale full list. */
export function invalidateCoursewareAssetsListCache(): void {
  listAllCacheCoursewareId = null;
  listAllCacheItems = null;
  listAllCacheAt = 0;
  listAllInflight = null;
}

async function fetchListPageFromAgent(params: {
  coursewareId: string;
  pageNumber: number;
  pageSize: number;
  fileName?: string;
  order: "asc" | "desc";
  signal?: AbortSignal;
}): Promise<ListCoursewareAssetsResponse> {
  type ListJson = {
    ok?: boolean;
    error?: string;
    data?: AgentAssetDto[];
    pagination?: {
      pageNumber: number;
      pageSize: number;
      totalCount: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
  };
  const json = (await coursewareApi.post(
    "/courseware/assets/list",
    {
      coursewareId: params.coursewareId,
      pageNumber: params.pageNumber,
      pageSize: params.pageSize,
      ...(params.fileName?.trim() ? { fileName: params.fileName.trim() } : {}),
      order: params.order,
    },
    { signal: params.signal, responseShape: "agent" },
  )) as ListJson;
  if (json.ok === false) {
    throw new Error(
      typeof json.error === "string"
        ? json.error
        : translate(resolveInitialUiLanguage(), "coursewareLib.assets.listFailed"),
    );
  }
  const rows = Array.isArray(json.data) ? json.data : [];
  const data = rows.map(mapAgentDtoToItem).filter((a): a is CoursewareAssetItem => a !== null);
  const p = json.pagination;
  if (!p) {
    return {
      data,
      pagination: toPaginationInfo({
        pageNumber: params.pageNumber,
        pageSize: params.pageSize,
        totalCount: data.length,
        totalPages: data.length === 0 ? 0 : 1,
        hasNextPage: false,
        hasPreviousPage: params.pageNumber > 1,
      }),
    };
  }
  return {
    data,
    pagination: toPaginationInfo({
      pageNumber: p.pageNumber,
      pageSize: p.pageSize,
      totalCount: p.totalCount,
      totalPages: p.totalPages,
      hasNextPage: p.hasNextPage,
      hasPreviousPage: p.hasPreviousPage,
    }),
  };
}

async function fetchAllCoursewareAssets(
  coursewareId: string,
  signal?: AbortSignal,
): Promise<CoursewareAssetItem[]> {
  const now = Date.now();
  if (
    listAllCacheCoursewareId === coursewareId &&
    listAllCacheItems &&
    now - listAllCacheAt < LIST_ALL_CACHE_TTL_MS
  ) {
    return listAllCacheItems;
  }
  if (listAllInflight) {
    return listAllInflight;
  }
  const run = (async () => {
    const out: CoursewareAssetItem[] = [];
    let pageNumber = 1;
    const pageSize = 100;
    while (true) {
      const page = await fetchListPageFromAgent({
        coursewareId,
        pageNumber,
        pageSize,
        order: "desc",
        signal,
      });
      out.push(...page.data);
      if (!page.pagination.has_next_page) break;
      pageNumber += 1;
      if (pageNumber > 500) break;
    }
    listAllCacheCoursewareId = coursewareId;
    listAllCacheItems = out;
    listAllCacheAt = Date.now();
    return out;
  })();
  listAllInflight = run;
  try {
    return await run;
  } finally {
    if (listAllInflight === run) {
      listAllInflight = null;
    }
  }
}

async function listAssetsWithKindClientPagination(
  coursewareId: string,
  params: ListCoursewareAssetsParams,
): Promise<ListCoursewareAssetsResponse> {
  const kind = params.asset_kind;
  if (!kind) {
    throw new Error("listAssetsWithKindClientPagination: asset_kind required");
  }
  const all = await fetchAllCoursewareAssets(coursewareId);
  const filtered = all.filter((a) => mapExtensionToAssetKindFilter(a.extension, a.mimeType) === kind);
  const pageSize = Math.max(1, Math.min(100, params.page_size ?? 20));
  const pageNumber = Math.max(1, params.page_number ?? 1);
  const total = filtered.length;
  const skip = (pageNumber - 1) * pageSize;
  const slice = filtered.slice(skip, skip + pageSize);
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  return {
    data: slice,
    pagination: toPaginationInfo({
      pageNumber,
      pageSize,
      totalCount: total,
      totalPages,
      hasNextPage: pageNumber * pageSize < total,
      hasPreviousPage: pageNumber > 1,
    }),
  };
}

async function listAssets(params: ListCoursewareAssetsParams): Promise<ListCoursewareAssetsResponse> {
  const coursewareId = requireCoursewareId(params.courseware_id);

  if (params.asset_kind) {
    return listAssetsWithKindClientPagination(coursewareId, params);
  }

  const pageSize = Math.max(1, Math.min(100, params.page_size ?? 20));
  const pageNumber = Math.max(1, params.page_number ?? 1);
  return fetchListPageFromAgent({
    coursewareId,
    pageNumber,
    pageSize,
    fileName: params.file_name,
    order: params.order ?? "desc",
  });
}

export type UploadCoursewareAssetOptions = Pick<
  ChunkedCoursewareAssetUploadOptions,
  "onProgress" | "signal" | "language"
>;

async function uploadAsset(
  coursewareId: string,
  file: File,
  options?: UploadCoursewareAssetOptions,
): Promise<UploadCoursewareAssetResponse> {
  const cwId = requireCoursewareId(coursewareId, options?.language ?? "zh");
  // Clean invalid characters such as `[` `]`, so AI @mentions can still resolve the file_id
  const uploadFile = fileWithSanitizedAssetName(file);
  const extension = resolveExtension(uploadFile.name);
  if (!extension) {
    throw new Error(`Unsupported file type: ${uploadFile.name}`);
  }
  // Decode images first to validate them: an undecodable file (bad CRC / fake extension) would upload successfully and then show only
  // a blank thumbnail tile with no feedback to the user (red team F4). Fail fast before uploading.
  if (IMAGE_EXTS.has(extension) && extension !== "svg") {
    try {
      const bitmap = await createImageBitmap(uploadFile);
      bitmap.close();
    } catch {
      throw new Error(
        translate(resolveInitialUiLanguage(), "coursewareLib.assets.imageUndecodable"),
      );
    }
  }

  const { assetDto, file_path } = await uploadCoursewareAssetChunked({
    coursewareId: cwId,
    file: uploadFile,
    onProgress: options?.onProgress,
    signal: options?.signal,
    language: options?.language,
  });
  const asset = mapAgentDtoToItem(assetDto);
  if (!asset) {
    throw new Error(`Unsupported file type: ${assetDto.fileName}`);
  }
  invalidateCoursewareAssetsListCache();
  return { asset, file_path };
}

async function deleteAsset(coursewareId: string, fileId: string): Promise<void> {
  const cwId = requireCoursewareId(coursewareId);
  type DelJson = { ok?: boolean; error?: string };
  const json = (await coursewareApi.post(
    "/courseware/assets/delete",
    {
      coursewareId: cwId,
      fileId: fileId.trim(),
    },
    { responseShape: "agent" },
  )) as DelJson;
  if (json.ok === false) {
    throw new Error(
      typeof json.error === "string"
        ? json.error
        : translate(resolveInitialUiLanguage(), "coursewareLib.assets.deleteFailed"),
    );
  }
  invalidateCoursewareAssetsListCache();
}

const BATCH_PRESIGN_MAX_PATHS = 100;

export type OssPresignNetwork = "public" | "internal";

/**
 * `network: "internal"`: the OSS branch's signed URLs use the region's internal host (reachable only from Aliyun ECS/FC in the same region).
 * Only for the FC headless render page (headless courseware-renderer) when fetching scene assets;
 * a real user browser must never pass "internal" (the internal host is unreachable from the internet, so assets would simply fail to load).
 */
async function batchPresignUrls(
  coursewareId: string | undefined,
  urlsOrPaths: string[],
  expiresIn?: number,
  network?: OssPresignNetwork,
  renderToken?: string,
): Promise<Record<string, string>> {
  if (!isCoursewareAssetPresignEnabled()) return {};

  // coursewareId omitted = signing default assets without a courseware context (agent publicOnlyMode: only the
  // PUBLIC_BY_DESIGN prefixes pass — default teacher models / default avatars); with an id the behavior is unchanged.
  const cwId = coursewareId?.trim() || "";

  const originals = urlsOrPaths.map((v) => v.trim()).filter(Boolean);
  // Send the original URLs/keys (no client-side key folding): the server decides from the input host evidence whether to echo the public
  // URL or presign — folding into bare keys would lose the evidence of "which bucket the bytes are in", and objects from the aliyun era
  // would be wrongly signed against the OCI private bucket (a correct signature that 404s). Overlong signed URLs fall back to the key form,
  // so the server's filePaths max(512) validation isn't triggered.
  const filePaths = [
    ...new Set(
      originals.map((v) =>
        v.length > 512 ? ((normalizeObjectKeyFromInput(v) ?? v) as string) : v,
      ),
    ),
  ];
  if (filePaths.length === 0) return {};

  const signedByKey = new Map<string, string>();
  for (let i = 0; i < filePaths.length; i += BATCH_PRESIGN_MAX_PATHS) {
    const chunk = filePaths.slice(i, i + BATCH_PRESIGN_MAX_PATHS);
    type PresignJson = {
      ok?: boolean;
      error?: string;
      items?: { filePath: string; fileUrl: string }[];
    };
    const json = (await coursewareApi.post(
      "/courseware/assets/batch_presign_urls",
      {
        ...(cwId ? { coursewareId: cwId } : {}),
        filePaths: chunk,
        ...(typeof expiresIn === "number" ? { expiresIn } : {}),
        ...(network ? { network } : {}),
        ...(renderToken ? { render_token: renderToken } : {}),
      },
      {
        responseShape: "agent",
        // Headless renderer has no user session; render_token carries narrow presign auth.
        ...(renderToken ? { authRequired: false } : {}),
      },
    )) as PresignJson;
    if (json.ok === false) {
      throw new Error(
        typeof json.error === "string"
          ? json.error
          : translate(resolveInitialUiLanguage(), "coursewareLib.assets.presignFailed"),
      );
    }
    for (const item of json.items ?? []) {
      if (!item?.filePath || !item?.fileUrl) continue;
      signedByKey.set(item.filePath, item.fileUrl);
      const normalized = normalizeObjectKeyFromInput(item.filePath);
      if (normalized) signedByKey.set(normalized, item.fileUrl);
    }
  }

  const signedByOriginal: Record<string, string> = {};
  for (const original of originals) {
    const key = normalizeObjectKeyFromInput(original);
    if (!key) continue;
    const signed = signedByKey.get(key);
    if (!signed) continue;
    signedByOriginal[original] = signed;
    const unsigned = stripCoursewareAssetSignatureFromUrl(original);
    if (unsigned !== original) signedByOriginal[unsigned] = signed;
  }
  return signedByOriginal;
}

/** Server-side read of a small HTML asset (bypasses OSS CORS for iframe autofit). */
async function readAssetText(
  coursewareId: string,
  filePath: string,
  options?: { sectionId?: string },
): Promise<string> {
  const cwId = requireCoursewareId(coursewareId);
  const trimmed = filePath.trim();
  if (!trimmed) {
    throw new Error("Missing file path.");
  }
  // sectionId admits enrolled non-members at the courseware-service org guard
  // (public-course external students, issue #825).
  const sectionId = options?.sectionId?.trim();
  type ReadTextJson = { ok?: boolean; error?: string; text?: string };
  const json = (await coursewareApi.post(
    "/courseware/assets/read_text",
    { coursewareId: cwId, filePath: trimmed },
    {
      responseShape: "agent",
      ...(sectionId ? { query: { sectionId } } : {}),
    },
  )) as ReadTextJson;
  if (json.ok === false || typeof json.text !== "string") {
    throw new Error(
      typeof json.error === "string"
        ? json.error
        : translate(resolveInitialUiLanguage(), "coursewareLib.assets.readHtmlFailed"),
    );
  }
  return json.text;
}

export type SynthesizeAiTeacherTtsParams = {
  text: string;
  aiTeacherId: string;
  /** Optional: platform TTS catalog id, overriding the teacher's default voice */
  ttsId?: string;
  /** Optional: narration style key (a recommended preset or a style catalog key), effective for Google TTS */
  ttsStyle?: string;
  speechRate?: number;
  format?: string;
  /** Preferred: with a courseware ID the server resolves the org from the courseware; coursewareOrgId is allowed only without a courseware (player etc.) */
  coursewareId?: string;
  coursewareOrgId?: string;
  courseId?: string | null;
  conversationId?: string;
  /** Pronunciation dictionary preview: tone rules injected for one synthesis (taking priority over the organization dictionary's entry with the same source) */
  pronunciationOverride?: {
    sourceText: string;
    language: "zh" | "ja";
    pronunciation: string;
  };
};

/** Synthesize TTS for an AI teacher and upload it to OSS (courseware-service `POST /courseware/tts/synthesize`). */
export async function synthesizeAiTeacherTts(
  params: SynthesizeAiTeacherTtsParams,
): Promise<TTSGenerateUrlResponse & { duration_ms?: number }> {
  type SynthesizeJson = {
    ok?: boolean;
    error?: string;
    data?: {
      tts_url: string;
      object_key: string;
      format: string;
      content_type: string;
      duration_ms?: number;
    };
  };
  const override = params.pronunciationOverride;
  const json = (await coursewareApi.post(
    "/courseware/tts/synthesize",
    {
      text: params.text,
      format: params.format ?? "mp3",
      ai_teacher_id: params.aiTeacherId,
      speech_rate: params.speechRate ?? 1,
      ...(params.ttsId?.trim() ? { tts_id: params.ttsId.trim() } : {}),
      ...(params.ttsStyle?.trim() ? { tts_style: params.ttsStyle.trim() } : {}),
      ...(params.coursewareId?.trim() ? { courseware_id: params.coursewareId.trim() } : {}),
      // #65: with a courseware_id no org is passed; courseware_org_id is kept only without a courseware context
      ...(!params.coursewareId?.trim() && params.coursewareOrgId?.trim()
        ? { courseware_org_id: params.coursewareOrgId.trim() }
        : {}),
      ...(params.courseId ? { course_id: params.courseId } : {}),
      ...(params.conversationId?.trim()
        ? { conversation_id: params.conversationId.trim() }
        : {}),
      ...(override?.sourceText.trim() && override.pronunciation.trim()
        ? {
            pronunciation_override: {
              source_text: override.sourceText.trim(),
              language: override.language,
              pronunciation: override.pronunciation.trim(),
            },
          }
        : {}),
    },
    { responseShape: "agent" },
  )) as SynthesizeJson;
  if (json.ok === false || !json.data?.tts_url) {
    throw new Error(
      typeof json.error === "string"
        ? json.error
        : translate(resolveInitialUiLanguage(), "coursewareLib.assets.ttsFailed"),
    );
  }
  const data = json.data;
  return {
    tts_url: data.tts_url,
    object_key: data.object_key,
    format: data.format,
    content_type: data.content_type,
    ...(typeof data.duration_ms === "number" ? { duration_ms: data.duration_ms } : {}),
  };
}

export type GenerateCoursewareImageParams = {
  coursewareId: string;
  prompt: string;
  /** auto / 1024x1024 / 1536x1024 / 1024x1536 / custom WxH */
  size?: string;
  /** auto / low / medium / high */
  quality?: string;
  fileName?: string;
  coursewareOrgId?: string | null;
  conversationId?: string;
  /** UI language for user-facing error messages. Defaults to "zh". */
  language?: SupportedLanguage;
};

export type GenerateCoursewareImageResult = {
  asset: CoursewareAssetItem;
  model: string;
  size: string;
  quality: string;
};

/**
 * Text-to-image (gpt-image-2) stored as a courseware asset (courseware-service `POST /courseware/image/generate`).
 * Returns a signed asset item usable directly on the canvas/preview.
 */
async function generateImage(
  params: GenerateCoursewareImageParams,
): Promise<GenerateCoursewareImageResult> {
  const language = params.language ?? "zh";
  const cwId = requireCoursewareId(params.coursewareId, language);
  const prompt = params.prompt?.trim();
  if (!prompt) {
    throw new Error(translate(language, "coursewareEditor.imageGenerate.promptRequired"));
  }
  type GenerateJson = {
    ok?: boolean;
    error?: string;
    data?: {
      asset?: AgentAssetDto;
      model?: string;
      size?: string;
      quality?: string;
    };
  };
  const json = (await coursewareApi.post(
    "/courseware/image/generate",
    {
      prompt,
      ...(params.size?.trim() ? { size: params.size.trim() } : {}),
      ...(params.quality?.trim() ? { quality: params.quality.trim() } : {}),
      ...(params.fileName?.trim() ? { file_name: params.fileName.trim() } : {}),
      courseware_id: cwId,
      ...(params.conversationId?.trim() ? { conversation_id: params.conversationId.trim() } : {}),
    },
    { responseShape: "agent" },
  )) as GenerateJson;
  if (json.ok === false || !json.data?.asset) {
    throw new Error(
      typeof json.error === "string"
        ? json.error
        : translate(language, "coursewareEditor.imageGenerate.generateFailed"),
    );
  }
  const asset = mapAgentDtoToItem(json.data.asset);
  if (!asset) {
    throw new Error(translate(language, "coursewareEditor.imageGenerate.unsupportedResult"));
  }
  invalidateCoursewareAssetsListCache();

  // The raw OSS address needs a signature to be accessible; consistent with asset upload/selection.
  try {
    const signed = await batchPresignUrls(cwId, [asset.url]);
    const signedUrl = signed[asset.url];
    if (signedUrl) {
      asset.url = signedUrl;
    }
  } catch {
    // When signing fails, fall back to the original URL (signing may not be enabled in the deployment).
  }

  return {
    asset,
    model: json.data.model ?? "gpt-image-2",
    size: json.data.size ?? "auto",
    quality: json.data.quality ?? "auto",
  };
}

export type OptimizeCoursewareImagePromptParams = {
  prompt: string;
  coursewareId?: string;
  coursewareOrgId?: string | null;
  conversationId?: string;
  /** UI language for user-facing error messages. Defaults to "zh". */
  language?: SupportedLanguage;
};

export type OptimizeCoursewareImagePromptResult = {
  optimizedPrompt: string;
  model: string;
};

/**
 * Optimize an image generation prompt (courseware-service `POST /courseware/prompt/optimize`).
 */
async function optimizeImagePrompt(
  params: OptimizeCoursewareImagePromptParams,
): Promise<OptimizeCoursewareImagePromptResult> {
  const language = params.language ?? "zh";
  const prompt = params.prompt?.trim();
  if (!prompt) {
    throw new Error(translate(language, "coursewareEditor.imageGenerate.optimizePromptRequired"));
  }
  type OptimizeJson = {
    ok?: boolean;
    error?: string;
    data?: { optimized_prompt?: string; model?: string };
  };
  const json = (await coursewareApi.post(
    "/courseware/prompt/optimize",
    {
      prompt,
      ...(params.coursewareId?.trim() ? { courseware_id: params.coursewareId.trim() } : {}),
      ...(params.conversationId?.trim() ? { conversation_id: params.conversationId.trim() } : {}),
    },
    { responseShape: "agent" },
  )) as OptimizeJson;
  if (json.ok === false || !json.data?.optimized_prompt?.trim()) {
    throw new Error(
      typeof json.error === "string"
        ? json.error
        : translate(language, "coursewareEditor.imageGenerate.optimizeFailed"),
    );
  }
  return {
    optimizedPrompt: json.data.optimized_prompt.trim(),
    model: json.data.model ?? "",
  };
}

const coursewareAssetsApi = {
  listAssets,
  uploadAsset,
  deleteAsset,
  batchPresignUrls,
  readAssetText,
  synthesizeAiTeacherTts,
  generateImage,
  optimizeImagePrompt,
};

export default coursewareAssetsApi;
export type { CoursewareAssetUploadProgress };
