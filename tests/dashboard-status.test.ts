import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolate from the developer's real data dir before paths.ts resolves it.
const TMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pio-portal-"));
process.env.PIO_MCP_DATA_DIR = TMP_DATA_DIR;
afterAll(() => fs.rmSync(TMP_DATA_DIR, { recursive: true, force: true }));

const { findRunningPortal } = await import("../src/api/server.js");
const { SERVER_DATA_DIR } = await import("../src/utils/paths.js");

const stateFile = path.join(SERVER_DATA_DIR, "portal.json");

function advertise(pid: number, port = 8123) {
  fs.mkdirSync(SERVER_DATA_DIR, { recursive: true });
  fs.writeFileSync(
    stateFile,
    JSON.stringify({ pid, host: "127.0.0.1", port, startedAt: Date.now() }),
  );
}

describe("findRunningPortal", () => {
  beforeEach(() => fs.rmSync(stateFile, { force: true }));
  afterEach(() => fs.rmSync(stateFile, { force: true }));

  it("reports no portal when nothing is advertised", () => {
    expect(findRunningPortal()).toBeNull();
  });

  it("sees a portal advertised by another live process", () => {
    // The whole point: activePortalStatus is in-process, so before this existed
    // a one-shot CLI always answered "offline" and the dashboard skill told
    // users to start a second server.
    advertise(process.pid, 8123);
    const portal = findRunningPortal();
    expect(portal).not.toBeNull();
    expect(portal!.port).toBe(8123);
    expect(portal!.pid).toBe(process.pid);
  });

  it("discards an advertisement whose process is gone, and cleans it up", () => {
    advertise(999999, 8123);
    expect(findRunningPortal()).toBeNull();
    expect(fs.existsSync(stateFile)).toBe(false);
  });

  it("ignores a corrupt advertisement", () => {
    fs.mkdirSync(SERVER_DATA_DIR, { recursive: true });
    fs.writeFileSync(stateFile, "{ not json");
    expect(findRunningPortal()).toBeNull();
  });
});
