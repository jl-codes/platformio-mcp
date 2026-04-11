/**
 * Project build and compilation tools
 */

import { platformioExecutor } from '../platformio.js';
import type { BuildResult, CleanResult } from '../types.js';
import { validateProjectPath, validateEnvironmentName } from '../utils/validation.js';
import { BuildError, PlatformIOError } from '../utils/errors.js';
import { parseStderrErrors } from '../utils/errors.js';

/**
 * Builds a PlatformIO project
 */
export async function buildProject(
  projectDir: string,
  environment?: string
): Promise<BuildResult> {
  const validatedPath = validateProjectPath(projectDir);

  if (environment && !validateEnvironmentName(environment)) {
    throw new BuildError(`Invalid environment name: ${environment}`, { environment });
  }

  try {
    const args: string[] = [];

    // Add environment if specified
    if (environment) {
      args.push('--environment', environment);
    }

    // Build can take a while, especially first time
    const result = await platformioExecutor.execute('run', args, {
      cwd: validatedPath,
      timeout: 600000, // 10 minutes
    });

    const success = result.exitCode === 0;
    const errors = success ? undefined : parseStderrErrors(result.stderr);

    return {
      success,
      environment: environment || 'default',
      output: result.stdout,
      errors,
    };
  } catch (error) {
    if (error instanceof PlatformIOError) {
      throw new BuildError(
        `Build failed: ${error.message}`,
        { projectDir, environment }
      );
    }
    throw new BuildError(
      `Failed to build project: ${error}`,
      { projectDir, environment }
    );
  }
}

/**
 * Cleans build artifacts from a project
 */
export async function cleanProject(projectDir: string): Promise<CleanResult> {
  const validatedPath = validateProjectPath(projectDir);

  try {
    const result = await platformioExecutor.execute('run', ['--target', 'clean'], {
      cwd: validatedPath,
      timeout: 60000,
    });

    const success = result.exitCode === 0;

    if (!success) {
      throw new BuildError(
        `Clean failed: ${result.stderr}`,
        { projectDir, stderr: result.stderr }
      );
    }

    return {
      success: true,
      message: 'Successfully cleaned build artifacts',
    };
  } catch (error) {
    if (error instanceof BuildError) {
      throw error;
    }
    throw new BuildError(
      `Failed to clean project: ${error}`,
      { projectDir }
    );
  }
}

/**
 * Builds project for a specific target (e.g., 'upload', 'monitor', 'test')
 */
export async function buildTarget(
  projectDir: string,
  target: string,
  environment?: string
): Promise<BuildResult> {
  const validatedPath = validateProjectPath(projectDir);

  if (environment && !validateEnvironmentName(environment)) {
    throw new BuildError(`Invalid environment name: ${environment}`, { environment });
  }

  try {
    const args: string[] = ['--target', target];

    if (environment) {
      args.push('--environment', environment);
    }

    const result = await platformioExecutor.execute('run', args, {
      cwd: validatedPath,
      timeout: 600000,
    });

    const success = result.exitCode === 0;
    const errors = success ? undefined : parseStderrErrors(result.stderr);

    return {
      success,
      environment: environment || 'default',
      output: result.stdout,
      errors,
    };
  } catch (error) {
    if (error instanceof PlatformIOError) {
      throw new BuildError(
        `Target '${target}' failed: ${error.message}`,
        { projectDir, target, environment }
      );
    }
    throw new BuildError(
      `Failed to build target '${target}': ${error}`,
      { projectDir, target, environment }
    );
  }
}

/**
 * Gets list of available build targets for a project
 */
export async function listTargets(projectDir: string, environment?: string): Promise<string[]> {
  const validatedPath = validateProjectPath(projectDir);

  try {
    const args: string[] = ['--list-targets'];

    if (environment) {
      args.push('--environment', environment);
    }

    const result = await platformioExecutor.execute('run', args, {
      cwd: validatedPath,
      timeout: 30000,
    });

    if (result.exitCode !== 0) {
      throw new BuildError('Failed to list targets', { projectDir, stderr: result.stderr });
    }

    // Parse target list from output
    const targets: string[] = [];
    const lines = result.stdout.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // Targets are typically listed one per line
      if (trimmed && !trimmed.startsWith('Environment') && !trimmed.includes(':')) {
        targets.push(trimmed);
      }
    }

    return targets;
  } catch (error) {
    if (error instanceof BuildError) {
      throw error;
    }
    throw new BuildError(
      `Failed to list build targets: ${error}`,
      { projectDir }
    );
  }
}
