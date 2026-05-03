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
import { startMonitor } from "./monitor.js";
import {
  validateProjectPath,
  validateEnvironmentName,
  validateSerialPort,
} from "../utils/validation.js";

import { UploadError, PlatformIOError } from "../utils/errors.js";
import { parseStderrErrors } from "../utils/errors.js";
import { stopMonitor } from "./monitor.js";
import { portSemaphoreManager } from "../utils/semaphore.js";

/**
 * Uploads a SPIFFS/LittleFS filesystem image to a target device.
 *
 * @param projectDir - Validated project directory root.
 * @param port - Target COM port or undefined to autodetect.
 * @param environment - Optional specific environment target.
 * @param verbose - If true, captures complete output without truncation.
 * @param background - Executes asynchronously in the background.
 * @returns The structured UploadResult containing success flag, port, and standard output/errors.
 */
export async function uploadFilesystem(
  projectDir: string,
  port?: string,
  environment?: string,
  verbose?: boolean,
  background?: boolean,
  startMonitorAfter?: boolean,
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
    let hwid: string | undefined;
    const { getFirstDevice, findDeviceByPort, waitForDeviceByHwid } = await import("./devices.js");

    if (!activePort) {
      const device = await getFirstDevice();
      if (!device)
        throw new PlatformIOError(
          "No serial devices detected for upload.",
          "PORT_NOT_FOUND",
        );
      activePort = device.port;
      hwid = device.hwid;
    } else {
      const device = await findDeviceByPort(activePort);
      hwid = device?.hwid;
    }

    const uploadArgs: string[] = ["run", "--target", "uploadfs"];
    if (environment) uploadArgs.push("--environment", environment);

    await stopMonitor(activePort, projectDir);
    portSemaphoreManager.claimPort(activePort, "Filesystem Upload");

    const rootCommandId = crypto.randomUUID();

    const uploadResult = await executeWithSpooling(
      "run",
      uploadArgs.slice(1),
      {
        cwd: validatedPath,
        projectDir: validatedPath,
        timeout: 600000,
        background,
        activePort,
        rootCommandId,
        artifactType: "upload",
        onSuccess: startMonitorAfter ? async () => {
          if (hwid) {
            const newPort = await waitForDeviceByHwid(hwid, 10000, (msg) => console.error(msg.trim()));
            if (newPort) {
              await startMonitor(newPort, undefined, validatedPath, environment, rootCommandId);
              return;
            }
          }
          
          let device = null;
          for (let i = 0; i < 20; i++) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            device = await getFirstDevice();
            if (device) break;
          }
          if (device) {
            await startMonitor(device.port, undefined, validatedPath, environment, rootCommandId);
          } else {
            console.error(`[Spooler Diagnostic] Auto-monitor failed: Device did not re-enumerate within 10 seconds.`);
          }
        } : undefined
      },
    );

    if ('status' in uploadResult) {
      return uploadResult as unknown as UploadResult;
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

/**
 * Uploads a compiled firmware binary to a target device.
 *
 * @param projectDir - Validated project directory root.
 * @param port - Target COM port or undefined to autodetect.
 * @param environment - Optional specific environment target.
 * @param verbose - If true, captures complete output without truncation.
 * @param background - Executes asynchronously in the background.
 * @returns The structured UploadResult containing success flag, port, and standard output/errors.
 */
export async function uploadFirmware(
  projectDir: string,
  port?: string,
  environment?: string,
  verbose?: boolean,
  background?: boolean,
  startMonitorAfter?: boolean,
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
    let hwid: string | undefined;
    const { getFirstDevice, findDeviceByPort, waitForDeviceByHwid } = await import("./devices.js");

    if (!activePort) {
      const device = await getFirstDevice();
      if (!device)
        throw new PlatformIOError(
          "No serial devices detected for upload.",
          "PORT_NOT_FOUND",
        );
      activePort = device.port;
      hwid = device.hwid;
    } else {
      const device = await findDeviceByPort(activePort);
      hwid = device?.hwid;
    }

    const uploadArgs: string[] = ["run", "--target", "upload"];
    if (environment) uploadArgs.push("--environment", environment);

    await stopMonitor(activePort, projectDir);
    portSemaphoreManager.claimPort(activePort, "Firmware Upload");

    const rootCommandId = crypto.randomUUID();

    const uploadResult = await executeWithSpooling(
      "run",
      uploadArgs.slice(1),
      {
        cwd: validatedPath,
        projectDir: validatedPath,
        timeout: 600000,
        background,
        activePort,
        rootCommandId,
        artifactType: "upload",
        onSuccess: startMonitorAfter ? async () => {
          if (hwid) {
            const newPort = await waitForDeviceByHwid(hwid, 10000, (msg) => console.error(msg.trim()));
            if (newPort) {
              await startMonitor(newPort, undefined, validatedPath, environment, rootCommandId);
              return;
            }
          }

          let device = null;
          for (let i = 0; i < 20; i++) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            device = await getFirstDevice();
            if (device) break;
          }
          if (device) {
            await startMonitor(device.port, undefined, validatedPath, environment, rootCommandId);
          } else {
            console.error(`[Spooler Diagnostic] Auto-monitor failed: Device did not re-enumerate within 10 seconds.`);
          }
        } : undefined
      },
    );

    if ('status' in uploadResult) {
      return uploadResult as unknown as UploadResult;
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

/**
 * Uploads firmware and sequentially initiates a monitor trace.
 *
 * @param projectDir - Validated project directory root.
 * @param port - Target COM port or undefined to autodetect.
 * @param environment - Optional specific environment target.
 * @param verbose - If true, captures complete output without truncation.
 * @param background - Executes asynchronously in the background.
 * @returns The structured UploadResult containing success flag, port, and standard output/errors.
 */
export async function uploadAndMonitor(
  projectDir: string,
  port?: string,
  environment?: string,
  verbose?: boolean,
  background?: boolean,
  startMonitorAfter?: boolean,
): Promise<UploadResult> {
  return uploadFirmware(projectDir, port, environment, verbose, background, startMonitorAfter);
}

/**
 * Automates a complete compilation phase followed by a firmware upload.
 *
 * @param projectDir - Validated project directory root.
 * @param port - Target COM port or undefined to autodetect.
 * @param environment - Optional specific environment target.
 * @param verbose - If true, captures complete output without truncation.
 * @param background - Executes asynchronously in the background.
 * @returns The structured UploadResult containing success flag, port, and standard output/errors.
 */
export async function buildAndUpload(
  projectDir: string,
  port?: string,
  environment?: string,
  verbose?: boolean,
  background?: boolean,
  startMonitorAfter?: boolean,
): Promise<UploadResult> {
  return uploadFirmware(projectDir, port, environment, verbose, background, startMonitorAfter);
}
