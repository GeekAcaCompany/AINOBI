// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from "node:http";

import { ZodError } from "zod";

import { readJsonBody, sendJson } from "../request.ts";
import { renderUrlToVideo, videoRenderRequestSchema } from "../../services/video-render.ts";

function formatValidationError(error: ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}

export async function handleVideoRenderRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readJsonBody<unknown>(req);
  const parsed = videoRenderRequestSchema.safeParse(body);

  if (!parsed.success) {
    sendJson(res, 400, {
      ok: false,
      error: formatValidationError(parsed.error),
    });
    return;
  }

  const result = await renderUrlToVideo(parsed.data);
  sendJson(res, 200, result);
}
