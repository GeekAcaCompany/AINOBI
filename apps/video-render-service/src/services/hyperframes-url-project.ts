// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface HyperframesRedirectProjectOptions {
  targetUrl: string;
  width: number;
  height: number;
  durationSec: number;
  compositionId?: string;
}

/** Temp project with bridge index.html so Hyperframes compile stage can read composition metadata. */
export function buildHyperframesRedirectProject(
  options: HyperframesRedirectProjectOptions,
): string {
  const projectDir = mkdtempSync(join(tmpdir(), "ainobi-hf-"));
  const compositionId = options.compositionId ?? "external-page";
  const targetUrlJson = JSON.stringify(options.targetUrl);
  // Omit data-duration when 0 so Hyperframes treats duration as unknown and probes
  // window.__hf.duration on the live courseware page (also enables audio discovery).
  const durationAttr =
    options.durationSec > 0 ? `\n    data-duration="${options.durationSec}"` : "";

  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>redirect</title>
</head>
<body>
  <div
    id="stage"
    data-composition-id="${compositionId}"
    data-start="0"
    data-width="${options.width}"
    data-height="${options.height}"${durationAttr}
  ></div>
  <script>
    window.location.replace(${targetUrlJson});
  </script>
</body>
</html>
`;

  writeFileSync(join(projectDir, "index.html"), indexHtml, "utf8");
  return projectDir;
}
