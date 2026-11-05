// SPDX-License-Identifier: AGPL-3.0-only
// What the player and editor need from the application around them. A host calls configureCoursewareHost once,
// before the first page renders. Only the courseware API requester is required: everything else has a default
// for a host with no classroom features, one signed-in user, and no AI voice input.
import type { ComponentType, ReactNode } from 'react';
import type { AITeacherInfo } from '../schemas/ai_teacher.ts';
import type { CourseInfo } from '../schemas/course.ts';
import type { TTSInfo } from '../schemas/tts.ts';

type Service = Record<string, (...args: any[]) => any>;
type Page<T> = { data: T[]; [field: string]: any };

export type CoursewareHostCourseApi = {
  getCourses(request: any, orgId?: string | null): Promise<Page<CourseInfo>>;
  getCourseTreeNoOrg(courseId: string, mode?: any): Promise<any>;
};
export type CoursewareHostAiTeacherApi = {
  getAITeachers(request: any, orgId?: string | null): Promise<Page<AITeacherInfo>>;
  getAITeacher(aiTeacherId: string, courseId?: string, orgId?: string | null): Promise<AITeacherInfo>;
};
export type CoursewareHostTtsApi = {
  getAllTTS(request: any, orgId?: string | null, pageSize?: number, maxPages?: number): Promise<TTSInfo[]>;
  getTtsStyles(orgId?: string | null): Promise<any>;
};

export type CoursewareRequester = {
  baseUrl: string;
  get(url: string, query?: any, options?: any): Promise<any>;
  post(url: string, data?: any, options?: any): Promise<any>;
  put(url: string, data?: any, options?: any): Promise<any>;
  delete(url: string, data?: any, options?: any): Promise<any>;
  [method: string]: any;
};

export type CoursewareHostAuth = {
  isAuthenticated: boolean;
  isLoading: boolean;
  session: any;
  userInfo: any;
};

export type CoursewareHostConfig = {
  origin: Record<string, string>;
  modules?: { courseware?: { assetPresignEnabled?: boolean; editorAssistantEnabled?: boolean }; [name: string]: any };
  [name: string]: any;
};

export type CoursewareHost = {
  logger: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
  config: CoursewareHostConfig;
  /** The courseware service's API. */
  coursewareApi: CoursewareRequester;
  /** The platform API; only classroom features and the AI teacher and voice lists use it. */
  api: CoursewareRequester;
  sessionManager: { acquireSession: (...args: any[]) => any; setEventCallbacks: (...args: any[]) => any; [method: string]: any };
  useAuth: () => CoursewareHostAuth;
  ProtectedRoute: ComponentType<{ children: ReactNode; redirectTo?: string }>;
  FeatureGate: ComponentType<{ capability: string; mode?: any; children: ReactNode; [prop: string]: any }>;
  useOrgStudentIdentity: (orgId: string | null) => any;
  courseApi: CoursewareHostCourseApi;
  courseSectionApi: Service;
  publicCourseApi: Service;
  aiTeacherApi: CoursewareHostAiTeacherApi;
  ttsApi: CoursewareHostTtsApi;
  interactionAgent: Service;
  useWhisperVoiceDictation: (options: any) => any;
  notifyEmbedSaved: (coursewareId: string | null | undefined) => void;
  /** Offered where the AI teacher list is empty. Without it, the list only says that it is empty. */
  onCreateAiTeacher?: () => void;
};

const unavailable = (name: string): Service =>
  new Proxy({}, {
    get: (_target, method) => () => {
      throw new Error(`@ainobi/courseware-player: ${name}.${String(method)} needs configureCoursewareHost`);
    },
  });

const noRequester = unavailable('coursewareApi') as unknown as CoursewareRequester;

let host: CoursewareHost = {
  logger: console,
  config: { origin: {} },
  coursewareApi: noRequester,
  api: noRequester,
  sessionManager: { acquireSession: async () => null, setEventCallbacks: () => undefined, checkSession: async () => true },
  useAuth: () => ({ isAuthenticated: true, isLoading: false, session: null, userInfo: null }),
  ProtectedRoute: ({ children }) => children as any,
  FeatureGate: ({ children }) => children as any,
  useOrgStudentIdentity: () => ({ name: null, avatarUrl: null }),
  courseApi: { getCourses: async () => ({ data: [] }), getCourseTreeNoOrg: async () => null },
  courseSectionApi: unavailable('courseSectionApi'),
  publicCourseApi: unavailable('publicCourseApi'),
  aiTeacherApi: {
    getAITeachers: async () => ({ data: [] }),
    getAITeacher: async (id) => {
      throw new Error(`@ainobi/courseware-player: AI teacher ${id} needs configureCoursewareHost`);
    },
  },
  ttsApi: { getAllTTS: async () => [], getTtsStyles: async () => null },
  interactionAgent: { isInteractionApiConfigured: () => false },
  // Pages call this hook unconditionally, so "off" has to be a state and not an error.
  useWhisperVoiceDictation: () => ({
    state: 'idle',
    error: null,
    isActive: false,
    start: async () => undefined,
    stop: () => undefined,
    getAnalyser: () => null,
  }),
  notifyEmbedSaved: () => undefined,
};

export function configureCoursewareHost(overrides: Partial<CoursewareHost>): void {
  host = { ...host, ...overrides };
}

export const currentHost = (): CoursewareHost => host;

/** A stand-in for a host object: reads it on every use, so modules may import it before the host is configured. */
export function lazyService<T extends object>(read: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const service = read();
      const value = Reflect.get(service, property);
      return typeof value === 'function' ? value.bind(service) : value;
    },
  });
}
