import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { addWorkspace } from '../src/utils/workspace-registry.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('Workspace Registry Validation', () => {
  let tempEmptyDir: string;
  let tempValidDir: string;

  beforeAll(async () => {
    tempEmptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pio-mcp-empty-'));
    tempValidDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pio-mcp-valid-'));
    await fs.writeFile(path.join(tempValidDir, 'platformio.ini'), '[env:uno]\nboard=uno');
  });

  afterAll(async () => {
    await fs.rm(tempEmptyDir, { recursive: true, force: true });
    await fs.rm(tempValidDir, { recursive: true, force: true });
  });

  it('should throw an error when adding a workspace without platformio.ini', async () => {
    await expect(addWorkspace(tempEmptyDir)).rejects.toThrowError(/missing platformio.ini/);
  });

  it('should succeed when adding a valid workspace with platformio.ini', async () => {
    await expect(addWorkspace(tempValidDir)).resolves.toBeUndefined();
  });
});
