/** Isolates every Vitest worker from the operator's real policy, approvals and audit data. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

const originalData = process.env.PIO_MCP_DATA_DIR;
const originalPolicy = process.env.PIO_MCP_POLICY_FILE;
const isolatedData = fs.mkdtempSync(
  path.join(os.tmpdir(), "pio-test-authority-"),
);
process.env.PIO_MCP_DATA_DIR = isolatedData;
delete process.env.PIO_MCP_POLICY_FILE;
afterAll(() => {
  if (originalData === undefined) delete process.env.PIO_MCP_DATA_DIR;
  else process.env.PIO_MCP_DATA_DIR = originalData;
  if (originalPolicy === undefined) delete process.env.PIO_MCP_POLICY_FILE;
  else process.env.PIO_MCP_POLICY_FILE = originalPolicy;
  fs.rmSync(isolatedData, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50,
  });
});
