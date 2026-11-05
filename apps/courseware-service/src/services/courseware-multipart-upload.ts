// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import busboy from "busboy";

export type ParsedCoursewareMultipart = {
  fields: Record<string, string>;
  md5Hex: string;
  originalName: string;
  partMime: string;
};

function normalizeUploadedFileName(name: string): string {
  const trimmed = name.trim() || "upload";
  if (/[\u00c0-\u00ff]/.test(trimmed) && !/[\u4e00-\u9fff]/.test(trimmed)) {
    const repaired = Buffer.from(trimmed, "latin1").toString("utf8");
    if (repaired && !repaired.includes("\uFFFD")) {
      return repaired;
    }
  }
  return trimmed;
}

/** Parse multipart into a temp file as a stream, computing the MD5. */
export function parseCoursewareMultipartToTempFile(
  req: IncomingMessage,
  tmpFile: string,
  maxBytes: number,
): Promise<ParsedCoursewareMultipart> {
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    let sawFile = false;
    let fileWrite: Promise<void> = Promise.resolve();
    let md5Hex = "";
    let rawOriginalName = "upload";
    let partMime = "application/octet-stream";

    const bb = busboy({
      headers: req.headers,
      defParamCharset: "utf8",
      limits: {
        fileSize: maxBytes,
        files: 1,
        fields: 16,
        fieldSize: 4096,
        parts: 32,
      },
    });

    bb.on("field", (name, val) => {
      fields[name] = val;
    });

    bb.on("file", (name, file, info) => {
      if (name !== "file") {
        file.resume();
        return;
      }
      if (sawFile) {
        file.resume();
        reject(new Error('Only one "file" part is allowed.'));
        return;
      }
      sawFile = true;
      rawOriginalName = (info.filename && String(info.filename).trim()) || "upload";
      partMime = (info.mimeType && String(info.mimeType)) || "application/octet-stream";

      const hasher = createHash("md5");
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          hasher.update(chunk);
          cb(null, chunk);
        },
      });

      fileWrite = pipeline(file, counter, createWriteStream(tmpFile)).then(() => {
        md5Hex = hasher.digest("hex");
      });
    });

    bb.on("error", (err) => reject(err));
    bb.on("partsLimit", () => reject(new Error("Too many multipart parts.")));
    bb.on("filesLimit", () => reject(new Error("Too many files in multipart request.")));
    bb.on("fieldsLimit", () => reject(new Error("Too many form fields.")));

    bb.on("finish", () => {
      void fileWrite
        .then(() => {
          if (!sawFile) {
            reject(new Error('Missing multipart field "file".'));
            return;
          }
          resolve({
            fields,
            md5Hex,
            originalName: normalizeUploadedFileName(fields.fileName?.trim() || rawOriginalName),
            partMime,
          });
        })
        .catch((err) => reject(err));
    });

    req.on("error", reject);
    req.pipe(bb);
  });
}
