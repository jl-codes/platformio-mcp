/** Startup orchestration preserves artifacts and cleanup ownership across attachment failures. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../src/core/debug/debug-elf.js", async (original) => ({
  ...(await original<typeof import("../src/core/debug/debug-elf.js")>()),
  retainDebugElf: vi.fn(async () => ({
    path: "snapshot.elf",
    identity: {},
    release: vi.fn(async () => {}),
  })),
}));
import { retainDebugElf } from "../src/core/debug/debug-elf.js";
import { DebugProcess } from "../src/core/debug/debug-process.js";
import { DebugClientSessions } from "../src/core/debug/debug-client-sessions.js";
import { startPreparedDebugger } from "../src/core/debug/debug-startup.js";
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-debug-startup-"));
  vi.stubEnv("PIO_MCP_POLICY_FILE", path.join(root, "operator.json"));
  fs.writeFileSync(
    path.join(root, "operator.json"),
    JSON.stringify({
      profile: "lab_admin",
      overrides: {
        allow: ["upload_firmware", "run_shell_command"],
        deny: [],
        approval_required: [],
        audit_all_agent_actions: false,
      },
    }),
  );
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const process = {
    attach: vi.fn(async () => {}),
    command: vi.fn(),
    state: vi.fn(() => ({})),
    cleanupProcess: vi.fn(async () => {}),
  };
  vi.spyOn(DebugProcess, "start").mockResolvedValue(
    process as unknown as DebugProcess,
  );
  const acquireCustody = vi.fn(async () => ({
    custody: { prepareSpawn: vi.fn(), releaseAfterExit: vi.fn() },
    confirmProbeReleased: async () => true,
  }));
  const selection = {
    projectDir: root,
    environment: "esp",
    elfPath: path.join(root, "firmware.elf"),
    executable: path.join(root, "host-gdb"),
    trustedDebuggerRoots: [root],
    target: { host: "127.0.0.1", port: 3333, load: false },
    acquireCustody,
  };
  return { process, selection };
}
it("keeps the snapshot until successful session cleanup", async () => {
  const { process, selection } = fixture(),
    sessions = new DebugClientSessions();
  const id = await startPreparedDebugger(sessions, selection);
  const lease = await vi.mocked(retainDebugElf).mock.results[0].value;
  expect(DebugProcess.start).toHaveBeenCalledWith(
    expect.objectContaining({ elfPath: "snapshot.elf" }),
  );
  expect(process.attach).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: id, load: false }),
    {},
  );
  expect(lease.release).not.toHaveBeenCalled();
  await sessions.stop(id);
  expect(lease.release).toHaveBeenCalledOnce();
});
it("retains a failed attachment when probe cleanup cannot be confirmed", async () => {
  const { process, selection } = fixture(),
    sessions = new DebugClientSessions();
  process.attach.mockRejectedValueOnce(new Error("attachment failed"));
  process.cleanupProcess.mockRejectedValueOnce(new Error("probe busy"));
  await expect(
    startPreparedDebugger(sessions, selection),
  ).rejects.toMatchObject({ code: "GDB_START_FAILED" });
  const lease = await vi.mocked(retainDebugElf).mock.results[0].value;
  expect(lease.release).not.toHaveBeenCalled();
  const [retained] = sessions.list();
  await sessions.stop(retained.session_id);
  expect(lease.release).toHaveBeenCalledOnce();
});
it("denies startup before allocating artifacts or probe custody", async () => {
  const { selection } = fixture(),
    sessions = new DebugClientSessions();
  fs.writeFileSync(
    path.join(root, "operator.json"),
    JSON.stringify({ profile: "read_only" }),
  );
  await expect(
    startPreparedDebugger(sessions, selection),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(retainDebugElf).not.toHaveBeenCalled();
  expect(selection.acquireCustody).not.toHaveBeenCalled();
  expect(DebugProcess.start).not.toHaveBeenCalled();
});
