import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { uploadFirmware, uploadFilesystem } from '../src/tools/upload.js';
import * as spooler from '../src/utils/spooler.js';
import * as monitor from '../src/tools/monitor.js';
import * as devices from '../src/tools/devices.js';
import { portSemaphoreManager } from '../src/utils/semaphore.js';
import fs from 'node:fs';

const mockProjectDir = path.join(process.cwd(), 'test-project-upload');

describe('Upload Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Create dummy project dir so validateProjectPath doesn't throw
    if (!fs.existsSync(mockProjectDir)) {
      fs.mkdirSync(mockProjectDir, { recursive: true });
    }
    // Mock the platformio.ini file so validation passes
    fs.writeFileSync(path.join(mockProjectDir, 'platformio.ini'), '[env:default]\nboard = esp32dev');

    vi.spyOn(spooler, 'executeWithSpooling').mockResolvedValue({
      status: 'success',
      exitCode: 0,
      message: 'Mocked spooling success',
      logPath: 'mocked.log',
      finalOutput: 'Success'
    });
    vi.spyOn(monitor, 'stopMonitor').mockResolvedValue({ success: true, message: 'Stopped' });
    vi.spyOn(monitor, 'startMonitor').mockResolvedValue({ success: true, message: 'Started', port: 'COM1', pid: 1234 });
    vi.spyOn(portSemaphoreManager, 'claimPort').mockImplementation(() => {});
    vi.spyOn(portSemaphoreManager, 'releasePort').mockImplementation(() => {});
    vi.spyOn(devices, 'getFirstDevice').mockResolvedValue({ port: 'COM1', description: 'Mock Device', hwid: '123' });
    vi.spyOn(devices, 'findDeviceByPort').mockResolvedValue({ port: 'COM1', description: 'Mock Device', hwid: '123' });
    vi.spyOn(devices, 'waitForDeviceByHwid').mockResolvedValue('COM1');
  });

  afterEach(() => {
    if (fs.existsSync(mockProjectDir)) {
      fs.rmSync(mockProjectDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('should upload firmware without starting monitor if startMonitorAfter is false', async () => {
    const result = await uploadFirmware(mockProjectDir, 'COM1', 'default', false, false, false);
    
    expect(result.success).toBe(true);
    expect(monitor.stopMonitor).toHaveBeenCalledWith('COM1', mockProjectDir);
    expect(portSemaphoreManager.claimPort).toHaveBeenCalledWith('COM1', 'Firmware Upload');
    
    // Check that executeWithSpooling was called correctly
    expect(spooler.executeWithSpooling).toHaveBeenCalled();
    const spoolingOptions = vi.mocked(spooler.executeWithSpooling).mock.calls[0][2];
    expect(spoolingOptions.activePort).toBe('COM1');
    expect(spoolingOptions.onSuccess).toBeUndefined();
  });

  it('should upload firmware and start monitor when startMonitorAfter is true', async () => {
    vi.useFakeTimers();
    
    const result = await uploadFirmware(mockProjectDir, 'COM1', 'default', false, false, true);
    
    expect(result.success).toBe(true);
    expect(monitor.stopMonitor).toHaveBeenCalledWith('COM1', mockProjectDir);
    expect(portSemaphoreManager.claimPort).toHaveBeenCalledWith('COM1', 'Firmware Upload');
    
    // Check that executeWithSpooling got onSuccess callback
    const spoolingOptions = vi.mocked(spooler.executeWithSpooling).mock.calls[0][2];
    expect(spoolingOptions.onSuccess).toBeDefined();

    // Trigger the onSuccess callback
    const promise = spoolingOptions.onSuccess!();
    
    // Fast-forward 3 seconds
    await vi.runAllTimersAsync();
    await promise;

    expect(devices.waitForDeviceByHwid).toHaveBeenCalledWith('123', 10000, expect.any(Function));
    expect(monitor.startMonitor).toHaveBeenCalledWith('COM1', undefined, mockProjectDir, 'default');
    
    vi.useRealTimers();
  });

  it('should upload filesystem and start monitor when startMonitorAfter is true', async () => {
    vi.useFakeTimers();
    
    const result = await uploadFilesystem(mockProjectDir, 'COM1', 'default', false, false, true);
    
    expect(result.success).toBe(true);
    expect(monitor.stopMonitor).toHaveBeenCalledWith('COM1', mockProjectDir);
    expect(portSemaphoreManager.claimPort).toHaveBeenCalledWith('COM1', 'Filesystem Upload');
    
    const spoolingOptions = vi.mocked(spooler.executeWithSpooling).mock.calls[0][2];
    expect(spoolingOptions.onSuccess).toBeDefined();

    const promise = spoolingOptions.onSuccess!();
    await vi.runAllTimersAsync();
    await promise;

    expect(monitor.startMonitor).toHaveBeenCalledWith('COM1', undefined, mockProjectDir, 'default');
    
    vi.useRealTimers();
  });
});
