/**
 * Firmware upload tools
 */

import { platformioExecutor } from '../platformio.js';
import type { UploadResult } from '../types.js';
import { validateProjectPath, validateEnvironmentName, validateSerialPort } from '../utils/validation.js';
import { UploadError, PlatformIOError } from '../utils/errors.js';
import { parseStderrErrors } from '../utils/errors.js';

/**
 * Uploads firmware to a connected device
 */
export async function uploadFirmware(
  projectDir: string,
  port?: string,
  environment?: string
): Promise<UploadResult> {
  const validatedPath = validateProjectPath(projectDir);

  if (environment && !validateEnvironmentName(environment)) {
    throw new UploadError(`Invalid environment name: ${environment}`, { environment });
  }

  if (port && !validateSerialPort(port)) {
    throw new UploadError(`Invalid serial port: ${port}`, { port });
  }

  try {
    const args: string[] = ['run', '--target', 'upload'];

    // Add environment if specified
    if (environment) {
      args.push('--environment', environment);
    }

    // Add upload port if specified
    if (port) {
      args.push('--upload-port', port);
    }

    const result = await platformioExecutor.execute('run', args.slice(1), {
      cwd: validatedPath,
      timeout: 300000, // 5 minutes
    });

    const success = result.exitCode === 0;
    const errors = success ? undefined : parseStderrErrors(result.stderr);

    return {
      success,
      port,
      output: result.stdout,
      errors,
    };
  } catch (error) {
    if (error instanceof PlatformIOError) {
      throw new UploadError(
        `Upload failed: ${error.message}`,
        { projectDir, port, environment }
      );
    }
    throw new UploadError(
      `Failed to upload firmware: ${error}`,
      { projectDir, port, environment }
    );
  }
}

/**
 * Uploads firmware and starts serial monitor (upload + monitor)
 */
export async function uploadAndMonitor(
  projectDir: string,
  port?: string,
  environment?: string
): Promise<UploadResult> {
  const validatedPath = validateProjectPath(projectDir);

  if (environment && !validateEnvironmentName(environment)) {
    throw new UploadError(`Invalid environment name: ${environment}`, { environment });
  }

  if (port && !validateSerialPort(port)) {
    throw new UploadError(`Invalid serial port: ${port}`, { port });
  }

  try {
    const args: string[] = ['run', '--target', 'upload', '--target', 'monitor'];

    if (environment) {
      args.push('--environment', environment);
    }

    if (port) {
      args.push('--upload-port', port);
      args.push('--monitor-port', port);
    }

    const result = await platformioExecutor.execute('run', args.slice(1), {
      cwd: validatedPath,
      timeout: 300000,
    });

    const success = result.exitCode === 0;
    const errors = success ? undefined : parseStderrErrors(result.stderr);

    return {
      success,
      port,
      output: result.stdout,
      errors,
    };
  } catch (error) {
    if (error instanceof PlatformIOError) {
      throw new UploadError(
        `Upload and monitor failed: ${error.message}`,
        { projectDir, port, environment }
      );
    }
    throw new UploadError(
      `Failed to upload and monitor: ${error}`,
      { projectDir, port, environment }
    );
  }
}

/**
 * Builds and uploads firmware in one step
 */
export async function buildAndUpload(
  projectDir: string,
  port?: string,
  environment?: string
): Promise<UploadResult> {
  // Upload target automatically builds first if needed
  return uploadFirmware(projectDir, port, environment);
}

/**
 * Uploads filesystem (SPIFFS/LittleFS) to a connected device
 */
export async function uploadFilesystem(
  projectDir: string,
  port?: string,
  environment?: string
): Promise<UploadResult> {
  const validatedPath = validateProjectPath(projectDir);

  if (environment && !validateEnvironmentName(environment)) {
    throw new UploadError(`Invalid environment name: ${environment}`, { environment });
  }

  if (port && !validateSerialPort(port)) {
    throw new UploadError(`Invalid serial port: ${port}`, { port });
  }

  try {
    const args: string[] = ['run', '--target', 'uploadfs'];

    // Add environment if specified
    if (environment) {
      args.push('--environment', environment);
    }

    // Add upload port if specified
    if (port) {
      args.push('--upload-port', port);
    }

    const result = await platformioExecutor.execute('run', args.slice(1), {
      cwd: validatedPath,
      timeout: 300000, // 5 minutes
    });

    const success = result.exitCode === 0;
    const errors = success ? undefined : parseStderrErrors(result.stderr);

    return {
      success,
      port,
      output: result.stdout,
      errors,
    };
  } catch (error) {
    if (error instanceof PlatformIOError) {
      throw new UploadError(
        `Filesystem upload failed: ${error.message}`,
        { projectDir, port, environment }
      );
    }
    throw new UploadError(
      `Failed to upload filesystem: ${error}`,
      { projectDir, port, environment }
    );
  }
}
