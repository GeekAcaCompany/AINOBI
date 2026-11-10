// SPDX-License-Identifier: AGPL-3.0-only
// The local workspace's AI teachers: one that ships with Studio, and those a user generates. Records are one JSON
// file, and generated models sit beside it, so a workspace is still just the .ainobi directory.
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const BUILT_IN_TEACHER_ID = '00000000-0000-4000-8000-000000000003';
/** The built-in teacher's Inochi2D model, which is also the model of any avatar that names none. */
export const BUILT_IN_TEACHER_MODEL_URL = '/models/ainobi-teacher/ainobi-teacher.inx';
export const BUILT_IN_TEACHER_NAME = 'AINOBI Teacher';
export const BUILT_IN_TEACHER_AVATAR_URL = '/ainobi-teacher.png';
const CREATED_AT = '2026-01-01T00:00:00Z';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_PROMPT = 1200;
const MAX_NAME = 60;

/** Everything a client reads from a teacher; the courseware format stores the model and avatar URLs. */
const teacherRecord = ({ id, name, modelUrl, avatarUrl, orgId, createdAt, introduction = null, speech = {} }) => ({
  ai_teacher_id: id,
  ai_teacher_name: name,
  ai_teacher_status: 'active',
  ai_teacher_introduction: introduction,
  ai_teacher_avatar_url: avatarUrl,
  ai_teacher_live2d_model_url: modelUrl,
  ai_teacher_live2d_model_image_url: avatarUrl,
  ai_teacher_tts_id: speech.voice?.tts_id ?? null,
  ai_teacher_tts: speech.voice ?? null,
  ai_teacher_tts_style: speech.style ?? null,
  ai_teacher_tts_style_prompt: speech.stylePrompt ?? null,
  ai_teacher_tts_speed: 1,
  ai_teacher_tts_volume: 1,
  ai_teacher_tts_pitch: 1,
  ai_teacher_language: null,
  org_id: orgId,
  created_at: createdAt,
  updated_at: createdAt,
});

/** Errors a caller can act on, with the status the API should answer. */
export class AiTeacherError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {object} options
 * @param {string} options.dir where records and models live
 * @param {string} options.orgId the workspace the teachers belong to
 * @param {(() => Promise<(args: {prompt: string, outputDir: string}) => Promise<{modelPath: string, previewPath: string}>>) | null} options.loadGenerator
 *   null when no image provider is configured
 * @param {(() => Promise<typeof import('@ainobi/avatar-generator')>) | null} [options.loadAgentPipeline] the generator
 *   package, for generations an agent draws itself; it needs no key
 * @param {number} [options.agentIdleMs] how long a generation waits for the agent before it stops
 * @param {{voice?: object, style?: string, stylePrompt?: string | null}} [options.speech] how a teacher speaks
 * @param {(line: string) => void} [options.log]
 */
export function createAiTeacherStore({ dir, orgId, loadGenerator, loadAgentPipeline = null, agentIdleMs = undefined, speech = {}, log = () => undefined }) {
  mkdirSync(dir, { recursive: true });
  const recordsPath = join(dir, 'teachers.json');
  const read = () => (existsSync(recordsPath) ? JSON.parse(readFileSync(recordsPath, 'utf8')) : { teachers: [], builtInRemoved: false });
  const write = (state) => writeFileSync(recordsPath, `${JSON.stringify(state, null, 2)}\n`);
  /** Running and finished generations; they do not need to outlive a restart. */
  const tasks = new Map();
  /** For generations the agent draws: the bridge its answers go through, by task id. */
  const bridges = new Map();

  const builtIn = () =>
    teacherRecord({
      id: BUILT_IN_TEACHER_ID,
      name: BUILT_IN_TEACHER_NAME,
      modelUrl: BUILT_IN_TEACHER_MODEL_URL,
      avatarUrl: BUILT_IN_TEACHER_AVATAR_URL,
      orgId,
      createdAt: CREATED_AT,
      speech,
    });

  const list = () => {
    const state = read();
    return [...(state.builtInRemoved ? [] : [builtIn()]), ...state.teachers];
  };

  /** The same pipeline as a hosted generation, with the agent answering each image and vision call. */
  const agentGenerate = async (task, prompt, outputDir) => {
    const pipeline = await loadAgentPipeline();
    const bridge = new pipeline.AgentModelBridge({ dir: join(outputDir, 'agent'), idleMs: agentIdleMs });
    bridges.set(task.task_id, { bridge, AgentAnswerError: pipeline.AgentAnswerError });
    try {
      return await pipeline.generateAvatarModel({ prompt, outputDir, settings: pipeline.AGENT_PIPELINE_SETTINGS, clients: pipeline.agentPipelineClients(bridge) });
    } catch (error) {
      throw bridge.stopReason ? new Error(bridge.stopReason) : error;
    } finally {
      bridges.delete(task.task_id);
    }
  };

  const runTask = async (task, prompt) => {
    task.status = 'processing';
    const outputDir = mkdtempSync(join(dir, 'task-'));
    try {
      const result = task.drawn_by === 'agent' ? await agentGenerate(task, prompt, outputDir) : await (await loadGenerator())({ prompt, outputDir });
      const taskDir = join(dir, 'tasks', task.task_id);
      mkdirSync(taskDir, { recursive: true });
      copyFileSync(result.modelPath, join(taskDir, 'model.inx'));
      copyFileSync(result.previewPath, join(taskDir, 'preview.png'));
      task.status = 'succeeded';
      task.result = { model_url: `/local/ai-teachers/tasks/${task.task_id}/model.inx`, preview_url: `/local/ai-teachers/tasks/${task.task_id}/preview.png` };
    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      log(`[ai-teachers] generation failed: ${task.error}`);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  };

  return {
    canGenerate: () => loadGenerator !== null,
    list,
    get: (id) => list().find((teacher) => teacher.ai_teacher_id === id) ?? null,

    /** drawnBy 'agent': the calling agent draws and checks every image itself, so no provider key is needed. */
    startGeneration(prompt, drawnBy = 'host') {
      const text = String(prompt ?? '').trim();
      if (text.length < 4) throw new AiTeacherError('Describe the teacher in a few more words.', 422);
      if (text.length > MAX_PROMPT) throw new AiTeacherError(`Keep the description under ${MAX_PROMPT} characters.`, 422);
      if (drawnBy !== 'host' && drawnBy !== 'agent') throw new AiTeacherError('drawn_by is host or agent.', 422);
      if (drawnBy === 'agent' && !loadAgentPipeline) throw new AiTeacherError('Generations drawn by the agent are not available here.', 409);
      if (drawnBy === 'host' && !loadGenerator) {
        throw new AiTeacherError('No image provider is configured: set OPENAI_API_KEY, or let an agent that can draw generate the teacher.', 409);
      }
      const task = { task_id: randomUUID(), status: 'queued', drawn_by: drawnBy, result: null, error: null, error_code: null };
      tasks.set(task.task_id, task);
      void runTask(task, text);
      return { task_id: task.task_id, status: 'queued', drawn_by: drawnBy };
    },

    /** The task, with the request the agent should answer now while one is waiting. */
    task(id) {
      const task = tasks.get(id);
      if (!task) throw new AiTeacherError('That generation is not known here. It may have been lost in a restart.', 404);
      return { ...task, agent_request: bridges.get(id)?.bridge.pending ?? null };
    },

    /** The agent's answer to the waiting request: a drawing's image_path, or a verdict's JSON answer. */
    async answerAgentRequest(id, { request_id: requestId, image_path: imagePath, answer } = {}) {
      const entry = bridges.get(id);
      if (!entry?.bridge.pending) throw new AiTeacherError('That generation is not waiting for the agent.', 409);
      try {
        await entry.bridge.answer(String(requestId ?? ''), { image_path: imagePath, answer });
      } catch (error) {
        if (error instanceof entry.AgentAnswerError) throw new AiTeacherError(error.message, 422);
        throw error;
      }
      return { accepted: true };
    },

    create({ name, taskId }) {
      const teacherName = String(name ?? '').trim();
      if (!teacherName || teacherName.length > MAX_NAME) throw new AiTeacherError(`Give the teacher a name of up to ${MAX_NAME} characters.`, 422);
      const task = tasks.get(taskId);
      if (task?.status !== 'succeeded') throw new AiTeacherError('That generation has not finished.', 409);
      const id = randomUUID();
      const teacherDir = join(dir, id);
      mkdirSync(teacherDir, { recursive: true });
      const taskDir = join(dir, 'tasks', taskId);
      copyFileSync(join(taskDir, 'model.inx'), join(teacherDir, 'model.inx'));
      copyFileSync(join(taskDir, 'preview.png'), join(teacherDir, 'preview.png'));
      rmSync(taskDir, { recursive: true, force: true });
      tasks.delete(taskId);
      const teacher = teacherRecord({
        id,
        name: teacherName,
        modelUrl: `/local/ai-teachers/${id}/model.inx`,
        avatarUrl: `/local/ai-teachers/${id}/preview.png`,
        orgId,
        createdAt: new Date().toISOString(),
        speech,
      });
      const state = read();
      state.teachers.push(teacher);
      write(state);
      return teacher;
    },

    remove(id) {
      const state = read();
      if (id === BUILT_IN_TEACHER_ID) {
        write({ ...state, builtInRemoved: true });
        return;
      }
      if (!UUID.test(id) || !state.teachers.some((teacher) => teacher.ai_teacher_id === id)) {
        throw new AiTeacherError('That teacher does not exist.', 404);
      }
      write({ ...state, teachers: state.teachers.filter((teacher) => teacher.ai_teacher_id !== id) });
      rmSync(join(dir, id), { recursive: true, force: true });
    },
  };
}

/** The file on disk behind a /local/ai-teachers URL, or null for anything but a model or preview of a known shape. */
export function teacherFilePath(dir, pathname) {
  const match = /^\/local\/ai-teachers\/(tasks\/)?([0-9a-f-]{36})\/(model\.inx|preview\.png)$/.exec(pathname);
  if (!match || !UUID.test(match[2])) return null;
  return join(dir, match[1] ? 'tasks' : '', match[2], match[3]);
}

/**
 * The generator, when the settings hold a key. Same settings and defaults as the platform backend. Loaded on first
 * use, since most runs never generate. Which key applies is the generator package's rule (avatarApiKeyFromEnv), shared
 * with the platform backend.
 */
export function generatorFromEnv(env, importGenerator, apiKeyFromEnv) {
  const apiKey = apiKeyFromEnv(env);
  if (!apiKey) return null;
  const settings = {
    apiKey,
    apiBase: env.LLM_API_BASE?.trim() || 'https://api.openai.com/v1',
    imageModel: env.AVATAR_IMAGE_MODEL?.trim() || env.IMAGE_MODEL?.trim() || 'gpt-image-2.5-sunburst',
    visionModel: env.AVATAR_VISION_MODEL?.trim() || 'gpt-5.6',
  };
  return async () => {
    const { generateAvatarModel } = await importGenerator();
    return ({ prompt, outputDir }) => generateAvatarModel({ prompt, outputDir, settings });
  };
}
