#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, flagBool, flagString, type ParsedArgs } from "./args.ts";
import { AinobiCliError } from "./errors.ts";
import { printError, type OutputOptions } from "./output.ts";
import { dispatchCommand, type CommandHandler } from "./registry.ts";
import { cliEnv } from "./env.ts";
import { isAgentCliRuntime } from "./runtime.ts";

const VERSION = "0.1.0";
const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const unquoteEnvValue = (value: string): string => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const inner = trimmed.slice(1, -1);
    return trimmed.startsWith('"')
      ? inner.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t")
      : inner;
  }
  return trimmed.replace(/\s+#.*$/, "");
};

const loadDotenvFile = (dotenvPath: string): void => {
  if (!existsSync(dotenvPath)) return;

  let text: string;
  try {
    text = readFileSync(dotenvPath, "utf-8");
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = normalized.indexOf("=");
    if (eq <= 0) continue;

    const key = normalized.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || cliEnv()[key] !== undefined) continue;
    cliEnv()[key] = unquoteEnvValue(normalized.slice(eq + 1));
  }
};

const loadDotenv = (): void => {
  const loaded = new Set<string>();
  for (const dotenvPath of [resolve(CLI_ROOT, ".env"), resolve(process.cwd(), ".env")]) {
    if (loaded.has(dotenvPath)) continue;
    loaded.add(dotenvPath);
    loadDotenvFile(dotenvPath);
  }
};

process.on("unhandledRejection", (reason) => {
  const fallbackOutput: OutputOptions = {
    pretty: isAgentCliRuntime() ? false : !!process.stdout.isTTY,
    quiet: isAgentCliRuntime(),
  };
  printError(
    reason instanceof Error ? reason : new AinobiCliError("INTERNAL", String(reason)),
    fallbackOutput,
  );
  process.exit(1);
});

const main = async (): Promise<void> => {
  loadDotenv();

  const argv = process.argv.slice(2);
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    const fallbackOutput: OutputOptions = {
      pretty: isAgentCliRuntime() ? false : !!process.stdout.isTTY,
      quiet: isAgentCliRuntime(),
    };
    printError(error, fallbackOutput);
    process.exit(2);
    return;
  }

  if (args.flags.version === true || args.flags.v === true) {
    process.stdout.write(JSON.stringify({ ok: true, data: { version: VERSION } }) + "\n");
    return;
  }

  // Agent sandbox is non-TTY; force compact JSON unless the model explicitly asks for --pretty.
  // Quiet mutation payloads (ids/warnings only) default on in agent runtime; --no-quiet for full data.
  const defaultPretty = isAgentCliRuntime() ? false : !!process.stdout.isTTY;
  const defaultQuiet = isAgentCliRuntime();
  const output: OutputOptions = {
    pretty: flagBool(args, "pretty", defaultPretty),
    quiet: flagBool(args, "quiet", defaultQuiet),
    select: flagString(args, "select"),
  };

  if (args.positionals.length === 0) {
    args.positionals.push("help");
  }

  let handler: CommandHandler | null;
  try {
    handler = dispatchCommand(args);
  } catch (error) {
    printError(error, output);
    process.exit(2);
    return;
  }

  if (!handler) {
    printError(
      new AinobiCliError("USAGE", "No command specified.", {
        hint: "Run `ainobi help` to see available commands.",
      }),
      output,
    );
    process.exit(2);
    return;
  }

  try {
    await handler(args, output);
  } catch (error) {
    printError(error, output);
    if (error instanceof AinobiCliError) {
      const code = error.code;
      const exitMap: Record<string, number> = {
        USAGE: 2,
        NOT_LOADED: 3,
        NOT_FOUND: 4,
        VALIDATION_ERROR: 5,
        INVALID_INPUT: 6,
        IO_ERROR: 7,
        UNSUPPORTED: 8,
        ALREADY_LOADED: 9,
        INTERNAL: 1,
      };
      process.exit(exitMap[code] ?? 1);
    }
    process.exit(1);
  }
};

const mainExitCode = (): number => {
  if (typeof process.exitCode === "number" && process.exitCode !== 0) {
    return process.exitCode;
  }
  return 0;
};

try {
  await main();
  process.exit(mainExitCode());
} catch (error) {
  const fallbackOutput: OutputOptions = { pretty: !!process.stdout.isTTY };
  printError(error, fallbackOutput);
  process.exit(1);
}
