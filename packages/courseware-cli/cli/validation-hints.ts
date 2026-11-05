// SPDX-License-Identifier: AGPL-3.0-only
import type { CliIssue } from "./errors.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Turn common schema/CLI mistakes into actionable hints on element validation errors.
 */
export const enrichElementValidationHint = (issues: CliIssue[]): string | undefined => {
  const hints = new Set<string>();

  for (const issue of issues) {
    const message = issue.message.toLowerCase();

    if (message.includes("unspecified keys") && isRecord(issue.value) && "z_index" in issue.value) {
      hints.add("Use `--set style.z_index=<n>` — `z_index` belongs under `style`, not at the element root.");
    }

    if (
      issue.path.endsWith(".text") &&
      message.includes("string") &&
      typeof issue.value === "number"
    ) {
      hints.add(
        'Numeric-looking text (e.g. `01`) must use `--set text:str=01` or `--set text=\'"01"\'` — bare digits are auto-coerced to numbers.',
      );
    }

    if (message.includes("unspecified keys") && isRecord(issue.value)) {
      if ("font_color" in issue.value || "font_weight" in issue.value) {
        hints.add("Text elements use `color`, `bold`, and `italic` — not `font_color` or `font_weight`.");
      }
      const style = isRecord(issue.value.style) ? issue.value.style : null;
      if (style && ("color" in style || "font_size" in style || "line_height" in style || "font_weight" in style)) {
        hints.add(
          "Typography belongs on the root (`color`, `font_size`, `line_height`, `bold`, `align`). `--set style.color` / `style.line_height` are aliases; load/save promote editor JSON under `style`.",
        );
      }
    }
  }

  return hints.size > 0 ? [...hints].join(" ") : undefined;
};
