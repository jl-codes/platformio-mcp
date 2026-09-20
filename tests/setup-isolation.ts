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
afterAll(async () => {
  // Yield during retries so pending diagnostic writes can finish on Windows.
  // Keep those writes isolated until cleanup completes, including on failure.
  const target = path.resolve(isolatedData);
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (!target.startsWith(tempRoot) || !path.basename(target).startsWith("pio-test-authority-")) {
    throw new Error("Refusing cleanup outside the isolated test directory");
  }
  try {
    await fs.promises.rm(target, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  } finally {
    if (originalData === undefined) delete process.env.PIO_MCP_DATA_DIR;
    else process.env.PIO_MCP_DATA_DIR = originalData;
    if (originalPolicy === undefined) delete process.env.PIO_MCP_POLICY_FILE;
    else process.env.PIO_MCP_POLICY_FILE = originalPolicy;
  }
});
