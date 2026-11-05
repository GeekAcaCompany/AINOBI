// SPDX-License-Identifier: AGPL-3.0-only
import 'reflect-metadata';
import { createServer } from 'node:http';

import './ensure-env.ts';
import {
  checkVideoRenderRuntimeDependencies,
  isQueryFunctionRole,
  isRenderFunctionRole,
} from './config/video-render.ts';
import { ensureDataSource } from './db/ensure-data-source.ts';
import { createHttpHandler } from './http/routes.ts';
import { registerFcRenderInstanceExitHandler } from './fc-instance-lifecycle.ts';
import {
  recoverOrphanedRenderTasksOnStartup,
  startOrphanReconcileLoop,
} from './services/render-task-dispatcher.ts';
import { logVideoRenderStartupDiagnostics } from './startup-log.ts';

function resolvePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const port = Number(process.env.PORT ?? 5633);
const server = createServer(createHttpHandler());

// These bound only how long we wait to *receive* a request (headers/body),
// not how long a handler may take to respond — a long-running video render
// is unaffected. Render bodies are tiny JSON, so a short timeout here just
// closes slow/incomplete uploads faster.
server.requestTimeout = resolvePositiveIntEnv('AINOBI_HTTP_REQUEST_TIMEOUT_MS', 30_000);
server.headersTimeout = resolvePositiveIntEnv('AINOBI_HTTP_HEADERS_TIMEOUT_MS', 60_000);

server.on('error', (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`[shutdown] received ${signal}; closing gracefully…`);

  server.close((error) => {
    if (error) {
      console.error('[shutdown] error while closing http server:', error.message);
    } else {
      console.log('[shutdown] http server closed');
    }
    process.exit(0);
  });

  // Don't hang forever waiting on a slow in-flight render.
  setTimeout(() => {
    console.warn('[shutdown] forced exit after grace period');
    process.exit(0);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

registerFcRenderInstanceExitHandler((reason) => {
  console.info(`[shutdown] fc render instance exit: ${reason}`);
  process.exit(0);
});

server.listen(port, () => {
  logVideoRenderStartupDiagnostics(port);

  // Non-blocking: /health and query endpoints don't need Postgres; render handlers call
  // `ensureDataSource()` again when needed. Orphan recovery runs on every role so query
  // instances can fail/callback tasks left `running` after an FC hard kill.
  ensureDataSource()
    .then(() => recoverOrphanedRenderTasksOnStartup())
    .catch((error) => {
      console.warn(
        '[startup] database unavailable; render task pool endpoints will fail until it recovers:',
        error instanceof Error ? error.message : error,
      );
    });

  // Long-lived query (or local `all`) instances keep sweeping; render-only instances
  // exit after each /run so a one-shot startup sweep is enough there.
  if (isQueryFunctionRole()) {
    startOrphanReconcileLoop();
  }

  if (isRenderFunctionRole()) {
    const runtimeCheck = checkVideoRenderRuntimeDependencies();
    if (!runtimeCheck.ok) {
      console.error("[startup] runtime dependency check failed — renders may fail until fixed");
    }
  }

  console.log(`AINOBI video render service listening on http://localhost:${port}`);
});
