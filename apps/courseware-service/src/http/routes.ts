// SPDX-License-Identifier: AGPL-3.0-only
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  authorizeRequest,
  getAuthorizedSession,
  isAnonymousCoursewareRoute,
  isMemberSessionCoursewareRoute,
  isPublicRoute,
  sendUnauthorized,
} from "../api-auth.ts";
import { handleCoursewareAiTeachersList } from "../services/courseware-ai-teachers-http.ts";
import { handleAgentHandoffRedeem } from "../services/agent-handoff-http.ts";
import { handleEmbedHandoffMint } from "../services/embed-handoff-http.ts";
import {
  handleAgentConnectCodeGet,
  handleAgentConnectCredentialPost,
  handleAgentConnectDocGet,
  handleAgentConnectRecordGet,
  parseAgentConnectCodePath,
  parseAgentConnectCredentialPath,
  parseAgentConnectRecordPath,
} from "../services/agent-connect-http.ts";
import { handleCoursewareAssetUploadStatusGet } from "../services/courseware-assets-chunked-upload.ts";
import { handleCoursewareAssetsGet, handleCoursewareAssetsPost } from "../services/courseware-assets-http.ts";
import {
  handleCoursewareQuizAnswerRecordingsPost,
  isCoursewareQuizAnswerRecordingsPostPath,
} from "../services/courseware-quiz-answer-recordings-http.ts";
import { handleCoursewareQuizEvaluation } from "../services/courseware-quiz-evaluation-http.ts";
import { handleCoursewareQuizAnswerRecordingUploadStatusGet } from "../services/courseware-quiz-answer-recordings-chunked-upload.ts";
import { isCoursewareQuizAnswerRecordingUploadStatusPath } from "../services/courseware-quiz-answer-recordings-paths.ts";
import { handleCoursewareNarrationRun } from "../services/courseware-narration-http.ts";
import { handleCoursewareTtsList } from "../services/courseware-tts-list-http.ts";
import { handleCoursewareTtsSynthesize } from "../services/courseware-tts-http.ts";
import { handleCoursewareDocRead } from "../services/courseware-doc-read-http.ts";
import { handleCoursewareKnowledgeRead } from "../services/courseware-knowledge-http.ts";
import { handleCoursewareImageReplicateHtml } from "../services/courseware-image-replicate-http.ts";
import { handleCoursewareImageGenerate } from "../services/courseware-image-generate-http.ts";
import { handleCoursewarePromptOptimize } from "../services/courseware-prompt-optimize-http.ts";
import { handleCoursewareSearchRun } from "../services/courseware-search-http.ts";
import { handleCoursewareToolResultRecall } from "../services/courseware-tool-result-recall-http.ts";
import { isCoursewareAssetsPostPath } from "../services/courseware-assets-paths.ts";
import {
  handleCoursewareCoverUpload,
  isCoursewareCoverUploadPath,
} from "../services/courseware-cover-http.ts";
import { handleCoursewareContentTemplates } from "../services/courseware-content-templates-http.ts";
import { handleCoursewareDesignTemplates } from "../services/courseware-design-templates-http.ts";
import { handleCoursewareTtsPronunciationDict } from "../services/courseware-tts-pronunciation-dict-http.ts";
import { handleCoursewarePersistence, handleCoursewareStream } from "../services/courseware-http.ts";
import {
  handleCoursewareRenderCallback,
  handleCoursewareRenderTasksProxy,
} from "../services/courseware-render-http.ts";
import {
  handleChat,
  handleChatPermission,
  handleChatStream,
  handleChatStreamAbort,
} from "../services/chat-http.ts";
import { handleChatStreamSubscribe } from "../services/chat-stream-mirror.ts";
import { handleCodexMcp, isCodexMcpPath } from "../mcp/codex-mcp-http.ts";
import { buildOAuthProtectedResourceMetadata } from "../mcp/codex-mcp-oauth.ts";
import { resolveCoursewarePublicBaseUrl, sendCodexPluginZip } from "../services/codex-plugin-zip.ts";
import { applyCorsHeaders, sendCorsPreflight } from "./cors.ts";
import { attachHttpRequestLogging, formatErrorDetail, requestLogContext } from "./request-log.ts";
import { requestPathname, sendJson } from "./request.ts";


/**
 * HTTP API (routing uses pathname only; query strings are not part of the path match).
 *
 * | Method | Path | Auth | Notes |
 * |--------|------|------|-------|
 * | GET | /health | public | Liveness |
 * | GET | /plugins/ainobi-courseware-codex-plugin.zip | public | Codex plugin pack; MCP URL injected at download time |
 * | POST/GET/DELETE | /mcp | session | Codex / ChatGPT Apps MCP (Streamable HTTP); Bearer = access_token or org Agent ainobi_ak_* |
 * | GET | /.well-known/oauth-protected-resource | public | OAuth protected-resource metadata (MCP) |
 * | POST | /agent-handoff/redeem | public (code is the credential) | Frontend boot code exchanges a `?handoff=` code for the minted short-lived agent access_token; see services/agent-handoff.ts |
 * | POST | /embed/handoff | session | Host page embedding the editor/player mints a one-time (60 s, single-use) code that hands its own session to the frame over the embed protocol; see services/embed-handoff-http.ts |
 * | GET | /agent/connect-code | session (manager+) | Console Agent panel: current one-time connect code + copyable instruction (mints the agent+credential via the backend on first use) |
 * | GET | /agent/connect/{code} | public (code is the credential) | Markdown onboarding guide for the AI agent (no secrets); see services/agent-connect.ts |
 * | POST | /agent/connect/{code}/credential | public (code is the credential) | One-time env file delivery (`AINOBI_AGENT_API_KEY` + `AINOBI_MCP_URL`); code is consumed |
 * | POST | /chat | session | Agent turn (JSON) |
 * | POST | /chat/stream | session | Agent turn (SSE); mirrors to Redis when configured |
 * | POST | /chat/stream/abort | session | Stop in-flight turn (`chatStreamSessionId`) |
 * | GET | /chat/stream | session | Replay / tail chat SSE (`chatStreamSessionId`, `from`) |
 * | POST | /chat/permission | session | Answer AskUserQuestion |
 * | GET | /courseware/stream | session | Live preview SSE |
 * | POST | /courseware/stream/publish | session | Agent CLI → Redis live preview |
 * | GET/PUT/DELETE | /courseware | session† | Load/save/delete; †GET also `course_section:query` + section binding, or `is_share`/`is_public`, or `?sectionId=` naming a bound section the caller can read per the backend (enrolled non-members / public-course external students, issue #825); `?key=` is resolved once (id-or-key) and every handler then operates on that resolved row. PUT-update targets the resolved row id and requires `baseUpdatedAt` (409 `conflict:"version"` when stale, 404 when concurrently deleted); PUT-create requires `orgId` + org access to it (org is fixed at creation), ignores body `orgId` on update, and returns 409 `conflict:"key"` when the key is taken or collides with an existing courseware id |
 * | PATCH | /courseware/sharing | session | Update `is_public` / `is_share` only (org members) |
 * | GET/PUT/DELETE | /courseware/* | session† | Same; list/stream/sharing always require session |
 * | DELETE | /courseware/binding | session | Unbind ?coursewareId=&courseId=; courseware org access required (no anonymous `is_public` path) |
 * | GET | /courseware/section-binding/list | session (`course_section:query`) | ?sectionId=&orgId= (&courseId= optional); org membership via /organization/list (not current_org_id); non-members fall back to backend section-readability probe (public-course external students, issue #825) |
 * | GET | /courseware/section-binding/list-by-courseware | session (`course_section:query`) | ?coursewareId=&orgId= (coursewareId is id-or-key); all section bindings of one courseware across courses (echo for the AI content bind modal, single query) |
 * | POST | /courseware/section-binding | session | Bind courseware to section (JSON body); org access to body `orgId` + courseware org required, binding org must equal courseware org (single-org invariant; an org-less courseware cannot be bound) |
 * | PATCH | /courseware/section-binding/current | session | Set current lecture courseware for section; org access to body `orgId` + courseware org required |
 * | DELETE | /courseware/section-binding | session | Unbind ?coursewareId=&sectionId=&orgId=; courseware org access required |
 * | GET | /courseware/list | session† | ?orgId= required (any valid login + member of org via /organization/list); optional ?courseId= filter; results always scoped to that one org |
 * | GET | /courseware/audit-logs | session | ?coursewareId= |
 * | GET | /courseware/assets | session | ?coursewareId= (asset list) |
 * | GET | /courseware/versions | session | ?key= |
 * | POST | /courseware/rollback | session | ?key= |
 * | GET/DELETE | /courseware/conversations | session | ?coursewareId= or ?key= |
 * | GET | /courseware/conversations/list | session | ?coursewareId= or ?key= |
 * | POST | /courseware/assets/* | session† | upload (+ chunked init/chunk/complete/abort), list, get, delete, batch_presign_urls (`render_token` for headless), read_text |
 * | GET | /courseware/assets/upload/status | session | Chunked upload resume status |
 * | POST | /courseware/narration/run | session | Agent CLI → host TTS/OSS (sync) |
 * | POST | /courseware/tts/list | session | Agent CLI → platform TTS catalog |
 * | POST | /courseware/tts/synthesize | session (managed_list for target org) | AI teacher TTS → OSS URL (sync, billed; optional tts_id override) |
 * | GET/POST/PUT/DELETE | /courseware/tts/pronunciation-dict | session | Org-scoped TTS pronunciation dictionary CRUD |
 * | POST | /courseware/tts/pronunciation-dict/convert | session | Preview ja→hiragana / zh→pinyin conversion |
 * | POST | /courseware/search/run | session | Agent CLI → host Tavily search (sync) |
 * | POST | /courseware/tool-result/recall | session | Agent CLI → recall archived oversized tool output |
 * | POST | /courseware/doc/read | session | Agent CLI → host document→markdown (sync) |
 * | POST | /courseware/knowledge/read | session | Agent CLI → section knowledge text_slice |
 * | POST | /courseware/image/replicate-html | session | Agent CLI → host image→HTML vision (sync) |
 * | POST | /courseware/image/generate | session | Text→image (gpt-image-2) → courseware asset (billed) |
 * | POST | /courseware/prompt/optimize | session | Optimize image prompt via text LLM (billed) |
 * | POST | /courseware/design-templates/extract | session | Extract style → org design template (sync; token-billed) |
 * | GET/POST/PUT/DELETE | /courseware/design-templates | session | Org-scoped design template CRUD |
 * | POST | /courseware/content-templates/extract | session | Extract outline → org content template (sync; token-billed) |
 * | GET/POST/PUT/DELETE | /courseware/content-templates | session | Content template CRUD (built-ins + org; edit built-in upserts override) |
 * | POST | /courseware/cover/upload | session | Editor cover image upload (multipart) |
 * | POST | /courseware/quiz_answer_recordings/upload/* | session† | Chunked quiz answer recording upload; †any logged-in user (incl. learners), courseware read access in handler |
 * | POST | /courseware/quiz_answer_recordings/presign | session† | Fresh playback URL for an existing recording; †org member of the recording |
 * | GET | /courseware/quiz_answer_recordings/upload/status | session† | Chunked upload resume status |
 * | POST | /courseware/quiz/evaluate | session† | Learner quiz answer evaluation; authoritative attempt/submission lives here |
 * | POST | /courseware/quiz/sessions/complete | session† | Complete an authoritative quiz attempt session |
 * | GET | /courseware/quiz/answers | session† | List caller's active quiz submissions |
 * | POST | /courseware/render/tasks | session† | Create a video export task (proxies `ainobi-video-render-service`) |
 * | GET | /courseware/render/tasks | session† | List export tasks for `?coursewareId=` |
 * | POST | /courseware/render/tasks/:id/retry | session† | Retry a failed/interrupted export task (re-mints render_token) |
 * | POST | /courseware/render/tasks/:id/cancel | session† | Cancel a still-queued export task |
 * | POST | /courseware/render/callback | internal token | ainobi-video-render-service → task outcome webhook (billing) |
 */
export function createHttpHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    applyCorsHeaders(res);

    if (req.method === "OPTIONS") {
      sendCorsPreflight(res);
      return;
    }

    const pathname = requestPathname(req.url);
    const method = req.method ?? "GET";
    const logCtx = requestLogContext(req, pathname);
    const handlerError = { current: undefined as unknown };

    attachHttpRequestLogging(req, res, logCtx, () => ({
      error: handlerError.current,
    }));

    try {
      const authorized = await authorizeRequest(req);
      // `/mcp` admits Org Agent keys via handler-local resolveAinobiUserSessionForMcp
      // (not global authorizeRequest — avoids opening /chat etc.).
      if (
        !isPublicRoute(method, pathname) &&
        !authorized &&
        !isAnonymousCoursewareRoute(pathname) &&
        !isMemberSessionCoursewareRoute(pathname) &&
        !isCodexMcpPath(pathname)
      ) {
        sendUnauthorized(res);
        return;
      }

      const session = getAuthorizedSession(req);
      if (session) {
        logCtx.userId = session.userId;
        logCtx.orgId = session.currentOrgId;
      }

      if (method === "GET" && pathname === "/health") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === "GET" && pathname === "/plugins/ainobi-courseware-codex-plugin.zip") {
        const sent = sendCodexPluginZip(req, res);
        if (!sent) {
          sendJson(res, 404, {
            ok: false,
            error: "Plugin zip not found. Run yarn pack:codex-plugin (or yarn build) on the server image.",
          });
        }
        return;
      }

      if (
        method === "GET" &&
        (pathname === "/.well-known/oauth-protected-resource" ||
          pathname === "/.well-known/oauth-protected-resource/mcp")
      ) {
        const publicBase = resolveCoursewarePublicBaseUrl(req);
        sendJson(res, 200, buildOAuthProtectedResourceMetadata({ publicBaseUrl: publicBase }));
        return;
      }

      if (isCodexMcpPath(pathname) && (method === "POST" || method === "GET" || method === "DELETE")) {
        await handleCodexMcp(req, res);
        return;
      }

      if (method === "GET" && pathname === "/chat/stream") {
        await handleChatStreamSubscribe(req, res);
        return;
      }

      if (method === "POST" && pathname === "/chat/stream") {
        await handleChatStream(req, res);
        return;
      }

      if (method === "POST" && pathname === "/chat/stream/abort") {
        await handleChatStreamAbort(req, res);
        return;
      }

      if (method === "POST" && pathname === "/chat/permission") {
        await handleChatPermission(req, res);
        return;
      }

      if (method === "POST" && pathname === "/chat") {
        await handleChat(req, res);
        return;
      }

      if (method === "GET" && pathname === "/courseware/stream") {
        await handleCoursewareStream(req, res);
        return;
      }

      if (method === "GET" && (await handleCoursewareAssetUploadStatusGet(req, res))) {
        return;
      }

      if (method === "GET" && isCoursewareQuizAnswerRecordingUploadStatusPath(req.url)) {
        await handleCoursewareQuizAnswerRecordingUploadStatusGet(req, res);
        return;
      }

      if (method === "GET" && (await handleCoursewareAssetsGet(req, res))) {
        return;
      }

      if (method === "POST" && pathname === "/agent-handoff/redeem") {
        await handleAgentHandoffRedeem(req, res);
        return;
      }

      if (method === "POST" && pathname === "/embed/handoff") {
        await handleEmbedHandoffMint(req, res);
        return;
      }

      if (method === "GET" && pathname === "/agent/connect-code") {
        await handleAgentConnectCodeGet(req, res);
        return;
      }

      const agentConnectCodePath = parseAgentConnectCodePath(pathname);
      if (method === "GET" && agentConnectCodePath) {
        await handleAgentConnectDocGet(req, res, agentConnectCodePath);
        return;
      }

      const agentConnectCredentialPath = parseAgentConnectCredentialPath(pathname);
      if (method === "POST" && agentConnectCredentialPath) {
        await handleAgentConnectCredentialPost(req, res, agentConnectCredentialPath);
        return;
      }

      const agentConnectRecordPath = parseAgentConnectRecordPath(pathname);
      if (method === "GET" && agentConnectRecordPath) {
        await handleAgentConnectRecordGet(req, res, agentConnectRecordPath);
        return;
      }

      if (method === "POST" && isCoursewareQuizAnswerRecordingsPostPath(req.url)) {
        await handleCoursewareQuizAnswerRecordingsPost(req, res);
        return;
      }

      if (await handleCoursewareQuizEvaluation(req, res)) {
        return;
      }

      if (method === "POST" && isCoursewareAssetsPostPath(req.url)) {
        await handleCoursewareAssetsPost(req, res);
        return;
      }

      if (method === "POST" && isCoursewareCoverUploadPath(req.url)) {
        await handleCoursewareCoverUpload(req, res);
        return;
      }

      if (method === "POST" && pathname === "/courseware/narration/run") {
        await handleCoursewareNarrationRun(req, res);
        return;
      }

      if (method === "POST" && pathname === "/courseware/tts/list") {
        await handleCoursewareTtsList(req, res);
        return;
      }

      if (method === "POST" && pathname === "/courseware/tts/synthesize") {
        await handleCoursewareTtsSynthesize(req, res);
        return;
      }

      if (await handleCoursewareTtsPronunciationDict(req, res)) {
        return;
      }

      if (method === "POST" && pathname === "/courseware/search/run") {
        await handleCoursewareSearchRun(req, res);
        return;
      }

      if (method === "POST" && pathname === "/courseware/tool-result/recall") {
        await handleCoursewareToolResultRecall(req, res);
        return;
      }

      if (method === "POST" && pathname === "/courseware/doc/read") {
        await handleCoursewareDocRead(req, res);
        return;
      }

      if (method === "POST" && pathname === "/courseware/knowledge/read") {
        await handleCoursewareKnowledgeRead(req, res);
        return;
      }

      if (method === "POST" && pathname === "/courseware/image/replicate-html") {
        await handleCoursewareImageReplicateHtml(req, res);
        return;
      }

      if (method === "POST" && pathname === "/courseware/image/generate") {
        await handleCoursewareImageGenerate(req, res);
        return;
      }

      if (method === "POST" && pathname === "/courseware/prompt/optimize") {
        await handleCoursewarePromptOptimize(req, res);
        return;
      }

      if (method === "POST" && pathname === "/courseware/ai-teachers/list") {
        await handleCoursewareAiTeachersList(req, res);
        return;
      }

      if (await handleCoursewareDesignTemplates(req, res)) {
        return;
      }

      if (await handleCoursewareContentTemplates(req, res)) {
        return;
      }

      if (method === "POST" && pathname === "/courseware/render/callback") {
        await handleCoursewareRenderCallback(req, res);
        return;
      }

      if (pathname === "/courseware/render/tasks" || pathname.startsWith("/courseware/render/tasks/")) {
        if (await handleCoursewareRenderTasksProxy(req, res)) {
          return;
        }
      }

      if (await handleCoursewarePersistence(req, res)) {
        return;
      }

      sendJson(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      handlerError.current = error;
      if (!res.headersSent) {
        const message =
          error instanceof Error && error.message.trim()
            ? error.message
            : "Internal server error";
        sendJson(res, 500, { ok: false, error: message });
        return;
      }
      console.error('[http] FAIL after headers sent', {
        method,
        pathname,
        detail: formatErrorDetail(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      });
    }
  };
}
