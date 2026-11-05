// SPDX-License-Identifier: AGPL-3.0-only
import { AinobiCliError } from "./errors.ts";

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
  /** Multi-value flags (e.g. repeated --set k=v) preserved in original order. */
  multi: Record<string, string[]>;
  raw: string[];
}

const FLAGS_THAT_REPEAT = new Set(["set", "unset", "field", "tag"]);

/**
 * Lightweight CLI parser tuned for this tool. Supports:
 *   command sub command positional1 positional2
 *   --flag value | --flag=value | --bool | --no-bool
 *   -f shorthand → --f
 *   -- end of options (everything after is positional)
 *   Repeats: --set a=1 --set b=2  → multi.set = ["a=1", "b=2"]
 */
export const parseArgs = (argv: string[]): ParsedArgs => {
  const result: ParsedArgs = {
    positionals: [],
    flags: {},
    multi: {},
    raw: argv,
  };
  let i = 0;
  let endOfOptions = false;
  while (i < argv.length) {
    const token = argv[i];
    if (endOfOptions) {
      result.positionals.push(token);
      i += 1;
      continue;
    }
    if (token === "--") {
      endOfOptions = true;
      i += 1;
      continue;
    }
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      let key: string;
      let value: string | undefined;
      if (eq >= 0) {
        key = token.slice(2, eq);
        value = token.slice(eq + 1);
      } else {
        key = token.slice(2);
      }
      if (!key) {
        throw new AinobiCliError("USAGE", `Invalid flag: ${token}`);
      }
      if (key.startsWith("no-") && value === undefined) {
        result.flags[key.slice(3)] = false;
        i += 1;
        continue;
      }
      const wantsValue = value !== undefined || isFlagWithValue(argv[i + 1]);
      if (wantsValue) {
        const v = value ?? argv[i + 1];
        if (FLAGS_THAT_REPEAT.has(key)) {
          (result.multi[key] ??= []).push(v);
        } else {
          result.flags[key] = v;
        }
        i += value !== undefined ? 1 : 2;
      } else {
        result.flags[key] = true;
        i += 1;
      }
      continue;
    }
    if (token.startsWith("-") && token.length > 1 && token !== "-") {
      const short = token.slice(1);
      if (short.length === 1 && isFlagWithValue(argv[i + 1])) {
        result.flags[short] = argv[i + 1];
        i += 2;
        continue;
      }
      result.flags[short] = true;
      i += 1;
      continue;
    }
    result.positionals.push(token);
    i += 1;
  }
  return result;
};

const isFlagWithValue = (next: string | undefined): boolean => {
  if (next === undefined) return false;
  if (next === "-") return true;
  if (next.startsWith("--") || (next.startsWith("-") && next.length > 1 && Number.isNaN(Number(next)))) {
    return false;
  }
  return true;
};

export const flagBool = (
  args: ParsedArgs,
  name: string,
  fallback = false,
): boolean => {
  const value = args.flags[name];
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (value === "" || value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  return Boolean(value);
};

export const flagString = (args: ParsedArgs, name: string): string | undefined => {
  const value = args.flags[name];
  if (typeof value === "string") return value;
  if (value === true) return "";
  return undefined;
};

export const flagNumber = (args: ParsedArgs, name: string): number | undefined => {
  const value = flagString(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new AinobiCliError("USAGE", `Flag --${name} expects a number, got "${value}".`);
  }
  return parsed;
};
