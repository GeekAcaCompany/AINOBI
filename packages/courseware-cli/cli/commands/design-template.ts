// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from "node:fs/promises";

import { flagString, type ParsedArgs } from "../args.ts";
import { AinobiCliError } from "../errors.ts";
import {
  deleteDesignTemplateViaHost,
  extractDesignTemplateViaHost,
  getDesignTemplateViaHost,
  listDesignTemplatesViaHost,
  saveDesignTemplateViaHost,
} from "../design-template-host-job.ts";
import { printSuccess, type OutputOptions } from "../output.ts";
import { isDesignTemplateHostFlush } from "../runtime.ts";

async function readContentArg(args: ParsedArgs): Promise<string> {
  const inline = flagString(args, "content");
  if (inline?.trim()) return inline.trim();
  const filePath = flagString(args, "content-file");
  if (filePath?.trim()) {
    return (await readFile(filePath.trim(), "utf8")).trim();
  }
  throw new AinobiCliError("USAGE", "Provide --content or --content-file for save.");
}

export const handleDesignTemplateList = async (
  args: ParsedArgs,
  output: OutputOptions,
): Promise<void> => {
  if (!isDesignTemplateHostFlush()) {
    throw new AinobiCliError(
      "USAGE",
      "`ainobi design-template list` requires the AINOBI agent host environment.",
    );
  }
  const data = await listDesignTemplatesViaHost({
    orgId: flagString(args, "org-id"),
    q: flagString(args, "q"),
  });
  printSuccess(data, output);
};

export const handleDesignTemplateGet = async (
  args: ParsedArgs,
  output: OutputOptions,
): Promise<void> => {
  if (!isDesignTemplateHostFlush()) {
    throw new AinobiCliError(
      "USAGE",
      "`ainobi design-template get` requires the AINOBI agent host environment.",
    );
  }
  const id = args.positionals[1]?.trim();
  if (!id) {
    throw new AinobiCliError("USAGE", "Missing template id.", {
      hint: "ainobi design-template get <id> [--org-id <uuid>]",
    });
  }
  const data = await getDesignTemplateViaHost({ id, orgId: flagString(args, "org-id") });
  printSuccess(data, output);
};

export const handleDesignTemplateSave = async (
  args: ParsedArgs,
  output: OutputOptions,
): Promise<void> => {
  if (!isDesignTemplateHostFlush()) {
    throw new AinobiCliError(
      "USAGE",
      "`ainobi design-template save` requires the AINOBI agent host environment.",
    );
  }
  const name = flagString(args, "name");
  if (!name?.trim()) {
    throw new AinobiCliError("USAGE", "Missing --name.", {
      hint: "ainobi design-template save --name <title> --content-file ./template.md",
    });
  }
  const content = await readContentArg(args);
  const data = await saveDesignTemplateViaHost({
    orgId: flagString(args, "org-id"),
    name,
    content,
    description: flagString(args, "description"),
    sourceType: flagString(args, "source-type") ?? "manual",
  });
  printSuccess(data, output);
};

export const handleDesignTemplateExtract = async (
  args: ParsedArgs,
  output: OutputOptions,
): Promise<void> => {
  if (!isDesignTemplateHostFlush()) {
    throw new AinobiCliError(
      "USAGE",
      "`ainobi design-template extract` requires the AINOBI agent host environment.",
    );
  }
  const name = flagString(args, "name");
  const from = flagString(args, "from");
  if (!name?.trim()) {
    throw new AinobiCliError("USAGE", "Missing --name.");
  }
  if (from !== "courseware" && from !== "asset") {
    throw new AinobiCliError("USAGE", 'Missing or invalid --from (use "courseware" or "asset").', {
      hint: "ainobi design-template extract --name <title> --from courseware --courseware-id <uuid>",
    });
  }
  const coursewareId = flagString(args, "courseware-id");
  const assetId = flagString(args, "asset-id");
  if (from === "courseware" && !coursewareId?.trim()) {
    throw new AinobiCliError("USAGE", "--courseware-id is required when --from courseware.");
  }
  if (from === "asset" && !assetId?.trim()) {
    throw new AinobiCliError("USAGE", "--asset-id is required when --from asset.");
  }
  const data = await extractDesignTemplateViaHost({
    orgId: flagString(args, "org-id"),
    name,
    sourceType: from,
    coursewareId: coursewareId ?? undefined,
    assetId: assetId ?? undefined,
    description: flagString(args, "description"),
    language: flagString(args, "language") ?? "auto",
  });
  printSuccess(data, output);
};

export const handleDesignTemplateDelete = async (
  args: ParsedArgs,
  output: OutputOptions,
): Promise<void> => {
  if (!isDesignTemplateHostFlush()) {
    throw new AinobiCliError(
      "USAGE",
      "`ainobi design-template delete` requires the AINOBI agent host environment.",
    );
  }
  const id = args.positionals[1]?.trim();
  if (!id) {
    throw new AinobiCliError("USAGE", "Missing template id.", {
      hint: "ainobi design-template delete <id> [--org-id <uuid>]",
    });
  }
  const data = await deleteDesignTemplateViaHost({ id, orgId: flagString(args, "org-id") });
  printSuccess(data, output);
};
