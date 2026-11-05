# @ainobi/courseware-player

Plays AINOBI courseware in React: the stage, timeline, narration, quizzes, the preview and render pages, and the client for the courseware service's API.

Runtime: browser, React 19, React Router 7.

```tsx
import { configureCoursewareHost } from '@ainobi/courseware-player';
import CoursewarePreview from '@ainobi/courseware-player/routes/courseware-preview';

configureCoursewareHost({
  config: { origin: { coursewareApi: 'http://127.0.0.1:5633' } },
  coursewareApi: myRequester,
});

// Render <CoursewarePreview /> at a route of your app; it reads the courseware id from the query string.
```

Add `packages/courseware-player/src` to your Tailwind content, since the components use Tailwind classes.

## Host settings

`configureCoursewareHost` is the only way the package reaches the application around it. See `CoursewareHost` in `src/host/host.ts`.

| Setting | Needed for | Default |
| --- | --- | --- |
| `coursewareApi`, `config` | everything | none; calls fail until set |
| `api` | classroom data, AI teacher and voice lists | none |
| `logger` | logs | `console` |
| `useAuth`, `ProtectedRoute`, `sessionManager` | signed-in pages | one signed-in user, no redirect |
| `FeatureGate` | switching features by capability | everything on |
| `courseApi`, `courseSectionApi`, `publicCourseApi`, `useOrgStudentIdentity` | courseware inside a course | empty |
| `aiTeacherApi`, `ttsApi` | AI teachers and voices | empty lists |
| `interactionAgent`, `useWhisperVoiceDictation` | AI questions and voice input in a lesson | off |
| `notifyEmbedSaved` | telling an embedding page about a save | nothing |

## Entry points

Files keep their paths as subpaths, for example `@ainobi/courseware-player/lib/courseware/index`. `routes/courseware-preview` and `routes/courseware-renderer` are complete pages.
