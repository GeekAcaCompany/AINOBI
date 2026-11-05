// SPDX-License-Identifier: AGPL-3.0-only
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDir, "..");

function collectTestFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }
    if (entry.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

const testFiles = collectTestFiles(join(projectRoot, "src"));
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", "--test-force-exit", "--test-reporter", "spec", ...testFiles],
  {
    stdio: "inherit",
    cwd: projectRoot,
    env: {
      ...process.env,
      // TypeORM validates driver type at DataSource construction (module import time).
      // CI has no .env; unit tests only need a valid driver name, not a live DB.
      DB_TYPE: process.env.DB_TYPE ?? "postgres",
    },
  },
);

process.exit(result.status ?? 1);
