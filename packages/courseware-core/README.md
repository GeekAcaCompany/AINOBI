# @ainobi/courseware-core

The AINOBI courseware engine: the scene model (slides, elements, narration, quiz), yup validation, serialization, quiz ASTs and scoring, and the asset-URL presign pass. It is runtime-neutral — no React, no Node APIs, no filesystem, no API client — so the same code runs in the browser editor and player, in the agent CLI, and on the courseware service.

Consumers in this repository: `apps/student-frontend` (editor and preview), `@ainobi/courseware-cli`, and `apps/courseware-service`. There is one copy; never fork a module into an app.

## Imports

Import everything from `@ainobi/courseware-core`, or one module by subpath. The modules are listed explicitly in `package.json` (`elements`, `scene`, `quiz`, `quiz-ast`, `rich-ast`, `presign-scene`, `slide-stack`, …, plus `enums/*`); anything else is internal.

- Inside this repository the subpaths carry the source extension — `@ainobi/courseware-core/quiz.ts` — and resolve to the TypeScript sources; bundlers and `tsx` compile them (apps that bundle with tsup list `@ainobi/*` in `noExternal`).
- The published package (`pnpm --filter @ainobi/courseware-core build`, then `pack`) exposes the same modules without the extension — `@ainobi/courseware-core/quiz` — backed by `dist/` (ESM and type declarations). `node scripts/verify-public-packages.mjs` checks that it installs and imports outside the repository.

## What a host provides

The engine never decides deployment policy or presentation language on its own. A host (an app, the CLI, or a third-party integration) injects:

| Concern | API | Default |
| --- | --- | --- |
| Quiz validation messages | `validateQuizConfig(config, messages)`, `validateQuizSlideBindings(config, slides, messages)`, `validateQuizForScene(scene, messages)`; `messages` is a `QuizValidationMessages` formatter `(key, variables) => string` | English with CLI hints (`defaultQuizValidationMessages`) |
| Default content language | `createDefaultQuestion(type, language)`, `createDefaultQuestionWithAst(type, language)`, `createDefaultQuizScoreSummaryConfig(language)`, `ensureQuizScoreSummaryConfig(config, language)`; `language` is the courseware content language (`zh` / `en` / `ja`) | none — pass it |
| New-question shape | `createDefaultQuestion(type, language, { singleChoiceOptionCount })` | four single-choice options |
| Asset signing | `tryPresignSceneAssetUrls(scene, coursewareId, presign)`; `presign(urls)` returns original → signed and is called in batches of at most 100 URLs | — |
| Persistence URL policy | `prepareSceneAssetUrlsForPersistence(scene, normalize)`, `stripAssetUrlsForPersistence(scene, normalize)` | — |

The validation issue keys (`QuizValidationMessageKey`) are stable; the student frontend maps them onto its locale files (`coursewareEditor.quizValidation.<key>`), the CLI uses the English default.

## Tests

`pnpm test` at the repository root runs the vitest suite (`src/**/*.test.ts`). Files ending in `.cli.test.ts` are the agent-CLI lineage's cases for the same modules.
