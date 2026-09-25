/** Captured upload commands cannot select another interpreter, script, operation or device. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  validateEspUploadCommand,
  type EspUploadCommandContext,
} from "../src/core/analysis/esptool-upload-command.js";
let root: string, context: EspUploadCommandContext, argv: string[];
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "pio-upload-command-"));
  context = {
    pythonPath: process.execPath,
    esptoolPath: path.join(root, "esptool.py"),
    chip: "esp32",
    port: "COM7",
  };
  await fs.writeFile(context.esptoolPath, "# not executed");
  argv = [
    context.pythonPath,
    context.esptoolPath,
    "--chip",
    "esp32",
    "--port",
    "COM7",
    "--baud",
    "460800",
    "--before",
    "default_reset",
    "--after",
    "hard_reset",
    "write_flash",
    "-z",
    "0x10000",
    path.join(root, "app.bin"),
  ];
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it("accepts the selected tool and device with native esptool reset options", async () => {
  await expect(
    validateEspUploadCommand(argv, context),
  ).resolves.toBeUndefined();
});
it.each([
  ["device", 5, "COM8"],
  ["chip", 3, "esp32c3"],
  ["operation", 12, "erase_flash"],
  ["Python injection", 1, "-c"],
  ["reset option", 9, "unsupported"],
  ["baud", 7, "NaN"],
])("rejects changed %s", async (_name, index, value) => {
  argv[index as number] = value as string;
  await expect(validateEspUploadCommand(argv, context)).rejects.toMatchObject({
    code: "UPLOAD_COMMAND_UNSUPPORTED",
  });
});
it("rejects another existing Python script", async () => {
  argv[1] = path.join(root, "other.py");
  await fs.writeFile(argv[1], "# wrong script");
  await expect(validateEspUploadCommand(argv, context)).rejects.toMatchObject({
    code: "UPLOAD_COMMAND_UNSUPPORTED",
  });
});
it("rejects duplicate and unrecognized global options", async () => {
  for (const extra of [
    ["--port", "COM8"],
    ["--override-vddsdio", "3.3"],
    ["--no-stub=true"],
  ]) {
    const changed = [...argv.slice(0, 12), ...extra, ...argv.slice(12)];
    await expect(
      validateEspUploadCommand(changed, context),
    ).rejects.toMatchObject({ code: "UPLOAD_COMMAND_UNSUPPORTED" });
  }
});
