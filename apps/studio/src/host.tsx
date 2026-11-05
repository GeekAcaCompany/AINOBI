// SPDX-License-Identifier: AGPL-3.0-only
// Connects the courseware packages to the local service. The server hands this page its session on load.
import { configureAvatar } from '@ainobi/avatar';
import { configureCoursewareHost } from '@ainobi/courseware-player';
import { createCoursewareRequester } from '@ainobi/courseware-player/host/simple-requester';
import type { ReactNode } from 'react';
import { startStudioEmbed } from './embed.ts';
import { createTeacherClient, openTeacherDialog, type TeacherClient } from './teachers.ts';

export type StudioConfig = {
  accessToken: string;
  orgId: string;
  coursewareApi: string;
  platformApi: string;
  videoRender: boolean;
  teacherGeneration: boolean;
  editorAssistant: boolean;
  embedOrigins: string[];
};

export async function loadStudioConfig(): Promise<StudioConfig> {
  const response = await fetch('/local/session');
  if (!response.ok) throw new Error(`The Studio server answered ${response.status}`);
  return (await response.json()) as StudioConfig;
}

/** Connects the packages, and returns the client the AI teacher screens use. */
export function connectStudio(config: StudioConfig): TeacherClient {
  const getAccessToken = () => config.accessToken;
  const session = {
    access_token: config.accessToken,
    current_org_id: config.orgId,
    user_id: 'local',
    roles: ['manager'],
  };
  const api = createCoursewareRequester({ baseUrl: config.platformApi, getAccessToken });
  const teachers = createTeacherClient(api, config.orgId);
  const embed = startStudioEmbed(config.embedOrigins);
  configureAvatar({ assetPresignEnabled: false });
  configureCoursewareHost({
    config: {
      origin: { coursewareApi: config.coursewareApi, api: config.platformApi, manage: '', static: '' },
      modules: { courseware: { assetPresignEnabled: true, editorAssistantEnabled: config.editorAssistant } },
    },
    coursewareApi: createCoursewareRequester({ baseUrl: config.coursewareApi, getAccessToken }),
    api,
    aiTeacherApi: {
      getAITeachers: async () => ({ data: await teachers.list() }),
      getAITeacher: (id) => api.get(`/organization/${config.orgId}/ai_teacher/${encodeURIComponent(id)}/info`),
    },
    onCreateAiTeacher: openTeacherDialog,
    notifyEmbedSaved: (coursewareId) => {
      if (coursewareId) embed?.saved(coursewareId);
    },
    ttsApi: {
      getAllTTS: async (request, orgId) => (await api.get(`/organization/${orgId ?? config.orgId}/tts/list`, { ...request, page_size: 500 })).data,
      getTtsStyles: (orgId) => api.get(`/organization/${orgId ?? config.orgId}/tts/styles`),
    },
    sessionManager: {
      acquireSession: async () => session,
      setEventCallbacks: () => undefined,
      checkSession: async () => true,
      getEffectiveRole: () => 'manager',
    },
    useAuth: () => ({ isAuthenticated: true, isLoading: false, session, userInfo: { user_id: 'local', user_name: 'Local user' } }),
    // Video export is the one optional piece: its button stays disabled until the container is running.
    FeatureGate: ({ capability, mode, children, fallback }) => {
      if (capability !== 'video.render' || config.videoRender) return children;
      if (mode === 'hide') return fallback ?? null;
      return <FeatureOff>{children}</FeatureOff>;
    },
  });
  return teachers;
}

function FeatureOff({ children }: { children: ReactNode }) {
  return (
    <span title="Video export needs the video-render container. See docs/video-export.md." style={{ opacity: 0.5, pointerEvents: 'none' }}>
      {children}
    </span>
  );
}
