// SPDX-License-Identifier: AGPL-3.0-only
import SparkMD5 from "spark-md5";

import config from "../../host/config.ts";
import { translate, type SupportedLanguage } from "../i18n/index.ts";
import sessionManager from "../../host/session-manager.ts";
import { safeLocalStorageSetItem } from "../safe-storage.ts";
const RESUME_STORAGE_PREFIX = "cw-chunk-upload:";

class ChunkedUploadApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly resetAll = false,
  ) {
    super(message);
    this.name = "ChunkedUploadApiError";
  }
}

function isStaleUploadErrorMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("upload does not exist") ||
    m.includes("upload id may be invalid") ||
    m.includes("specified key does not exist") ||
    m.includes("upload session expired") ||
    m.includes("session expired") ||
    m.includes("session not found") ||
    m.includes("staging object missing") ||
    m.includes("please re-upload") ||
    m.includes("re-upload the file") ||
    m.includes("re-upload all chunks")
  );
}

function isStaleUploadError(error: unknown): boolean {
  if (error instanceof ChunkedUploadApiError) {
    if (error.status === 410 || error.status === 404 || error.resetAll) return true;
    return isStaleUploadErrorMessage(error.message);
  }
  if (error instanceof Error) return isStaleUploadErrorMessage(error.message);
  return isStaleUploadErrorMessage(String(error));
}

async function abortRemoteUpload(
  uploadId: string,
  token: string,
  language: SupportedLanguage,
): Promise<void> {
  try {
    await agentJsonPost("/courseware/assets/upload/abort", { uploadId }, token, language);
  } catch {
    // ignore
  }
}

export type CoursewareAssetUploadPhase = "uploading" | "completing";

export type CoursewareAssetUploadProgress = {
  phase: CoursewareAssetUploadPhase;
  loaded: number;
  total: number;
  percent: number;
};

export type ChunkedCoursewareAssetUploadOptions = {
  coursewareId: string;
  file: File;
  onProgress?: (progress: CoursewareAssetUploadProgress) => void;
  signal?: AbortSignal;
  /** UI language for user-facing error messages (backend `error` strings pass through). Defaults to "zh". */
  language?: SupportedLanguage;
};

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

type InitResponse = {
  ok?: boolean;
  error?: string;
  uploadId?: string;
  chunkSize?: number;
  totalChunks?: number;
  expiresAt?: string;
  deduped?: boolean;
  asset?: AgentAssetDto;
  upload?: { existed: boolean; cloned?: boolean; deduped?: boolean };
};

type StatusResponse = {
  ok?: boolean;
  error?: string;
  uploadId?: string;
  receivedChunks?: number[];
  totalChunks?: number;
  chunkSize?: number;
  expiresAt?: string;
};

type CompleteResponse = {
  ok?: boolean;
  error?: string;
  asset?: AgentAssetDto;
};

function coursewareApiBaseUrl(language: SupportedLanguage): string {
  const base = config.origin.coursewareApi?.trim();
  if (!base) {
    throw new Error(translate(language, "coursewareLib.upload.serviceNotConfigured"));
  }
  return base.replace(/\/+$/, "");
}

function resumeStorageKey(coursewareId: string, file: File): string {
  return `${RESUME_STORAGE_PREFIX}${coursewareId}:${file.name}:${file.size}:${file.lastModified}`;
};

type ResumeRecord = {
  uploadId: string;
  updatedAt: number;
};

function readResumeRecord(coursewareId: string, file: File): ResumeRecord | null {
  try {
    const raw = localStorage.getItem(resumeStorageKey(coursewareId, file));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResumeRecord;
    if (!parsed?.uploadId) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeResumeRecord(coursewareId: string, file: File, uploadId: string): void {
  try {
    const record: ResumeRecord = { uploadId, updatedAt: Date.now() };
    safeLocalStorageSetItem(resumeStorageKey(coursewareId, file), JSON.stringify(record));
  } catch {
    // localStorage may be unavailable
  }
}

function clearResumeRecord(coursewareId: string, file: File): void {
  try {
    localStorage.removeItem(resumeStorageKey(coursewareId, file));
  } catch {
    // ignore
  }
}

async function acquireAuthToken(language: SupportedLanguage): Promise<string> {
  const session = await sessionManager.acquireSession();
  const token = session.access_token?.trim();
  if (!token) {
    throw new Error(translate(language, "coursewareLib.upload.notLoggedInAsset"));
  }
  return token;
}

async function agentJsonPost<T>(
  path: string,
  body: unknown,
  token: string,
  language: SupportedLanguage,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${coursewareApiBaseUrl(language)}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  const json = (await response.json()) as T & {
    ok?: boolean;
    error?: string;
    resetAll?: boolean;
  };
  if (!response.ok || json.ok === false) {
    throw new ChunkedUploadApiError(
      typeof json.error === "string"
        ? json.error
        : translate(language, "coursewareLib.upload.requestFailed", { status: response.status }),
      response.status,
      json.resetAll === true,
    );
  }
  return json;
}

async function agentJsonGet<T>(
  path: string,
  token: string,
  language: SupportedLanguage,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${coursewareApiBaseUrl(language)}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  const json = (await response.json()) as T & { ok?: boolean; error?: string };
  if (!response.ok || json.ok === false) {
    throw new Error(
      typeof json.error === "string"
        ? json.error
        : translate(language, "coursewareLib.upload.requestFailed", { status: response.status }),
    );
  }
  return json;
}

function postMultipartWithProgress(
  path: string,
  form: FormData,
  token: string,
  onChunkLoaded: (loaded: number, total: number) => void,
  language: SupportedLanguage,
  signal?: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${coursewareApiBaseUrl(language)}${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    const abortHandler = (): void => {
      xhr.abort();
    };
    signal?.addEventListener("abort", abortHandler, { once: true });

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onChunkLoaded(event.loaded, event.total);
    };

    xhr.onerror = () => {
      signal?.removeEventListener("abort", abortHandler);
      reject(new Error(translate(language, "coursewareLib.upload.chunkNetworkError")));
    };

    xhr.onload = () => {
      signal?.removeEventListener("abort", abortHandler);
      let json: { ok?: boolean; error?: string; resetAll?: boolean };
      try {
        json = JSON.parse(xhr.responseText) as { ok?: boolean; error?: string; resetAll?: boolean };
      } catch {
        reject(new Error(translate(language, "coursewareLib.upload.chunkParseError")));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300 || json.ok === false) {
        reject(
          new ChunkedUploadApiError(
            typeof json.error === "string"
              ? json.error
              : translate(language, "coursewareLib.upload.chunkFailed", { status: xhr.status }),
            xhr.status,
            json.resetAll === true,
          ),
        );
        return;
      }
      resolve(json);
    };

    xhr.onabort = () => {
      reject(
        new DOMException(translate(language, "coursewareLib.upload.uploadCanceled"), "AbortError"),
      );
    };

    xhr.send(form);
  });
}

function emitProgress(
  onProgress: ChunkedCoursewareAssetUploadOptions["onProgress"],
  phase: CoursewareAssetUploadPhase,
  loaded: number,
  total: number,
): void {
  if (!onProgress || total <= 0) return;
  const percent = Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
  onProgress({ phase, loaded, total, percent });
}

async function fetchUploadStatus(
  uploadId: string,
  token: string,
  language: SupportedLanguage,
  signal?: AbortSignal,
): Promise<StatusResponse | null> {
  try {
    return await agentJsonGet<StatusResponse>(
      `/courseware/assets/upload/status?uploadId=${encodeURIComponent(uploadId)}`,
      token,
      language,
      signal,
    );
  } catch {
    return null;
  }
}

/**
 * Upload a courseware asset in chunks (with progress callbacks and resumable uploads).
 * Returns the same structure as `coursewareAssetsApi.uploadAsset`.
 *
 * When the session expires / OSS multipart resetAll happens, the resume state is cleared and the whole upload retried once automatically,
 * so choosing the same file a second time doesn't hit the invalid session again.
 */
export async function uploadCoursewareAssetChunked(
  options: ChunkedCoursewareAssetUploadOptions,
): Promise<ChunkedCoursewareAssetUploadRawResult> {
  const language = options.language ?? "zh";
  const cwId = options.coursewareId.trim();
  if (!cwId) {
    throw new Error(translate(language, "coursewareLib.upload.missingCoursewareIdAsset"));
  }
  if (options.file.size <= 0) {
    throw new Error(translate(language, "coursewareLib.upload.emptyFile"));
  }

  try {
    return await uploadCoursewareAssetChunkedOnce(options, { allowResume: true });
  } catch (error) {
    if (!isStaleUploadError(error)) throw error;
    const token = await acquireAuthToken(language);
    const resume = readResumeRecord(cwId, options.file);
    if (resume?.uploadId) {
      await abortRemoteUpload(resume.uploadId, token, language);
      clearResumeRecord(cwId, options.file);
    }
    try {
      return await uploadCoursewareAssetChunkedOnce(options, { allowResume: false });
    } catch (retryError) {
      if (isStaleUploadError(retryError)) {
        const retryResume = readResumeRecord(cwId, options.file);
        if (retryResume?.uploadId) {
          await abortRemoteUpload(retryResume.uploadId, token, language);
          clearResumeRecord(cwId, options.file);
        }
        throw new Error(translate(language, "coursewareLib.upload.sessionExpired"));
      }
      throw retryError;
    }
  }
}

async function uploadCoursewareAssetChunkedOnce(
  options: ChunkedCoursewareAssetUploadOptions,
  mode: { allowResume: boolean },
): Promise<ChunkedCoursewareAssetUploadRawResult> {
  const { coursewareId, file, onProgress, signal } = options;
  const language = options.language ?? "zh";
  const cwId = coursewareId.trim();
  const token = await acquireAuthToken(language);

  let uploadId: string | undefined;
  let chunkSize: number | undefined;
  let totalChunks: number | undefined;
  const received = new Set<number>();

  if (mode.allowResume) {
    const resume = readResumeRecord(cwId, file);
    if (resume?.uploadId) {
      const status = await fetchUploadStatus(resume.uploadId, token, language, signal);
      if (
        status?.uploadId &&
        typeof status.chunkSize === "number" &&
        typeof status.totalChunks === "number" &&
        Array.isArray(status.receivedChunks)
      ) {
        uploadId = status.uploadId;
        chunkSize = status.chunkSize;
        totalChunks = status.totalChunks;
        for (const idx of status.receivedChunks) received.add(idx);
      } else {
        clearResumeRecord(cwId, file);
      }
    }
  } else {
    clearResumeRecord(cwId, file);
  }

  if (!uploadId) {
    const init = await agentJsonPost<InitResponse>(
      "/courseware/assets/upload/init",
      {
        coursewareId: cwId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
      },
      token,
      language,
      signal,
    );

    if (init.deduped && init.asset) {
      clearResumeRecord(cwId, file);
      emitProgress(onProgress, "completing", file.size, file.size);
      return { assetDto: init.asset, file_path: init.asset.filePath };
    }

    uploadId = init.uploadId;
    chunkSize = init.chunkSize;
    totalChunks = init.totalChunks;
    if (!uploadId || !chunkSize || !totalChunks) {
      throw new Error(translate(language, "coursewareLib.upload.initIncomplete"));
    }
    writeResumeRecord(cwId, file, uploadId);
  }

  if (!uploadId || !chunkSize || !totalChunks) {
    throw new Error(translate(language, "coursewareLib.upload.initIncomplete"));
  }

  const effectiveChunkSize = chunkSize;
  const effectiveTotalChunks = totalChunks;
  const activeUploadId = uploadId;

  const bytesAlreadyUploaded = (): number => {
    let sum = 0;
    for (const idx of received) {
      const start = idx * effectiveChunkSize;
      const end =
        idx < effectiveTotalChunks - 1 ? start + effectiveChunkSize : file.size;
      sum += end - start;
    }
    return sum;
  };

  emitProgress(onProgress, "uploading", bytesAlreadyUploaded(), file.size);

  // On a server resetAll the OSS multipart is refreshed and receivedChunks emptied; the client should re-upload every chunk in the same session instead of failing outright.
  let chunkPass = 0;
  const maxChunkPasses = 2;
  while (chunkPass < maxChunkPasses) {
    chunkPass += 1;
    const md5Hasher = new SparkMD5.ArrayBuffer();
    let resetAllRequested = false;

    for (let chunkIndex = 0; chunkIndex < effectiveTotalChunks; chunkIndex += 1) {
      const start = chunkIndex * effectiveChunkSize;
      const end = Math.min(start + effectiveChunkSize, file.size);
      const blob = file.slice(start, end);
      const chunkBuffer = await blob.arrayBuffer();
      md5Hasher.append(chunkBuffer);

      if (received.has(chunkIndex)) continue;

      const form = new FormData();
      form.append("uploadId", activeUploadId);
      form.append("chunkIndex", String(chunkIndex));
      form.append("chunk", new Blob([chunkBuffer]), `${file.name}.part${chunkIndex}`);

      const baseLoaded = bytesAlreadyUploaded();
      try {
        await postMultipartWithProgress(
          "/courseware/assets/upload/chunk",
          form,
          token,
          (chunkLoaded, _chunkTotal) => {
            emitProgress(onProgress, "uploading", baseLoaded + chunkLoaded, file.size);
          },
          language,
          signal,
        );
      } catch (error) {
        if (error instanceof ChunkedUploadApiError && error.resetAll) {
          received.clear();
          resetAllRequested = true;
          break;
        }
        if (isStaleUploadError(error)) {
          await abortRemoteUpload(activeUploadId, token, language);
          clearResumeRecord(cwId, file);
        }
        throw error;
      }

      received.add(chunkIndex);
      emitProgress(onProgress, "uploading", bytesAlreadyUploaded(), file.size);
    }

    if (resetAllRequested) {
      emitProgress(onProgress, "uploading", 0, file.size);
      continue;
    }

    const contentMd5 = md5Hasher.end();
    emitProgress(onProgress, "completing", file.size, file.size);

    try {
      const complete = await agentJsonPost<CompleteResponse>(
        "/courseware/assets/upload/complete",
        { uploadId: activeUploadId, contentMd5 },
        token,
        language,
        signal,
      );

      if (!complete.asset) {
        throw new Error(translate(language, "coursewareLib.upload.completeMissingAsset"));
      }

      clearResumeRecord(cwId, file);
      return { assetDto: complete.asset, file_path: complete.asset.filePath };
    } catch (error) {
      if (isStaleUploadError(error)) {
        await abortRemoteUpload(activeUploadId, token, language);
        clearResumeRecord(cwId, file);
      }
      throw error;
    }
  }

  await abortRemoteUpload(activeUploadId, token, language);
  clearResumeRecord(cwId, file);
  throw new ChunkedUploadApiError(
    "OSS multipart session expired; please re-upload all chunks.",
    410,
    true,
  );
}

export type ChunkedCoursewareAssetUploadRawResult = {
  assetDto: AgentAssetDto;
  file_path: string;
};
