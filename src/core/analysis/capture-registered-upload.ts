/** Resolve and retain upload inputs from the actual stopped target and the host's installed packages. */
import fs from "node:fs/promises";
import { PlatformIOError } from "../../utils/errors.js";
import {
  withTargetUploadCapture,
  type TargetUploadCaptureRequest,
} from "./capture-target-upload.js";
import {
  readUploadCaptureRecord,
  retainUploadCapture,
} from "./upload-capture-record.js";
import { discoverUploadInstallation } from "./upload-installation.js";

/**
 * Caller supplies authorized host system-info output and upload custody. The chip value is selected
 * command data, not board authentication; the exact command is later bound into upload approval.
 * Resolve the compiler after the real capture, avoiding a second build that could change the artifacts.
 */
export async function captureRegisteredUpload(
  input: TargetUploadCaptureRequest,
  systemInfo: unknown,
  archiveRoot?: string,
) {
  const selected = { ...input, execution: { ...input.execution } };
  const projectDir = await fs.realpath(selected.projectDir);
  return withTargetUploadCapture(
    { ...selected, projectDir },
    async (recordPath, captureDirectory) => {
      const record = await readUploadCaptureRecord(
        recordPath,
        captureDirectory,
      );
      if (
        (await fs.realpath(record.projectDir)) !== projectDir ||
        record.environment !== selected.environment
      )
        throw new PlatformIOError(
          "Capture differs from the selected project or environment.",
          "UPLOAD_CAPTURE_CONTEXT_CHANGED",
        );
      const installation = await discoverUploadInstallation(
        systemInfo,
        projectDir,
        record.compiler,
      );
      const commandIndex = record.argv.findIndex(
        (arg) => arg === "write_flash" || arg === "write-flash",
      );
      const chips: string[] = [];
      for (let index = 2; index < commandIndex; index++) {
        const arg = record.argv[index];
        if (arg === "--chip" || arg === "-c")
          chips.push(record.argv[index + 1] ?? "");
        else if (arg.startsWith("--chip=") || arg.startsWith("-c="))
          chips.push(arg.slice(arg.indexOf("=") + 1));
      }
      if (chips.length !== 1 || !/^[a-zA-Z0-9_-]{1,32}$/.test(chips[0]))
        throw new PlatformIOError(
          "Capture has no unambiguous selected chip.",
          "UPLOAD_COMMAND_UNSUPPORTED",
        );
      const uploader = {
        pythonPath: installation.pythonPath,
        esptoolPath: installation.esptoolPath,
        chip: chips[0],
        port: selected.execution.uploadPort!,
      };
      const retained = await retainUploadCapture(
        recordPath,
        {
          captureDirectory,
          projectDir,
          environment: selected.environment,
          compiler: installation.compilerPath,
          toolchain: installation.toolchain,
          uploader,
          trustedImageRoots: installation.trustedImageRoots,
        },
        archiveRoot,
      );
      return { retained, uploader };
    },
  );
}
