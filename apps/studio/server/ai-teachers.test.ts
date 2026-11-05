// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiTeacherError, BUILT_IN_TEACHER_ID, createAiTeacherStore, generatorFromEnv, teacherFilePath } from './ai-teachers.mjs';
import { answer, LOCAL_ORG_ID } from './local-host.mjs';

const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-teachers-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const fakeGenerator = (behaviour: 'ok' | 'fail' = 'ok') => async () => async ({ outputDir }: { outputDir: string }) => {
  if (behaviour === 'fail') throw new Error('rejected by visual QA');
  const modelPath = join(outputDir, 'model.inx');
  const previewPath = join(outputDir, 'base.png');
  writeFileSync(modelPath, 'model');
  writeFileSync(previewPath, 'png');
  return { modelPath, previewPath };
};

const store = (loadGenerator: unknown = fakeGenerator(), dir = tempDir()) => createAiTeacherStore({ dir, orgId: LOCAL_ORG_ID, loadGenerator: loadGenerator as never });

const finished = async (teachers: ReturnType<typeof store>, id: string) => {
  await vi.waitFor(() => expect(['succeeded', 'failed']).toContain(teachers.task(id).status));
  return teachers.task(id);
};

describe('AI teacher store', () => {
  it('ships with one teacher, whose model comes with the app', () => {
    const [teacher] = store().list();
    expect(teacher).toMatchObject({ ai_teacher_id: BUILT_IN_TEACHER_ID, ai_teacher_status: 'active', ai_teacher_live2d_model_url: '/models/geekaca-teacher/geekaca-teacher.model3.json' });
  });

  it('generates, keeps the result, and lists it after a restart', async () => {
    const dir = tempDir();
    const teachers = store(fakeGenerator(), dir);
    const { task_id } = teachers.startGeneration('A warm science teacher');
    const task = await finished(teachers, task_id);
    expect(task.status).toBe('succeeded');
    expect(task.result.model_url).toBe(`/local/ai-teachers/tasks/${task_id}/model.inx`);

    const created = teachers.create({ name: ' Ms. Lin ', taskId: task_id });
    expect(created.ai_teacher_name).toBe('Ms. Lin');
    expect(existsSync(join(dir, created.ai_teacher_id, 'model.inx'))).toBe(true);
    expect(existsSync(join(dir, 'tasks', task_id))).toBe(false);
    expect(store(fakeGenerator(), dir).list().map((teacher) => teacher.ai_teacher_name)).toEqual(['AINOBI Teacher', 'Ms. Lin']);
  });

  it('reports a failed generation as data, and will not save it', async () => {
    const teachers = store(fakeGenerator('fail'));
    const { task_id } = teachers.startGeneration('A warm science teacher');
    const task = await finished(teachers, task_id);
    expect(task).toMatchObject({ status: 'failed', error: 'rejected by visual QA' });
    expect(() => teachers.create({ name: 'x', taskId: task_id })).toThrow(/has not finished/);
  });

  it('refuses to generate without a provider, or from too little', () => {
    expect(() => store(null).startGeneration('A warm teacher')).toThrow(/No image provider/);
    expect(() => store().startGeneration('hi')).toThrow(/few more words/);
    expect(store(null).canGenerate()).toBe(false);
  });

  it('can remove any teacher, leaving an empty list and the removal in place after a restart', async () => {
    const dir = tempDir();
    const teachers = store(fakeGenerator(), dir);
    const { task_id } = teachers.startGeneration('A warm science teacher');
    await finished(teachers, task_id);
    const created = teachers.create({ name: 'Lin', taskId: task_id });
    teachers.remove(created.ai_teacher_id);
    expect(existsSync(join(dir, created.ai_teacher_id))).toBe(false);
    teachers.remove(BUILT_IN_TEACHER_ID);
    expect(teachers.list()).toEqual([]);
    expect(store(fakeGenerator(), dir).list()).toEqual([]);
    expect(() => teachers.remove('../../etc')).toThrow(AiTeacherError);
  });
});

describe('teacherFilePath', () => {
  const id = '11111111-1111-4111-8111-111111111111';

  it('maps only models and previews with a real id', () => {
    expect(teacherFilePath('/d', `/local/ai-teachers/${id}/model.inx`)).toBe(join('/d', id, 'model.inx'));
    expect(teacherFilePath('/d', `/local/ai-teachers/tasks/${id}/preview.png`)).toBe(join('/d', 'tasks', id, 'preview.png'));
  });

  it('refuses anything else, the records file and traversal included', () => {
    expect(teacherFilePath('/d', '/local/ai-teachers/teachers.json')).toBeNull();
    expect(teacherFilePath('/d', `/local/ai-teachers/${id}/secret.txt`)).toBeNull();
    expect(teacherFilePath('/d', '/local/ai-teachers/../../secrets.json')).toBeNull();
    expect(teacherFilePath('/d', '/local/ai-teachers/------------------------------------/model.inx')).toBeNull();
  });
});

describe('generatorFromEnv', () => {
  it('is off without a key', () => {
    expect(generatorFromEnv({}, async () => ({}))).toBeNull();
    expect(generatorFromEnv({ OPENAI_API_KEY: 'o' }, async () => ({}))).toBeNull();
  });

  it('reads the same settings as the platform backend, and passes them to the pipeline', async () => {
    const generateAvatarModel = vi.fn(async () => ({ modelPath: 'm', previewPath: 'p' }));
    const load = generatorFromEnv({ LLM_API_KEY: 'a', AVATAR_IMAGE_MODEL: 'img' }, async () => ({ generateAvatarModel }));
    const generate = await load!();
    await generate({ prompt: 'p', outputDir: 'd' });
    expect(generateAvatarModel).toHaveBeenCalledWith({ prompt: 'p', outputDir: 'd', settings: expect.objectContaining({ apiKey: 'a', imageModel: 'img' }) });
  });
});

describe('local host teacher routes', () => {
  const call = (teachers: ReturnType<typeof store>, method: string, path: string, body?: unknown, bearer = 't') =>
    answer({ method, path, bearer, token: "t", body: body as never, teachers: teachers as never });
  const base = `/v1/organization/${LOCAL_ORG_ID}/ai_teacher`;

  it('lists teachers and finds one under both paths', () => {
    const teachers = store();
    expect(call(teachers, 'GET', `${base}/list`)!.body).toMatchObject({ code: 0, data: { total_count: 1 } });
    expect(call(teachers, 'GET', `/v1/ai_teacher/${BUILT_IN_TEACHER_ID}/info`)!.status).toBe(200);
    expect(call(teachers, 'GET', `${base}/${BUILT_IN_TEACHER_ID}/info`)!.status).toBe(200);
    expect(call(teachers, 'GET', `/v1/ai_teacher/nope/info`)!.status).toBe(404);
  });

  it('turns a store refusal into its status, and needs the token', () => {
    const teachers = store(null);
    expect(call(teachers, 'POST', `${base}/generate_avatar_temp`, { prompt: 'A warm teacher' })!.status).toBe(409);
    expect(call(teachers, 'GET', `${base}/generate_avatar_temp/nope`)!.status).toBe(404);
    expect(call(teachers, 'GET', `${base}/list`, undefined, 'wrong')!.status).toBe(401);
  });

  it('starts a generation with 202', () => {
    const response = call(store(), 'POST', `${base}/generate_avatar_temp`, { prompt: 'A warm teacher' })!;
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ data: { status: 'queued' } });
  });
});
