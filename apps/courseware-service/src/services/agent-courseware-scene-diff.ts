// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Host persistence for full scene-sync diff reports (see ainobi-courseware-cli/cli/scene-sync-diff.ts).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  buildSceneDiffReport,
  formatSceneDiffReportPage,
  SCENE_SYNC_DIFF_REPORT_FILENAME,
  summarizeSceneDiff,
  type SceneSyncDiffReport,
} from '@ainobi/courseware-cli/cli/scene-sync-diff.ts';
import { agentAinobiStateDir } from './agent-workspace.ts';

export {
  buildSceneDiffReport,
  formatSceneDiffReportPage,
  summarizeSceneDiff,
  SCENE_SYNC_DIFF_REPORT_FILENAME,
  type SceneSyncDiffReport,
};

export async function writeSceneSyncDiffReport(
  workspaceDir: string,
  beforeScene: unknown,
  afterScene: unknown,
): Promise<{ report: SceneSyncDiffReport; relativePath: string }> {
  const report = buildSceneDiffReport(beforeScene, afterScene);
  const stateDir = agentAinobiStateDir(workspaceDir);
  await mkdir(stateDir, { recursive: true });
  const absolutePath = join(stateDir, SCENE_SYNC_DIFF_REPORT_FILENAME);
  await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return {
    report,
    relativePath: `.ainobi-cli/${SCENE_SYNC_DIFF_REPORT_FILENAME}`,
  };
}
