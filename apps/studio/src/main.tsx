// SPDX-License-Identifier: AGPL-3.0-only
import '@ainobi/courseware-player/styles/app.css';
import { I18nNewProvider } from '@ainobi/courseware-player/hooks/useI18nNew';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'react-hot-toast';
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router';
import { connectStudio, loadStudioConfig } from './host.tsx';
import { CoursewareList } from './CoursewareList.tsx';
import { TeacherDialog } from './TeacherDialog.tsx';
import type { TeacherClient } from './teachers.ts';

const CoursewareEditor = lazy(() => import('@ainobi/courseware-editor/routes/courseware-editor'));
const CoursewarePreview = lazy(() => import('@ainobi/courseware-player/routes/courseware-preview'));
const CoursewareRenderer = lazy(() => import('@ainobi/courseware-player/routes/courseware-renderer'));
const AvatarDemo = lazy(() => import('./AvatarDemo.tsx'));

const root = createRoot(document.getElementById('root')!);

// A data router: the editor blocks navigation while there are unsaved changes.
const studioRouter = (orgId: string, teachers: TeacherClient) =>
  createBrowserRouter([
    {
      element: (
        <Suspense fallback={<p style={{ padding: 24 }}>Loading…</p>}>
          <Outlet />
        </Suspense>
      ),
      children: [
        { path: '/', element: <CoursewareList orgId={orgId} teachers={teachers} /> },
        { path: '/courseware-editor', element: <CoursewareEditor /> },
        { path: '/courseware-preview', element: <CoursewarePreview /> },
        { path: '/courseware-renderer', element: <CoursewareRenderer /> },
        { path: '/avatar', element: <AvatarDemo /> },
        { path: '/embed/avatar', element: <AvatarDemo /> },
      ],
    },
  ]);

try {
  const config = await loadStudioConfig();
  const teachers = connectStudio(config);
  root.render(
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <I18nNewProvider>
          <RouterProvider router={studioRouter(config.orgId, teachers)} />
          <TeacherDialog client={teachers} canGenerate={config.teacherGeneration} />
          <Toaster position="top-center" />
        </I18nNewProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
} catch (error) {
  root.render(<p style={{ padding: 24 }}>Studio could not start: {error instanceof Error ? error.message : String(error)}</p>);
}
