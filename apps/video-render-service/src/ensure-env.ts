// SPDX-License-Identifier: AGPL-3.0-only
import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDir, "..");

dotenv.config({ path: resolve(projectRoot, ".env") });
