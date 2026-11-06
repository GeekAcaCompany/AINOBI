// SPDX-License-Identifier: AGPL-3.0-only
// The local workspace's AI teachers: one that ships with Studio, and those a user generates. Records are one JSON
// file, and generated models sit beside it, so a workspace is still just the .ainobi directory.
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const BUILT_IN_TEACHER_ID = '00000000-0000-4000-8000-000000000003';
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
 * @param {{voice?: object, style?: string, stylePrompt?: string | null}} [options.speech] how a teacher speaks
 * @param {(line: string) => void} [options.log]
 */
export function createAiTeacherStore({ dir, orgId, loadGenerator, speech = {}, log = () => undefined }) {
  mkdirSync(dir, { recursive: true });
  const recordsPath = join(dir, 'teachers.json');
  const read = () => (existsSync(recordsPath) ? JSON.parse(readFileSync(recordsPath, 'utf8')) : { teachers: [], builtInRemoved: false });
  const write = (state) => writeFileSync(recordsPath, `${JSON.stringify(state, null, 2)}\n`);
  /** Running and finished generations; they do not need to outlive a restart. */
  const tasks = new Map();

  const builtIn = () =>
    teacherRecord({
      id: BUILT_IN_TEACHER_ID,
      name: 'AINOBI Teacher',
      modelUrl: '/models/geekaca-teacher/geekaca-teacher.model3.json',
      avatarUrl: '/geekaca-teacher.png',
      orgId,
      createdAt: CREATED_AT,
      speech,
    });

  const list = () => {
    const state = read();
    return [...(state.builtInRemoved ? [] : [builtIn()]), ...state.teachers];
  };

  const runTask = async (task, prompt) => {
    task.status = 'processing';
    const outputDir = mkdtempSync(join(dir, 'task-'));
    try {
      const generate = await loadGenerator();
      const result = await generate({ prompt, outputDir });
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

    startGeneration(prompt) {
      const text = String(prompt ?? '').trim();
      if (text.length < 4) throw new AiTeacherError('Describe the teacher in a few more words.', 422);
      if (text.length > MAX_PROMPT) throw new AiTeacherError(`Keep the description under ${MAX_PROMPT} characters.`, 422);
      if (!loadGenerator) throw new AiTeacherError('No image provider is configured.', 409);
      const task = { task_id: randomUUID(), status: 'queued', result: null, error: null, error_code: null };
      tasks.set(task.task_id, task);
      void runTask(task, text);
      return { task_id: task.task_id, status: 'queued' };
    },

    task(id) {
      const task = tasks.get(id);
      if (!task) throw new AiTeacherError('That generation is not known here. It may have been lost in a restart.', 404);
      return task;
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
