/**
 * Firmware Upload Tools
 * Firmware upload operations and sequencing tools.
 *
 * Provides:
 * - uploadFirmware: Targets serial devices and drops compiled hex/bin.
 * - uploadAndMonitor: Drops firmware and attaches realtime observer.
 * - buildAndUpload: Compiles and dispatches binaries.
 */


import { executeWithSpooling } from "../utils/spooler.js";
import type { UploadResult } from "../types.js";
import {
  validateProjectPath,
  validateEnvironmentName,
  validateSerialPort,
} from "../utils/validation.js";

import { UploadError, PlatformIOError } from "../utils/errors.js";
import { parseStderrErrors } from "../utils/errors.js";

export async function uploadFilesystem(
  projectDir: string,
  port?: string,
  environment?: string,
  verbose?: boolean,
  background?: boolean,
): Promise<UploadResult> {
  const validatedPath = validateProjectPath(projectDir);

  if (environment && !validateEnvironmentName(environment)) {
    throw new UploadError(`Invalid environment name: ${environment}`, {
      environment,
    });
  }

  if (port && !validateSerialPort(port)) {
    throw new UploadError(`Invalid serial port: ${port}`, { port });
  }

  try {
    let activePort = port;
    if (!activePort) {
      const { getFirstDevice } = await import("./devices.js");
      const device = await getFirstDevice();
      if (!device)
        throw new PlatformIOError(
          "No serial devices detected for upload.",
          "PORT_NOT_FOUND",
        );
      activePort = device.port;
    }

    const uploadArgs: string[] = ["run", "--target", "uploadfs"];
    if (environment) uploadArgs.push("--environment", environment);

    const uploadResult = await executeWithSpooling(
      "run",
      uploadArgs.slice(1),
      {
        cwd: validatedPath,
        projectDir: validatedPath,
        timeout: 600000,
        background
      },
    );

    if (background) {
      return uploadResult as UploadResult;
    }

    const uploadSuccess = uploadResult.exitCode === 0;

    return {
      success: uploadSuccess,
      port: activePort,
      output: uploadSuccess && !verbose ? undefined : uploadResult.finalOutput,
      errors: uploadSuccess
        ? undefined
        : parseStderrErrors(uploadResult.finalOutput),
    };
  } catch (error) {
    if (error instanceof PlatformIOError) {
      throw new UploadError(`Filesystem upload failed: ${error.message}`, {
        projectDir,
        port,
        environment,
      });
    }
    throw new UploadError(`Failed to upload filesystem: ${error}`, {
      projectDir,
      port,
      environment,
    });
  }
}

export async function uploadFirmware(
  projectDir: string,
  port?: string,
  environment?: string,
  verbose?: boolean,
  background?: boolean,
): Promise<UploadResult> {
  const validatedPath = validateProjectPath(projectDir);

  if (environment && !validateEnvironmentName(environment)) {
    throw new UploadError(`Invalid environment name: ${environment}`, {
      environment,
    });
  }

  if (port && !validateSerialPort(port)) {
    throw new UploadError(`Invalid serial port: ${port}`, { port });
  }

  try {
    let activePort = port;
    if (!activePort) {
      const { getFirstDevice } = await import("./devices.js");
      const device = await getFirstDevice();
      if (!device)
        throw new PlatformIOError(
          "No serial devices detected for upload.",
          "PORT_NOT_FOUND",
        );
      activePort = device.port;
    }

    const uploadArgs: string[] = ["run", "--target", "upload"];
    if (environment) uploadArgs.push("--environment", environment);

    const uploadResult = await executeWithSpooling(
      "run",
      uploadArgs.slice(1),
      {
        cwd: validatedPath,
        projectDir: validatedPath,
        timeout: 600000,
        background
      },
    );

    if (background) {
      return uploadResult as UploadResult;
    }

    const uploadSuccess = uploadResult.exitCode === 0;

    return {
      success: uploadSuccess,
      port: activePort,
      output: uploadSuccess && !verbose ? undefined : uploadResult.finalOutput,
      errors: uploadSuccess
        ? undefined
        : parseStderrErrors(uploadResult.finalOutput),
    };
  } catch (error) {
    if (error instanceof PlatformIOError) {
      throw new UploadError(`Upload failed: ${error.message}`, {
        projectDir,
        port,
        environment,
      });
    }
    throw new UploadError(`Failed to upload firmware: ${error}`, {
      projectDir,
      port,
      environment,
    });
  }
}

export async function uploadAndMonitor(
  projectDir: string,
  port?: string,
  environment?: string,
  verbose?: boolean,
  background?: boolean,
): Promise<UploadResult> {
  return uploadFirmware(projectDir, port, environment, verbose, background);
}

export async function buildAndUpload(
  projectDir: string,
  port?: string,
  environment?: string,
  verbose?: boolean,
  background?: boolean,
): Promise<UploadResult> {
  return uploadFirmware(projectDir, port, environment, verbose, background);
}
