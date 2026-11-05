// SPDX-License-Identifier: AGPL-3.0-only
/** Host-injected platform org for courseware create/save (see chat `applyCoursewarePersistenceEnv`). */
import { cliEnv } from "./env.ts";

export const AINOBI_COURSEWARE_ORG_ID_ENV = "AINOBI_COURSEWARE_ORG_ID";

export const coursewareOrgIdFromEnv = (
  env: NodeJS.ProcessEnv = cliEnv(),
): string | undefined => {
  const orgId = env[AINOBI_COURSEWARE_ORG_ID_ENV]?.trim();
  return orgId || undefined;
};
