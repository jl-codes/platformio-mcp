import { describe, it, expect, vi, beforeEach } from 'vitest';
import { platformioExecutor } from '../src/platformio.js';
import { buildProject } from '../src/tools/build.js';

// Regression test for: buildProject invoking `pio run run ...` (duplicate
// positional 'run' argument) which PlatformIO's CLI rejects with
// "Error: Got unexpected extra argument (run)". Root cause: buildProject put
// 'run' in its own args array on top of PlatformIOExecutor.execute() already
// prepending the command name.

describe('buildProject', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not duplicate the command name in the args passed to pio', async () => {
    const executeSpy = vi
      .spyOn(platformioExecutor, 'execute')
      .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    await buildProject(process.cwd(), 'someenv');

    expect(executeSpy).toHaveBeenCalledTimes(1);
    const [command, args] = executeSpy.mock.calls[0];
    expect(command).toBe('run');
    expect(args).not.toContain('run');
    expect(args).toEqual(['--environment', 'someenv']);
  });
});
