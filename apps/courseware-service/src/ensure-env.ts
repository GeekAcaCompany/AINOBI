// SPDX-License-Identifier: AGPL-3.0-only
import dotenv from "dotenv";
import { resolve } from "node:path";

import { coursewareCliRoot, projectRoot } from "./runtime-paths.ts";

dotenv.config({ path: resolve(coursewareCliRoot, ".env") });
dotenv.config({ path: resolve(projectRoot, ".env") });
