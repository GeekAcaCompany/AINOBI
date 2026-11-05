// SPDX-License-Identifier: AGPL-3.0-only
// The AI teacher calls Studio makes, and a small store so the list page and the editor's menu share the create dialog.
import { useSyncExternalStore } from 'react';
import type { AITeacherInfo } from '@ainobi/courseware-player/schemas/ai_teacher';
import type { CoursewareRequester } from '@ainobi/courseware-player';

export type GenerationTask = {
  task_id: string;
  status: 'queued' | 'processing' | 'succeeded' | 'failed';
  result: { model_url: string; preview_url: string } | null;
  error: string | null;
};

export type TeacherClient = ReturnType<typeof createTeacherClient>;

export function createTeacherClient(api: CoursewareRequester, orgId: string) {
  const base = `/organization/${orgId}/ai_teacher`;
  return {
    list: async (): Promise<AITeacherInfo[]> => (await api.get(`${base}/list`)).data,
    generate: (prompt: string): Promise<{ task_id: string }> => api.post(`${base}/generate_avatar_temp`, { prompt }),
    task: (id: string): Promise<GenerationTask> => api.get(`${base}/generate_avatar_temp/${encodeURIComponent(id)}`),
    create: (name: string, taskId: string): Promise<AITeacherInfo> => api.post(`${base}/create`, { ai_teacher_name: name, task_id: taskId }),
    remove: (id: string): Promise<void> => api.post(`${base}/${encodeURIComponent(id)}/remove`),
  };
}

// Whether the create dialog is open, and a counter that makes open lists reload after a change.
let state = { open: false, revision: 0 };
const listeners = new Set<() => void>();
const set = (next: Partial<typeof state>) => {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
};

export const openTeacherDialog = (): void => set({ open: true });
export const closeTeacherDialog = (): void => set({ open: false });
export const teachersChanged = (): void => set({ revision: state.revision + 1 });

export const useTeacherUi = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
