/** Debugger session ownership and shutdown races retain custody until cleanup succeeds. */
import { DebugStartupFailure } from "../src/core/debug/debug-start-failure.js";
import { expect, it, vi } from "vitest";
import {
  DebugClientSessions,
  type OwnedDebugProcess,
} from "../src/core/debug/debug-client-sessions.js";
function processFixture() {
  return {
    command: vi.fn<OwnedDebugProcess["command"]>(),
    state: vi.fn<OwnedDebugProcess["state"]>(),
    cleanupProcess: vi.fn(async () => {}),
  };
}
it("isolates IDs between connections and binds command grants to the owned ID", async () => {
  const owner = new DebugClientSessions(),
    other = new DebugClientSessions();
  const process = processFixture();
  const id = await owner.start("project", "env", async () => process);
  expect(other.list()).toEqual([]);
  expect(() => other.command(id, "bt", {})).toThrow(/owned/);
  owner.command(id, "bt", {}, 1000, "approval");
  expect(process.command).toHaveBeenCalledWith("bt", {}, 1000, {
    sessionId: id,
    approvalId: "approval",
  });
  expect(owner.list()).toMatchObject([
    { session_id: id, project_dir: "project", env: "env" },
  ]);
  await owner.close();
});
it("retains failed cleanup and coalesces concurrent stops", async () => {
  const owner = new DebugClientSessions(),
    process = processFixture();
  const id = await owner.start("project", "env", async () => process);
  process.cleanupProcess.mockRejectedValueOnce(new Error("probe still owned"));
  const first = owner.stop(id);
  expect(owner.stop(id)).toBe(first);
  expect(() => owner.command(id, "bt", {})).toThrow(/cleanup/);
  await expect(first).rejects.toThrow("probe still owned");
  expect(owner.list()).toHaveLength(1);
  await owner.stop(id);
  expect(owner.list()).toEqual([]);
  expect(process.cleanupProcess).toHaveBeenCalledTimes(2);
});
it("cleans a process whose launch finishes after disconnect", async () => {
  const owner = new DebugClientSessions(),
    process = processFixture();
  let complete!: (process: OwnedDebugProcess) => void;
  const startup = owner.start(
    "project",
    "env",
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const failed = expect(startup).rejects.toMatchObject({
    code: "DEBUG_CLIENT_CLOSED",
  });
  await Promise.resolve();
  const closing = owner.close();
  complete(process);
  await failed;
  expect(await closing).toEqual({ cleanupPending: false, failed: 0 });
  expect(process.cleanupProcess).toHaveBeenCalledTimes(1);
  await expect(
    owner.start("project", "env", async () => process),
  ).rejects.toMatchObject({ code: "DEBUG_CLIENT_CLOSED" });
});
it("counts in-flight starts toward capacity", async () => {
  const owner = new DebugClientSessions();
  const processes = Array.from({ length: 8 }, processFixture);
  const starts = processes.map((process) =>
    owner.start("project", "env", async () => process),
  );
  await expect(
    owner.start("project", "env", async () => processFixture()),
  ).rejects.toMatchObject({ code: "DEBUG_SESSION_LIMIT" });
  await Promise.all(starts);
  await owner.close();
});

it("retains failed startup ownership under the ID supplied before launch", async () => {
  const owner = new DebugClientSessions(),
    process = processFixture();
  let selected = "";
  await expect(
    owner.start("project", "env", async (id) => {
      selected = id;
      throw new DebugStartupFailure(process);
    }),
  ).rejects.toMatchObject({
    code: "GDB_START_FAILED",
    context: { cleanupPending: true },
  });
  expect(owner.list()).toMatchObject([{ session_id: selected }]);
  await owner.stop(selected);
  expect(owner.list()).toEqual([]);
});
