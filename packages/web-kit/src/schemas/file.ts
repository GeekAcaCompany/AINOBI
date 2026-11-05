// SPDX-License-Identifier: AGPL-3.0-only
import type { InferType } from "yup";

import { object, string, number } from "yup";

export const fileInfoSchema = object({
  id: string().required(),
  name: string().max(200).required(),
  mimeType: string().required(),
  size: number().required(),
  url: string().required(),
  thumbUrl: string().required(),
  extension: string().required(),
});
export type FileInfo = InferType<typeof fileInfoSchema>;

export const applyUploadSchema = object({
  objectKeyPrefix: string().required(),
  contentType: string().required(),
  contentLength: number().required(),
});
export type ApplyUpload = InferType<typeof applyUploadSchema>;
