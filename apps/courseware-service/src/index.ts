// SPDX-License-Identifier: AGPL-3.0-only
import '@ainobi/courseware-cli/polyfill/pdf-node-globals.ts';
import 'reflect-metadata';
import { createServer } from 'node:http';

import { delimiter, resolve } from 'node:path';

import './ensure-env.ts';
import { createHttpHandler } from './http/routes.ts';
import { coursewareCliRoot, projectRoot } from './runtime-paths.ts';
import { getAinobiCliHelpContext } from './services/ainobi-cli-help-context.ts';
import { startCreditsConsumeRetryWorker } from './services/credits-consume-retry.ts';
import { startCoursewareOrphanJanitor } from './services/courseware-orphan-janitor.ts';
import { startCoursewareQuizProjectionRetryWorker } from './services/courseware-quiz-evaluation-service.ts';
import {
  resolveClaudeSandboxHelperPaths,
  shouldEnableWeakerNestedSandbox,
  shouldUseOsSandbox,
} from './services/agent-sandbox.ts';

export * from './models/index.ts';
export * from './services/courseware-service.ts';
export * from './services/courseware-section-binding-service.ts';
export * from './services/conversation-service.ts';
export * from './services/conversation-chat-history.ts';
export * from './services/ainobi-credits.ts';
export * from './services/narration-tts-credits.ts';
export * from './services/google-narration-credits.ts';
export * from './services/minimax-narration-credits.ts';
export * from './services/narration-tts-billing.ts';
export * from './services/fishaudio-narration-credits.ts';
export * from './services/tavily-search-credits.ts';
export * from './services/credits-consume-retry.ts';
export * from './services/agent-turn-credits.ts';

const systemPath =
  process.env.PATH?.trim() || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';

const binPath = [
  resolve(projectRoot, 'bin'),
  resolve(coursewareCliRoot, 'bin'),
  resolve(coursewareCliRoot, 'node_modules', '.bin'),
  resolve(projectRoot, 'node_modules', '.bin'),
  systemPath,
]
  .filter(Boolean)
  .join(delimiter);

const port = Number(process.env.PORT ?? 5633);
/** HTTP requests log success/failure uniformly in the routes layer (status code, duration, failure details). */
const server = createServer(createHttpHandler());

server.on('error', (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

// Unset listens on every interface, as deployments expect; a local install binds to loopback.
server.listen(port, process.env.HOST?.trim() || undefined, () => {
  startCreditsConsumeRetryWorker();
  startCoursewareOrphanJanitor();
  startCoursewareQuizProjectionRetryWorker();
  if (process.platform === 'linux') {
    const osSandbox = shouldUseOsSandbox();
    const weaker = shouldEnableWeakerNestedSandbox();
    const tools = resolveClaudeSandboxHelperPaths(projectRoot);
    console.log(
      `[ainobi-agent] sandbox osSandbox=${osSandbox} weakerNested=${weaker} bwrap=${tools.bwrapPath ?? 'auto'} socat=${tools.socatPath ?? 'auto'} rg=${tools.rgPath ?? 'MISSING'} apply-seccomp=${tools.applySeccompPath ?? 'MISSING'}`,
    );
  }
  const helpChars = getAinobiCliHelpContext({ cwd: coursewareCliRoot, path: binPath }).length;
  console.log(`AINOBI courseware agent service listening on http://localhost:${port}`);
  if (helpChars > 0) {
    console.log(`[ainobi] CLI help context preloaded (${helpChars} chars for system prompt)`);
  }
});
