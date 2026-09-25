/** PPK2 ownership requires both device cleanup and supervisor closure; no real ports are opened. */
import { beforeEach, expect, it, vi } from "vitest";
import path from "node:path";
const fixture = vi.hoisted(() => ({
  options: undefined as any,
  closed: false,
  pending: true,
  reply: undefined as any,
  write: vi.fn(),
  wait: vi.fn(),
  cleanup: vi.fn(),
}));
vi.mock("../src/core/debug/debug-backend-process.js", () => ({
  DebugBackendProcess: class {
    constructor(options: any) {
      fixture.options = options;
    }
    waitStarted = fixture.wait;
    writeStdin = fixture.write;
    cleanupProcess = fixture.cleanup;
    state() {
      return { closed: fixture.closed, cleanupPending: fixture.pending };
    }
  },
}));
import { Ppk2Process } from "../src/core/power/ppk2-process.js";
const terminal = {
  event: "finished",
  outcome: "complete",
  sampleCount: 0,
  partialWindowSamples: 0,
  emittedWindows: 0,
  unreportedWindows: 0,
  durationSeconds: 0.01,
  partialRawBytes: 0,
  deviceTouched: true,
  outputOffWritten: true,
  outputOffPhysicallyVerified: false,
  powerMayBeOn: false,
  measurementStopped: true,
  serialClosed: true,
};
function emit(value: unknown) {
  fixture.options.onStdout(Buffer.from(JSON.stringify(value) + "\n"));
}
function owner() {
  const custody = {
    prepareSpawn: vi.fn(async () => {}),
    releaseAfterExit: vi.fn(),
  };
  return {
    custody,
    process: new Ppk2Process({
      pythonExecutable: path.resolve("python.exe"),
      cwd: process.cwd(),
      request: {
        port: "FAKE",
        mode: "source",
        voltageMv: 3300,
        currentLimitMa: 50,
        seconds: 0.01,
      },
      custody,
    }),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  fixture.closed = false;
  fixture.pending = true;
  fixture.reply = terminal;
  fixture.wait.mockResolvedValue(undefined);
  fixture.write.mockImplementation(async (data: Buffer) => {
    if (data.toString().startsWith("{")) {
      emit({
        event: "started",
        mode: "source",
        sampleRateHz: 100000,
        windowSamples: 1000,
        currentLimitKind: "software_trip",
      });
      if (fixture.reply) emit(fixture.reply);
    }
  });
  fixture.cleanup.mockImplementation(async () => {
    fixture.closed = true;
    fixture.pending = false;
    fixture.options.onClose();
  });
});
it("releases only after terminal cleanup and supervisor group closure", async () => {
  const f = owner();
  fixture.cleanup.mockImplementationOnce(async () => {
    expect(f.custody.releaseAfterExit).not.toHaveBeenCalled();
    fixture.closed = true;
    fixture.pending = false;
    fixture.options.onClose();
  });
  expect(await f.process.collect()).toMatchObject({
    cleanupReported: true,
    ended: true,
  });
  expect(f.custody.releaseAfterExit).toHaveBeenCalledOnce();
  expect(f.process.state().cleanupPending).toBe(false);
});
it("retains custody after source-off failure even if the group closed", async () => {
  fixture.reply = {
    ...terminal,
    outcome: "PPK2_IO_FAILED",
    outputOffWritten: false,
    powerMayBeOn: true,
  };
  const f = owner();
  await expect(f.process.collect()).rejects.toMatchObject({
    code: "PPK2_CLEANUP_PENDING",
  });
  expect(f.custody.releaseAfterExit).not.toHaveBeenCalled();
  expect(f.process.state()).toMatchObject({
    cleanupPending: true,
    processClosed: true,
    powerMayBeOn: true,
  });
});
it("retains cleanup ownership for a supervisor failure and supports retry", async () => {
  fixture.cleanup.mockRejectedValueOnce(new Error("group pending"));
  const f = owner();
  await expect(f.process.collect()).rejects.toThrow("group pending");
  expect(f.custody.releaseAfterExit).not.toHaveBeenCalled();
  await f.process.cleanupProcess();
  expect(f.custody.releaseAfterExit).toHaveBeenCalledOnce();
});
it("lets cancellation wait for graceful device cleanup before forcing closure", async () => {
  const controller = new AbortController();
  fixture.reply = null;
  fixture.write.mockImplementation(async (data: Buffer) => {
    if (data.toString().startsWith("{")) {
      emit({
        event: "started",
        mode: "source",
        sampleRateHz: 100000,
        windowSamples: 1000,
        currentLimitKind: "software_trip",
      });
      controller.abort();
    } else
      setTimeout(() => emit({ ...terminal, outcome: "PPK2_CANCELLED" }), 20);
  });
  const f = owner();
  fixture.cleanup.mockImplementationOnce(async () => {
    expect(f.process.state().deviceCleanupReported).toBe(true);
    fixture.closed = true;
    fixture.pending = false;
    fixture.options.onClose();
  });
  await expect(f.process.collect(controller.signal)).rejects.toMatchObject({
    code: "PPK2_CANCELLED",
  });
  expect(f.custody.releaseAfterExit).toHaveBeenCalledOnce();
});
it("cleans a failed startup before request delivery without inventing device effects", async () => {
  fixture.wait.mockRejectedValueOnce(new Error("no child"));
  const f = owner();
  await expect(f.process.collect()).rejects.toThrow("no child");
  expect(fixture.write).not.toHaveBeenCalled();
  expect(f.custody.releaseAfterExit).toHaveBeenCalledOnce();
});
