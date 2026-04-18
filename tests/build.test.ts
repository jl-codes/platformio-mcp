import { expect, test, vi, beforeEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { buildProject } from '../src/tools/build.js';

vi.mock('../src/platformio.js', () => {
  return {
    platformioExecutor: {
      spawn: vi.fn().mockImplementation((command, args, options) => {
        if (options.stdio && typeof options.stdio[1] === 'number') {
          fs.writeSync(
            options.stdio[1],
            'Compiling project...\nRAM: used 1234 bytes\nFlash: used 5678 bytes\nEnvironment: default\n[SUCCESS]\n'
          );
        }
        return {
          pid: 9999,
          on: vi.fn().mockImplementation((event, callback) => {
            if (event === 'close') {
              setTimeout(() => callback(0), 10);
            }
          }),
        };
      }),
      execute: vi.fn()
    }
  };
});

const mockProjectDir = path.join(__dirname, 'mock_project_spooler');

beforeEach(() => {
  const locksDir = path.join(mockProjectDir, '.pio-mcp-workspace', 'locks');
  if (fs.existsSync(locksDir)) {
    fs.rmSync(locksDir, { recursive: true, force: true });
  }
  const logsDir = path.join(mockProjectDir, '.pio-mcp-workspace', 'tasks', 'build_logs');
  if (fs.existsSync(logsDir)) {
    fs.rmSync(logsDir, { recursive: true, force: true });
  }
  if (!fs.existsSync(mockProjectDir)) {
    fs.mkdirSync(mockProjectDir, { recursive: true });
  }
});

test('buildProject correctly spins up spooler and generates log file', async () => {
  const result = await buildProject(mockProjectDir, 'default', false);
  
  expect(result.success).toBe(true);
  expect(result.ramUsageBytes).toBe(1234);
  expect(result.flashUsageBytes).toBe(5678);

  const logsDir = path.join(mockProjectDir, '.pio-mcp-workspace', 'tasks', 'build_logs');
  expect(fs.existsSync(logsDir)).toBe(true);
  
  const latestLog = path.join(logsDir, 'latest-build.log');
  expect(fs.existsSync(latestLog)).toBe(true);
  
  const content = fs.readFileSync(latestLog, 'utf8');
  expect(content).toContain('Compiling project...');
  expect(content).toContain('Flash: used 5678 bytes');
});
