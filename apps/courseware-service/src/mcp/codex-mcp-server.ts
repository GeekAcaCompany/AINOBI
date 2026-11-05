// SPDX-License-Identifier: AGPL-3.0-only
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AinobiAuthorizedSession } from '../auth/ainobi-user-session.ts';
import {
  coursewareAssetsListTool,
  coursewareAssetsUploadTool,
  coursewareDocReadTool,
  coursewareImageGenerateTool,
  coursewareTtsListTool,
} from './codex-mcp-media-tools.ts';
import {
  agentSetNameTool,
  ainobiExecTool,
  courseCreateTool,
  courseListTool,
  courseUpdateTool,
  coursewareExportFromCourseTool,
  coursewareImportToCourseTool,
  coursewareAiTeachersTool,
  coursewareBindSectionTool,
  coursewareCloseTool,
  coursewareCreateTool,
  coursewareListTool,
  coursewareNarrationTool,
  coursewareOpenTool,
  coursewareUnbindSectionTool,
  coursewareRecallTool,
  coursewareRenameTool,
  coursewareSaveTool,
  coursewareSearchTool,
  coursewareStatusTool,
  coursewareUiLinksTool,
  isCodexMcpToolFailure,
} from './codex-mcp-tools.ts';

function jsonResult(payload: unknown) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return {
    content: [{ type: 'text' as const, text }],
    ...(isCodexMcpToolFailure(payload) ? { isError: true as const } : {}),
  };
}

/**
 * Build a per-request MCP server bound to an authenticated AINOBI user session.
 * Workspace bindings persist in Redis (with in-memory cache) keyed by mcp_session_id.
 */
export function createCodexMcpServer(userSession: AinobiAuthorizedSession): McpServer {
  const server = new McpServer({
    name: 'ainobi-courseware',
    version: '0.1.0',
  });

  server.registerTool(
    'agent_set_name',
    {
      title: 'Set this Agent display name',
      description:
        'Register the display name for THIS agent in the console Agent list (Space Management → Agent; Chinese UI label “空间管理 → Agent”). Call during onboarding: ask the user what to name this agent (default: client name), then pass it. Also usable later to rename. Renames only the calling agent itself.',
      inputSchema: {
        name: z.string().min(1).max(128).describe('Display name, at most 128 characters'),
      },
    },
    async (args) => jsonResult(await agentSetNameTool(userSession, args)),
  );

  server.registerTool(
    'course_list',
    {
      title: 'List education courses',
      description:
        'List AINOBI education courses in an organization (name/id). Use first when the user names a course or asks what courses exist. Then courseware_list with course_id, then courseware_open. org_id optional (defaults to session org).',
      inputSchema: {
        org_id: z
          .string()
          .optional()
          .describe('Organization UUID; omit to use the Bearer session current org'),
        course_name: z.string().optional().describe('Optional course name filter'),
        page_number: z.number().int().min(1).optional(),
        page_size: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args) => jsonResult(await courseListTool(userSession, args)),
  );

  server.registerTool(
    'course_create',
    {
      title: 'Create course',
      description:
        'Create a COURSE container (not courseware). Use it when the user asks to create a course (e.g. “新建课程” / “建一门课”); for courseware use courseware_create. The returned course_id can be used to import courseware into this course library (courseware_import_to_course).',
      inputSchema: {
        title: z.string().min(1).describe('Course name (1-200 chars)'),
        description: z.string().optional().describe('Course description (≤1000 chars)'),
        status: z
          .enum(['draft', 'public', 'private', 'off_shelf'])
          .optional()
          .describe('Course status, default draft'),
        is_public: z
          .boolean()
          .optional()
          .describe('Public course (people outside the org can join). Default false = private to the org; free-plan orgs cannot create private courses and must pass true'),
        org_id: z.string().optional().describe('Organization UUID; omit to use the session current org'),
      },
    },
    async (args) => jsonResult(await courseCreateTool(userSession, args)),
  );

  server.registerTool(
    'course_update',
    {
      title: 'Update course info',
      description:
        'Update course info (name / description / status). This edits the course container itself, not courseware content; to rename courseware use courseware_rename.',
      inputSchema: {
        course_id: z.string().min(1).describe('Course course_id'),
        title: z.string().optional().describe('New course name'),
        description: z.string().optional().describe('New course description'),
        status: z.enum(['draft', 'public', 'private', 'off_shelf']).optional(),
        org_id: z.string().optional().describe('Organization UUID; omit to use the session current org'),
      },
    },
    async (args) => jsonResult(await courseUpdateTool(userSession, args)),
  );

  server.registerTool(
    'courseware_import_to_course',
    {
      title: 'Import courseware into course library',
      description:
        'Import courseware into a course library (creates the courseware ↔ course binding; idempotent; the courseware itself does not move). Courseware and course must belong to the same org. To remove it use courseware_export_from_course.',
      inputSchema: {
        courseware_id: z.string().min(1).describe('Courseware id or key'),
        course_id: z.string().min(1).describe('Target course course_id'),
        org_id: z.string().optional().describe('Organization UUID; omit to use the session current org'),
      },
    },
    async (args) => jsonResult(await coursewareImportToCourseTool(userSession, args)),
  );

  server.registerTool(
    'courseware_export_from_course',
    {
      title: 'Export courseware from course library',
      description:
        'Remove courseware from a course library (removes the courseware ↔ course binding). The courseware itself stays in the org courseware library and is not deleted.',
      inputSchema: {
        courseware_id: z.string().min(1).describe('Courseware id or key'),
        course_id: z.string().min(1).describe('Course course_id'),
        org_id: z.string().optional().describe('Organization UUID; omit to use the session current org'),
      },
    },
    async (args) => jsonResult(await coursewareExportFromCourseTool(userSession, args)),
  );

  server.registerTool(
    'courseware_list',
    {
      title: 'List courseware',
      description:
        'List courseware in an organization (id/key/title). Pass course_id to show only coursewares bound to that education course. org_id optional (session default). Then courseware_open or courseware_create.',
      inputSchema: {
        org_id: z
          .string()
          .optional()
          .describe('Organization UUID; omit to use the Bearer session current org'),
        title: z.string().optional().describe('Optional title ILIKE filter'),
        course_id: z
          .string()
          .optional()
          .describe('Filter to coursewares bound to this education course_id'),
        page_number: z.number().int().min(1).optional(),
        page_size: z.number().int().min(1).max(100).optional(),
        order: z.enum(['asc', 'desc']).optional().describe('Sort by created_at (default desc)'),
      },
    },
    async (args) => jsonResult(await coursewareListTool(userSession, args)),
  );

  server.registerTool(
    'courseware_create',
    {
      title: 'Create courseware',
      description:
        'Create a new blank COURSEWARE (“课件”) in the org. Courseware ≠ course (“课程”): if the user asks to create a COURSE, that is a different entity — say so and list courses with course_list instead. Bind to a course via course_id when the courseware belongs in a course library. By default also opens it and returns mcp_session_id for authoring. Prefer this over browser UI when the user asks to create courseware. `language` is required: confirm the courseware content language with the user before calling; never infer it from locale or UI language.',
      inputSchema: {
        title: z.string().min(1).describe('Courseware title'),
        language: z
          .enum(['zh', 'en', 'ja'])
          .describe(
            'Courseware content language (zh / en / ja). Ask the user to confirm before calling; never infer it from locale or UI language.',
          ),
        org_id: z
          .string()
          .optional()
          .describe('Organization UUID; omit to use the Bearer session current org'),
        course_id: z
          .string()
          .optional()
          .describe('Optional education course_id to bind (e.g. bind under “ccccc Copy”)'),
        key: z.string().uuid().optional().describe('Optional business key; server generates UUID when omitted'),
        open: z
          .boolean()
          .optional()
          .describe('Also courseware_open after create (default true)'),
      },
    },
    async (args) => jsonResult(await coursewareCreateTool(userSession, args)),
  );

  server.registerTool(
    'courseware_rename',
    {
      title: 'Rename courseware',
      description:
        'Rename an existing courseware (title only). Use courseware_id or business key. Does not change scene content except scene.name.',
      inputSchema: {
        courseware_id: z.string().min(1).describe('Courseware id or business key'),
        title: z.string().min(1).describe('New title'),
      },
    },
    async (args) => jsonResult(await coursewareRenameTool(userSession, args)),
  );

  server.registerTool(
    'courseware_open',
    {
      title: 'Open courseware',
      description:
        'Open an AINOBI courseware by id or key into a server workspace and preload the scene. Returns mcp_session_id for subsequent tools.',
      inputSchema: {
        courseware_id: z.string().min(1).describe('Courseware id or business key'),
        mcp_session_id: z
          .string()
          .optional()
          .describe('Optional resume id you previously own; generated when omitted'),
      },
    },
    async (args) => jsonResult(await coursewareOpenTool(userSession, args)),
  );

  server.registerTool(
    'courseware_status',
    {
      title: 'Courseware session status',
      description: 'Show the bound Codex MCP workspace for a mcp_session_id you own.',
      inputSchema: {
        mcp_session_id: z.string().min(1),
      },
    },
    async (args) => jsonResult(await coursewareStatusTool(userSession, args)),
  );

  server.registerTool(
    'courseware_close',
    {
      title: 'Close courseware session',
      description: 'Release an MCP workspace binding you own (does not delete courseware).',
      inputSchema: {
        mcp_session_id: z.string().min(1),
      },
    },
    async (args) => jsonResult(await coursewareCloseTool(userSession, args)),
  );

  server.registerTool(
    'ainobi_exec',
    {
      title: 'Run ainobi CLI argv',
      description:
        'Run one allowlisted ainobi command as argv (no shell). Scene/slide/element/animation/quiz/batch/inspect/validate/help/status/reference only. Prefer dedicated MCP tools for save, narration, search, image, asset upload/list, doc read, AI teachers, TTS. Example: ["slide","list","--verbose"].',
      inputSchema: {
        mcp_session_id: z.string().min(1),
        argv: z.array(z.string()).min(1).describe('Argv without the ainobi binary name'),
      },
    },
    async (args) => jsonResult(await ainobiExecTool(userSession, args)),
  );

  server.registerTool(
    'courseware_save',
    {
      title: 'Save courseware',
      description: 'Persist the loaded workspace scene to the AINOBI database (host flush).',
      inputSchema: {
        mcp_session_id: z.string().min(1),
      },
    },
    async (args) => jsonResult(await coursewareSaveTool(userSession, args)),
  );

  server.registerTool(
    'courseware_bind_section',
    {
      title: 'Bind courseware to section',
      description:
        'Bind an AI courseware to a course section (backend course_section flag synced in the same flow, so the course content tab reflects it immediately). Requires course_id + section_id; courseware_id defaults to the opened session courseware. is_current (default true) makes it the section current narration source.',
      inputSchema: {
        mcp_session_id: z.string().optional().describe('Open MCP session (uses courseware org + opened courseware)'),
        org_id: z.string().optional().describe('Organization UUID override'),
        courseware_id: z.string().uuid().optional().describe('AI courseware id (defaults to the opened courseware)'),
        course_id: z.string().uuid().describe('Education course UUID'),
        section_id: z.string().uuid().describe('Course section UUID'),
        chapter_id: z.string().uuid().optional().describe('Chapter UUID (kept in sync on the binding)'),
        is_current: z.boolean().optional().describe('Set as the section current narration source (default true)'),
      },
    },
    async (args) => jsonResult(await coursewareBindSectionTool(userSession, args)),
  );

  server.registerTool(
    'courseware_unbind_section',
    {
      title: 'Unbind courseware from section',
      description:
        'Remove an AI courseware ↔ section binding (backend course_section flag recalculated from the remaining bindings). courseware_id defaults to the opened session courseware.',
      inputSchema: {
        mcp_session_id: z.string().optional().describe('Open MCP session (uses courseware org + opened courseware)'),
        org_id: z.string().optional().describe('Organization UUID override'),
        courseware_id: z.string().uuid().optional().describe('AI courseware id (defaults to the opened courseware)'),
        section_id: z.string().uuid().describe('Course section UUID'),
      },
    },
    async (args) => jsonResult(await coursewareUnbindSectionTool(userSession, args)),
  );

  server.registerTool(
    'courseware_ai_teachers',
    {
      title: 'List AI teachers',
      description:
        'List organization AI teachers for narration (name/language/id). Call before courseware_narration. Prefer mcp_session_id after courseware_open so org is inferred; optional org_id. Show names to the user; keep ids internal.',
      inputSchema: {
        mcp_session_id: z.string().optional().describe('Open MCP session (uses courseware org)'),
        org_id: z.string().optional().describe('Organization UUID override'),
        status: z.string().optional().describe('Teacher status filter (default active)'),
      },
    },
    async (args) => jsonResult(await coursewareAiTeachersTool(userSession, args)),
  );

  server.registerTool(
    'courseware_narration',
    {
      title: 'Run billed narration',
      description:
        'Host TTS/OSS narration (billed). Pass full narration argv, e.g. ["narration","insert",slideRef,"--teacher-id",id,"--fit-slide"]. Optional --tts-style sets the delivery style (Google voices): a recommended key (friendly_teacher/authoritative_professor/lively_narrator/calm_storyteller/professional_anchor/playful_host/serious_formal/soft_gentle) OR a concise custom English style description (<=200 chars); default = teacher style or friendly_teacher. Voice (--tts-id) changes timbre; style changes tone/persona. Call courseware_ai_teachers first to pick a real teacher.',
      inputSchema: {
        mcp_session_id: z.string().min(1),
        argv: z.array(z.string()).min(1),
        pretty: z.boolean().optional(),
      },
    },
    async (args) => jsonResult(await coursewareNarrationTool(userSession, args)),
  );

  server.registerTool(
    'courseware_search',
    {
      title: 'Web search',
      description: 'Billed Tavily search on the host (facts for courseware research).',
      inputSchema: {
        mcp_session_id: z.string().min(1),
        query: z.string().min(1),
        search_depth: z.enum(['advanced', 'basic', 'fast', 'ultra-fast']).optional(),
        max_results: z.number().int().min(0).max(20).optional(),
        topic: z.enum(['general', 'news', 'finance']).optional(),
        time_range: z.enum(['day', 'week', 'month', 'year', 'd', 'w', 'm', 'y']).optional(),
        include_answer: z.union([z.boolean(), z.enum(['basic', 'advanced'])]).optional(),
        include_raw_content: z.boolean().optional(),
      },
    },
    async (args) => jsonResult(await coursewareSearchTool(userSession, args)),
  );

  server.registerTool(
    'courseware_image_generate',
    {
      title: 'Generate courseware image (fallback)',
      description:
        'FALLBACK ONLY when Codex cannot generate an image itself. Billed host gpt-image-2.5-sunburst → asset library. Preferred path: generate the image in Codex, then courseware_asset_upload (content_base64), then ainobi_exec element insert --type image. Never use ainobi_exec image.',
      inputSchema: {
        mcp_session_id: z.string().min(1),
        prompt: z.string().min(1).describe('Image generation prompt'),
        size: z.string().optional().describe('Optional size, e.g. 1024x1024'),
        quality: z.string().optional().describe('Optional quality'),
        file_name: z.string().optional().describe('Optional .png file name'),
      },
    },
    async (args) => jsonResult(await coursewareImageGenerateTool(userSession, args)),
  );

  server.registerTool(
    'courseware_asset_list',
    {
      title: 'List courseware assets',
      description:
        'List files already uploaded to the open courseware library (file_id / source URL / name). Prefer before re-uploading.',
      inputSchema: {
        mcp_session_id: z.string().min(1),
        page_number: z.number().int().min(1).optional(),
        page_size: z.number().int().min(1).max(100).optional(),
        file_name: z.string().optional().describe('Optional file name ILIKE filter'),
        order: z.enum(['asc', 'desc']).optional(),
      },
    },
    async (args) => jsonResult(await coursewareAssetsListTool(userSession, args)),
  );

  server.registerTool(
    'courseware_asset_upload',
    {
      title: 'Upload courseware asset',
      description:
        'Upload a file into the open courseware asset library (OSS + DB). Preferred for Codex-generated images: pass content_base64 (+ file_name). For larger files already in the MCP work_dir, use workspace_path. Returns source for element insert.',
      inputSchema: {
        mcp_session_id: z.string().min(1),
        file_name: z
          .string()
          .optional()
          .describe('Target file name with extension (required unless workspace_path has one)'),
        content_base64: z
          .string()
          .optional()
          .describe('Base64 or data-URL payload (≤20MB decoded); use for Codex-generated images'),
        workspace_path: z
          .string()
          .optional()
          .describe('Path relative to MCP workspace (no ..); prefer for large files already in work_dir'),
      },
    },
    async (args) => jsonResult(await coursewareAssetsUploadTool(userSession, args)),
  );

  server.registerTool(
    'courseware_doc_read',
    {
      title: 'Read document to markdown',
      description:
        'Convert a courseware library file (file_id) or small base64 upload to markdown on the host. Use for PDF/DOCX/PPTX/images and other supported docs before authoring.',
      inputSchema: {
        mcp_session_id: z.string().min(1),
        file_id: z.string().optional().describe('Courseware asset file_id from asset_list/upload'),
        content_base64: z.string().optional().describe('Alternative: small base64 document'),
        file_name: z.string().optional().describe('Name hint when using content_base64'),
        file_extension: z
          .string()
          .optional()
          .describe('Override extension including dot, e.g. .pdf'),
        llm_prompt: z.string().optional().describe('Optional vision prompt for image docs'),
        no_llm: z.boolean().optional().describe('Skip LLM vision for images'),
      },
    },
    async (args) => jsonResult(await coursewareDocReadTool(userSession, args)),
  );

  server.registerTool(
    'courseware_tts_list',
    {
      title: 'List TTS voices',
      description:
        'List org TTS voice catalog. Prefer courseware_ai_teachers for narration; use this only when overriding --tts-id.',
      inputSchema: {
        mcp_session_id: z.string().optional().describe('Open MCP session (uses courseware org)'),
        org_id: z.string().optional().describe('Organization UUID override'),
        provider: z.string().optional(),
        language: z.string().optional(),
        status: z.string().optional().describe('Voice status filter (default active)'),
      },
    },
    async (args) => jsonResult(await coursewareTtsListTool(userSession, args)),
  );

  server.registerTool(
    'courseware_ui_links',
    {
      title: 'Courseware browser links (login-free)',
      description:
        'Get direct browser URLs for the current courseware: student preview, student editor, manage course page. Each URL embeds a short-lived handoff code that the frontend exchanges for a login session automatically — the user does NOT need to log in. Use whenever you want to show the user the courseware in a browser (preview after authoring). Code expires in 5 min / 5 opens; call again to mint a fresh one.',
      inputSchema: {
        mcp_session_id: z
          .string()
          .optional()
          .describe('Open MCP session (uses its bound courseware when courseware_id omitted)'),
        courseware_id: z
          .string()
          .optional()
          .describe('Courseware id or business key; defaults to the open session courseware'),
      },
    },
    async (args) => jsonResult(await coursewareUiLinksTool(userSession, args)),
  );

  server.registerTool(
    'courseware_recall',
    {
      title: 'Recall archived tool result',
      description:
        'Fetch an archived oversized prior tool output by id (scoped to the MCP shell session).',
      inputSchema: {
        mcp_session_id: z.string().min(1),
        id: z.string().min(1).describe('Archived blob id from a prior stub'),
      },
    },
    async (args) => jsonResult(await coursewareRecallTool(userSession, args)),
  );

  return server;
}
