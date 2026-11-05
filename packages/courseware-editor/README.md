# @ainobi/courseware-editor

The AINOBI courseware editor for React, built on `@ainobi/courseware-player`.

Runtime: browser, React 19, React Router 7.

```tsx
import { configureCoursewareHost } from '@ainobi/courseware-editor';
import CoursewareEditor from '@ainobi/courseware-editor/routes/courseware-editor';

configureCoursewareHost({
  config: { origin: { coursewareApi: 'http://127.0.0.1:5633' } },
  coursewareApi: myRequester,
});

// Render <CoursewareEditor /> at a route of your app; it reads the courseware id from the query string.
```

Add the `src` directories of this package and of `@ainobi/courseware-player` to your Tailwind content. The host settings are those of [`@ainobi/courseware-player`](../courseware-player/README.md).
