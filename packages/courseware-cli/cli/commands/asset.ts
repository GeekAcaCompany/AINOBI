// SPDX-License-Identifier: AGPL-3.0-only
import { flagBool, type ParsedArgs } from "../args.ts";
import { AinobiCliError } from "../errors.ts";
import { convertDocumentAsset, getFileAsset, uploadFileAsset } from "../assets.ts";
import { printSuccess, type OutputOptions } from "../output.ts";

export const handleAssetGet = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  const fileId = args.positionals[0];
  if (!fileId?.trim()) {
    throw new AinobiCliError("USAGE", "Missing file_id.", {
      hint: "ainobi asset get <file_id>",
    });
  }

  const asset = await getFileAsset(fileId.trim());
  printSuccess(asset, output);
};

export const handleAssetUpload = async (args: ParsedArgs, output: OutputOptions): Promise<void> => {
  const filePath = args.positionals[0];
  if (!filePath) {
    throw new AinobiCliError("USAGE", "Missing asset file path.");
  }

  const convert = flagBool(args, "convert", false);
  const asset = convert ? await convertDocumentAsset(filePath) : await uploadFileAsset(filePath);
  printSuccess(asset, output);
};
