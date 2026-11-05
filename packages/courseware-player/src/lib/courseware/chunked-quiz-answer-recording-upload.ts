// SPDX-License-Identifier: AGPL-3.0-only
import SparkMD5 from "spark-md5";

import config from "../../host/config.ts";
import { translate, type SupportedLanguage } from "../i18n/index.ts";
import sessionManager from "../../host/session-manager.ts";
import { safeLocalStorageSetItem } from "../safe-storage.ts";

const RESUME_STORAGE_PREFIX = "cw-quiz-answer-recording-chunk-upload:";

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
    m.includes("staging object missing")
  );
}

async function abortRemoteUpload(
  uploadId: string,
  token: string,
  language: SupportedLanguage,
  sectionId?: string,
): Promise<void> {
  try {
    await agentJsonPost(
      appendSectionIdQuery("/courseware/quiz_answer_recordings/upload/abort", sectionId),
      { uploadId },
      token,
      language,
    );
  } catch {
    // ignore
  }
}

export type QuizAnswerRecordingUploadProgress = {
  phase: "uploading" | "completing";
  loaded: number;
  total: number;
  percent: number;
};

export type UploadQuizAnswerRecordingOptions = {
  coursewareId: string;
  file: File;
  // Section the learner is viewing; lets the courseware-service org guard
  // admit enrolled non-members (public-course external students, issue #825).
  sectionId?: string;
  sceneId?: string;
  questionWrapperId?: string;
  durationSec?: number;
  onProgress?: (progress: QuizAnswerRecordingUploadProgress) => void;
  signal?: AbortSignal;
  /** UI language for user-facing error messages (backend `error` strings pass through). Defaults to "zh". */
  language?: SupportedLanguage;
};

type QuizAnswerRecordingDto = {
  recordingId: string;
  coursewareId: string;
  filePath: string;
  fileUrl: string;
  contentMd5: string;
  durationSec: number | null;
};

type InitResponse = {
  ok?: boolean;
  error?: string;
  uploadId?: string;
  recordingId?: string;
  chunkSize?: number;
  totalChunks?: number;
  expiresAt?: string;
};

type StatusResponse = {
  ok?: boolean;
  error?: string;
  uploadId?: string;
  recordingId?: string;
  receivedChunks?: number[];
  totalChunks?: number;
  chunkSize?: number;
  expiresAt?: string;
};

type CompleteResponse = {
  ok?: boolean;
  error?: string;
  recording?: QuizAnswerRecordingDto;
};

function coursewareApiBaseUrl(language: SupportedLanguage): string {
  const base = config.origin.coursewareApi?.trim();
  if (!base) {
    throw new Error(translate(language, "coursewareLib.upload.serviceNotConfigured"));
  }
  return base.replace(/\/+$/, "");
}

/** Append ?sectionId= (or &sectionId=) so the service org guard can verify enrollment. */
function appendSectionIdQuery(path: string, sectionId?: string): string {
  const id = sectionId?.trim();
  if (!id) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}sectionId=${encodeURIComponent(id)}`;
}

function resumeStorageKey(coursewareId: string, file: File): string {
  return `${RESUME_STORAGE_PREFIX}${coursewareId}:${file.name}:${file.size}:${file.lastModified}`;
}

type ResumeRecord = {
  uploadId: string;
  recordingId?: string;
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

function writeResumeRecord(
  coursewareId: string,
  file: File,
  uploadId: string,
  recordingId?: string,
): void {
  try {
    safeLocalStorageSetItem(
      resumeStorageKey(coursewareId, file),
      JSON.stringify({
        uploadId,
        ...(recordingId?.trim() ? { recordingId: recordingId.trim() } : {}),
        updatedAt: Date.now(),
      } satisfies ResumeRecord),
    );
  } catch {
    // ignore
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
    throw new Error(translate(language, "coursewareLib.upload.notLoggedInRecording"));
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
  onProgress: UploadQuizAnswerRecordingOptions["onProgress"],
  phase: QuizAnswerRecordingUploadProgress["phase"],
  loaded: number,
  total: number,
): void {
  if (!onProgress || total <= 0) return;
  const percent = Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
  onProgress({ phase, loaded, total, percent });
}

export type UploadQuizAnswerRecordingResult = {
  recordingId: string;
  file_path: string;
  file_url: string;
};

/**
 * Upload a quiz answer recording in chunks, written to the `courseware_quiz_answer_recordings` table.
 */
export async function uploadQuizAnswerRecordingChunked(
  options: UploadQuizAnswerRecordingOptions,
): Promise<UploadQuizAnswerRecordingResult> {
  const {
    coursewareId,
    file,
    sectionId,
    sceneId,
    questionWrapperId,
    durationSec,
    onProgress,
    signal,
  } = options;
  const language = options.language ?? "zh";
  const cwId = coursewareId.trim();
  if (!cwId) {
    throw new Error(translate(language, "coursewarePreview.errors.missingCoursewareIdUpload"));
  }
  if (file.size <= 0) {
    throw new Error(translate(language, "coursewareLib.upload.emptyFile"));
  }

  const token = await acquireAuthToken(language);

  let uploadId: string | undefined;
  let chunkSize: number | undefined;
  let totalChunks: number | undefined;
  let recordingId: string | undefined;
  const received = new Set<number>();

  const resume = readResumeRecord(cwId, file);
  if (resume?.uploadId) {
    recordingId = resume.recordingId?.trim() || recordingId;
    const status = await agentJsonGet<StatusResponse>(
      appendSectionIdQuery(
        `/courseware/quiz_answer_recordings/upload/status?uploadId=${encodeURIComponent(resume.uploadId)}`,
        sectionId,
      ),
      token,
      language,
      signal,
    );
    if (
      status?.uploadId &&
      typeof status.chunkSize === "number" &&
      typeof status.totalChunks === "number" &&
      Array.isArray(status.receivedChunks)
    ) {
      uploadId = status.uploadId;
      chunkSize = status.chunkSize;
      totalChunks = status.totalChunks;
      recordingId = status.recordingId?.trim() || recordingId;
      for (const idx of status.receivedChunks) received.add(idx);
    } else {
      clearResumeRecord(cwId, file);
    }
  }

  if (!uploadId) {
    const init = await agentJsonPost<InitResponse>(
      appendSectionIdQuery("/courseware/quiz_answer_recordings/upload/init", sectionId),
      {
        coursewareId: cwId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
        ...(sceneId?.trim() ? { sceneId: sceneId.trim() } : {}),
        ...(questionWrapperId?.trim() ? { questionWrapperId: questionWrapperId.trim() } : {}),
      },
      token,
      language,
      signal,
    );

    uploadId = init.uploadId;
    chunkSize = init.chunkSize;
    totalChunks = init.totalChunks;
    recordingId = init.recordingId?.trim() || recordingId;
    if (!uploadId || !chunkSize || !totalChunks) {
      throw new Error(translate(language, "coursewareLib.upload.initIncomplete"));
    }
    writeResumeRecord(cwId, file, uploadId, recordingId);
  }

  if (!uploadId || !chunkSize || !totalChunks) {
    throw new Error(translate(language, "coursewareLib.upload.initIncomplete"));
  }

  const effectiveChunkSize = chunkSize;
  const effectiveTotalChunks = totalChunks;

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

  const md5Hasher = new SparkMD5.ArrayBuffer();

  for (let chunkIndex = 0; chunkIndex < effectiveTotalChunks; chunkIndex += 1) {
    const start = chunkIndex * effectiveChunkSize;
    const end = Math.min(start + effectiveChunkSize, file.size);
    const blob = file.slice(start, end);
    const chunkBuffer = await blob.arrayBuffer();
    md5Hasher.append(chunkBuffer);

    if (received.has(chunkIndex)) continue;

    const form = new FormData();
    form.append("uploadId", uploadId);
    form.append("chunkIndex", String(chunkIndex));
    form.append("chunk", new Blob([chunkBuffer]), `${file.name}.part${chunkIndex}`);

    const baseLoaded = bytesAlreadyUploaded();
    try {
      await postMultipartWithProgress(
        appendSectionIdQuery("/courseware/quiz_answer_recordings/upload/chunk", sectionId),
        form,
        token,
        (chunkLoaded) => {
          emitProgress(onProgress, "uploading", baseLoaded + chunkLoaded, file.size);
        },
        language,
        signal,
      );
    } catch (error) {
      if (error instanceof ChunkedUploadApiError && error.resetAll) {
        received.clear();
      }
      throw error;
    }

    received.add(chunkIndex);
    emitProgress(onProgress, "uploading", bytesAlreadyUploaded(), file.size);
  }

  const contentMd5 = md5Hasher.end();
  emitProgress(onProgress, "completing", file.size, file.size);

  try {
    const complete = await agentJsonPost<CompleteResponse>(
      appendSectionIdQuery("/courseware/quiz_answer_recordings/upload/complete", sectionId),
      {
        uploadId,
        contentMd5,
        ...(typeof durationSec === "number" ? { durationSec } : {}),
        ...(sceneId?.trim() ? { sceneId: sceneId.trim() } : {}),
        ...(questionWrapperId?.trim() ? { questionWrapperId: questionWrapperId.trim() } : {}),
      },
      token,
      language,
      signal,
    );

    const recording = complete.recording;
    if (!recording?.filePath || !recording?.fileUrl) {
      throw new Error(translate(language, "coursewareLib.upload.completeMissingRecording"));
    }
    const resolvedRecordingId = recording.recordingId?.trim() || recordingId?.trim();
    if (!resolvedRecordingId) {
      throw new Error(translate(language, "coursewareLib.upload.completeMissingRecordingId"));
    }

    clearResumeRecord(cwId, file);
    return {
      recordingId: resolvedRecordingId,
      file_path: recording.filePath,
      file_url: recording.fileUrl,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      error instanceof ChunkedUploadApiError &&
      (error.status === 410 || error.resetAll || isStaleUploadErrorMessage(message))
    ) {
      await abortRemoteUpload(uploadId, token, language, sectionId);
      clearResumeRecord(cwId, file);
      throw new Error(translate(language, "coursewareLib.upload.sessionExpired"));
    }
    if (isStaleUploadErrorMessage(message)) {
      await abortRemoteUpload(uploadId, token, language, sectionId);
      clearResumeRecord(cwId, file);
      throw new Error(translate(language, "coursewareLib.upload.sessionExpired"));
    }
    throw error;
  }
}
