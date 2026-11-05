// SPDX-License-Identifier: AGPL-3.0-only
import { AinobiCliError } from "../errors.ts";
import { printSuccess, type OutputOptions } from "../output.ts";
import { isAgentCliRuntime } from "../runtime.ts";
import type { ParsedArgs } from "../args.ts";
import { flagBool } from "../args.ts";
import { cliEnv } from "../env.ts";

type HostRecallHttpResult = {
  ok: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
  error?: string;
};

const recallHostEndpoint = (): string => {
  const raw = cliEnv().AINOBI_TOOL_RESULT_RECALL_HOST_URL?.trim();
  if (!raw) {
    throw new AinobiCliError(
      "USAGE",
      "Agent recall requires `AINOBI_TOOL_RESULT_RECALL_HOST_URL` (set by the AINOBI host).",
      {
        hint: "Run `ainobi recall <id>` from the courseware agent chat environment.",
      },
    );
  }
  return raw.replace(/\/$/, "");
};

const uploadAuthHeaders = (): Record<string, string> => {
  const key = cliEnv().AINOBI_AGENT_API_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
};

/**
 * `ainobi recall <blob_id>` — fetch an archived tool result from the host.
 */
export async function handleRecall(args: ParsedArgs, output: OutputOptions): Promise<void> {
  if (!isAgentCliRuntime()) {
    throw new AinobiCliError(
      "USAGE",
      "`ainobi recall` is only available in agent runtime (`AINOBI_CLI_RUNTIME=agent`).",
    );
  }

  // Registry splices the matched path (`recall`) before dispatch — id is positionals[0].
  const id = args.positionals[0]?.trim();
  if (!id) {
    throw new AinobiCliError("USAGE", "Usage: ainobi recall <id>", {
      hint: "Pass the blob id from an archived tool_result stub (`recall: ainobi recall <id>`).",
    });
  }

  const endpoint = recallHostEndpoint();
  const body = {
    id,
    conversation_id: cliEnv().AINOBI_CONVERSATION_ID?.trim() || undefined,
    session_id: cliEnv().AINOBI_CLAUDE_SESSION_ID?.trim() || undefined,
    pretty: flagBool(args, "pretty", output.pretty),
  };

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...uploadAuthHeaders(),
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new AinobiCliError(
      "IO_ERROR",
      error instanceof Error ? error.message : "Tool-result recall host request failed.",
      { hint: `POST ${endpoint}` },
    );
  }

  const text = await response.text();
  let parsed: HostRecallHttpResult;
  try {
    parsed = JSON.parse(text) as HostRecallHttpResult;
  } catch {
    throw new AinobiCliError(
      "IO_ERROR",
      `Recall host returned non-JSON (HTTP ${response.status}).`,
      { hint: `POST ${endpoint}` },
    );
  }

  if (!response.ok || parsed.ok === false) {
    throw new AinobiCliError(
      "IO_ERROR",
      parsed.error || parsed.stderr?.trim() || `Recall host failed (HTTP ${response.status}).`,
      { hint: `POST ${endpoint}` },
    );
  }

  if (parsed.stdout?.trim()) {
    try {
      const inner = JSON.parse(parsed.stdout) as { ok?: boolean; data?: unknown };
      if (inner && typeof inner === "object" && inner.ok === true && "data" in inner) {
        printSuccess(inner.data, output);
        return;
      }
      printSuccess(inner, output);
      return;
    } catch {
      process.stdout.write(parsed.stdout);
      return;
    }
  }

  printSuccess({ id, recalled: true }, output);
}
