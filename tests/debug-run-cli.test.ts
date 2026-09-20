/** CLI debugger sequences preserve connection ownership and stop on failed commands. */
import { beforeEach, expect, it, vi } from "vitest";
const owner = vi.hoisted(() => ({
  start: vi.fn(),
  execute: vi.fn(),
  close: vi.fn(),
}));
vi.mock("../src/adapters/debug-compat.js", async (original) => ({
  ...(await original<typeof import("../src/adapters/debug-compat.js")>()),
  DebugCompatibilityClient: class {
    start = owner.start;
    execute = owner.execute;
    close = owner.close;
  },
}));
import {
  parseDebugRunCli,
  executeDebugRunCli,
} from "../src/adapters/debug-run-cli.js";
beforeEach(() => {
  vi.resetAllMocks();
  owner.start.mockResolvedValue({ ok: true, session_id: "owned" });
  owner.execute.mockResolvedValue({ ok: true });
  owner.close.mockResolvedValue({ cleanupPending: false, failed: 0 });
});
it("validates the entire command sequence and rejects launcher overrides before startup", () => {
  expect(
    parseDebugRunCli(
      { commands: '["bt","next"]', load: "false" },
      [],
      "/project",
    ),
  ).toMatchObject({ start: { load: false }, commands: ["bt", "next"] });
  for (const options of [
    { commands: "[]" },
    { commands: '["bt"]', executable: "evil" },
    { commands: '["bt","unsupported command"]' },
    { commands: '["bt"]', timeout: "NaN" },
  ]) {
    expect(() => parseDebugRunCli(options, [], "/project")).toThrow();
  }
  expect(owner.start).not.toHaveBeenCalled();
});
it("runs all commands through one owner and performs normal authorized stop", async () => {
  const result = await executeDebugRunCli(
    parseDebugRunCli({ commands: '["bt","next"]' }, [], "/project"),
    { actor: "user" },
  );
  expect(result).toMatchObject({ ok: true, completedCommands: 2 });
  expect(owner.execute.mock.calls.map((call) => call[0])).toEqual([
    "pio_debug_cmd",
    "pio_debug_cmd",
    "pio_debug_stop",
  ]);
  for (const call of owner.execute.mock.calls)
    expect(call[1].session_id).toBe("owned");
  expect(owner.execute.mock.calls[2][1].process_only).toBe(false);
  expect(owner.close).toHaveBeenCalledOnce();
});
it("stops the sequence on timeout/failure and honors explicit process-only cleanup", async () => {
  owner.execute.mockResolvedValueOnce({ ok: false, timed_out: true });
  const result = await executeDebugRunCli(
    parseDebugRunCli(
      { commands: '["continue","next"]', "process-only": true },
      [],
      "/project",
    ),
    {},
  );
  expect(result).toMatchObject({ ok: false, completedCommands: 1 });
  expect(owner.execute.mock.calls[1]).toMatchObject([
    "pio_debug_stop",
    { session_id: "owned", process_only: true },
    {},
  ]);
  expect(owner.close).toHaveBeenCalledOnce();
});
it("cleans up after startup or command permission denial without retrying target effects", async () => {
  owner.start.mockRejectedValueOnce(new Error("policy denied"));
  await expect(
    executeDebugRunCli(
      parseDebugRunCli({ commands: '["bt"]' }, [], "/project"),
      {},
    ),
  ).rejects.toThrow("policy denied");
  expect(owner.execute).not.toHaveBeenCalled();
  expect(owner.close).toHaveBeenCalledOnce();
});
it("never reports success when process cleanup remains uncertain", async () => {
  owner.close.mockResolvedValue({ cleanupPending: true, failed: 1 });
  await expect(
    executeDebugRunCli(
      parseDebugRunCli({ commands: '["bt"]' }, [], "/project"),
      {},
    ),
  ).rejects.toMatchObject({ code: "DEBUG_CLI_CLEANUP_PENDING" });
});
