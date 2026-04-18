import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rotateLogs } from '../src/utils/spooler.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Spooler Log Rotation', () => {
  const testLogDir = path.join(process.cwd(), 'test-spooler-logs');

  beforeEach(() => {
    if (!fs.existsSync(testLogDir)) {
      fs.mkdirSync(testLogDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testLogDir)) {
      fs.rmSync(testLogDir, { recursive: true, force: true });
    }
  });

  it('should trim logs when exceeding maxHistory limit', async () => {
    // Generate 35 logs
    for (let i = 0; i < 35; i++) {
        const logPath = path.join(testLogDir, `build-${i}.log`);
        fs.writeFileSync(logPath, "data");
    }

    rotateLogs(testLogDir, 'build-', 30);

    const remaining = fs.readdirSync(testLogDir).filter(f => f.startsWith('build-') && f.endsWith('.log'));
    expect(remaining.length).toBe(30);
  });
});
