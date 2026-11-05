// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AinobiCliError } from "./errors.ts";
import { flagString, type ParsedArgs } from "./args.ts";

const readStdinSync = (): string => {
  try {
    const data = readFileSync(0, "utf-8");
    return data;
  } catch (error) {
    throw new AinobiCliError(
      "IO_ERROR",
      `Failed to read stdin: ${(error as Error).message}`,
    );
  }
};

export const readPossiblyPipedJson = (sourceHint: string): unknown => {
  const text = readStdinSync().trim();
  if (!text) {
    throw new AinobiCliError(
      "INVALID_INPUT",
      `No data received on stdin for ${sourceHint}.`,
      {
        hint:
          "Piped stdin is often unavailable in agent sandboxes — prefer `--file path.json`, `--react-layout-file layout.json`, or `--jsx-file layout.jsx` instead of `cat … | ainobi … --json -`.",
      },
    );
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AinobiCliError(
      "INVALID_INPUT",
      `Stdin is not valid JSON for ${sourceHint}: ${(error as Error).message}`,
    );
  }
};

const readUtf8File = (path: string): string => {
  try {
    return readFileSync(resolve(path), "utf-8");
  } catch (error) {
    throw new AinobiCliError(
      "IO_ERROR",
      `Cannot read file at ${path}: ${(error as Error).message}`,
    );
  }
};

export const readJsonFile = (path: string): unknown => {
  const raw = readUtf8File(path);
  try {
    return JSON.parse(raw);
  } catch (error) {
    const lower = path.toLowerCase();
    if (lower.endsWith(".svg")) {
      throw new AinobiCliError(
        "INVALID_INPUT",
        `${path} is an SVG file, not JSON.`,
        {
          hint:
            "For inline SVG: use `element insert <slide> --type svg --file payload.json` where the JSON has a `source` string, " +
            "or `element insert <slide> --type svg --file drawing.svg` to load raw SVG into source. " +
            "For OSS-hosted SVG: `element insert <slide> --type svg --asset drawing.svg`.",
        },
      );
    }
    throw new AinobiCliError(
      "INVALID_INPUT",
      `${path} is not valid JSON: ${(error as Error).message}`,
    );
  }
};

/**
 * Like resolveJsonInput, but when --file ends with .svg and is not JSON, returns
 * `{ source: "<svg…>" }` for element insert/update.
 */
export const resolveElementPayloadInput = (
  args: ParsedArgs,
  options: { allowPositional?: string } = {},
): unknown | null => {
  const file = flagString(args, "file");
  if (file !== undefined && file !== "-" && file.toLowerCase().endsWith(".svg")) {
    const raw = readUtf8File(file).trim();
    if (raw.startsWith("{")) {
      try {
        return JSON.parse(raw);
      } catch {
        // fall through: treat as raw SVG markup
      }
    }
    if (!raw.startsWith("<")) {
      throw new AinobiCliError(
        "INVALID_INPUT",
        `${file} does not look like SVG markup or a JSON payload.`,
        {
          hint:
            "Use a .json file with { \"source\": \"<svg…>\", \"size\": … } or a .svg file containing <svg…>.",
        },
      );
    }
    return { source: raw };
  }
  return resolveJsonInput(args, options);
};

/**
 * Resolve JSON input from any of: --json '<inline>' | --file <path> | --stdin | "-".
 * Returns null if none specified, allowing the caller to decide whether the
 * input is required.
 */
export const resolveJsonInput = (
  args: ParsedArgs,
  options: { allowPositional?: string } = {},
): unknown | null => {
  const inline = flagString(args, "json");
  const file = flagString(args, "file");
  const stdinFlag = args.flags["stdin"] === true;
  const positional = options.allowPositional;

  let sources = 0;
  if (inline !== undefined) sources += 1;
  if (file !== undefined) sources += 1;
  if (stdinFlag) sources += 1;
  if (positional === "-") sources += 1;
  if (sources > 1) {
    throw new AinobiCliError(
      "USAGE",
      "Specify only one of --json, --file, --stdin, or `-`.",
    );
  }
  if (inline !== undefined) {
    if (inline === "-") return readPossiblyPipedJson("--json");
    try {
      return JSON.parse(inline);
    } catch (error) {
      throw new AinobiCliError(
        "INVALID_INPUT",
        `--json value is not valid JSON: ${(error as Error).message}`,
      );
    }
  }
  if (file !== undefined) {
    if (file === "-") return readPossiblyPipedJson("--file -");
    return readJsonFile(file);
  }
  if (stdinFlag || positional === "-") {
    return readPossiblyPipedJson("stdin");
  }
  return null;
};
