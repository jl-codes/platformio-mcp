/** Private-stdin uploader transport and confirmed cleanup using synthetic child handles. */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";
import os from "node:os";
import { beforeEach, expect, it, vi } from "vitest";
const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));
import { runEspotaProcess } from "../src/core/ota/espota-process.js";
beforeEach(() => spawn.mockReset());
function fixture(
  onInput?: (child: ReturnType<typeof childFixture>, input: string) => void,
) {
  const child = childFixture();
  let input = "";
  child.stdin.on("data", (chunk) => {
    input += chunk.toString();
  });
  child.stdin.on("finish", () => onInput?.(child, input));
  spawn.mockReturnValue(child);
  const custody = { prepareSpawn: vi.fn(), releaseAfterExit: vi.fn() };
  const request = {
    pythonExecutable: process.execPath,
    uploaderScript: path.join(os.tmpdir(), "espota.py"),
    imagePath: path.join(os.tmpdir(), "firmware.bin"),
    imageSha256: "a".repeat(64),
    uploaderSha256: "b".repeat(64),
    address: "192.0.2.8",
    port: 3232,
    auth: "private-password",
    filesystem: false,
    timeoutMs: 1000,
    custody,
  };
  return { child, request, custody };
}
function childFixture() {
  const child = Object.assign(new EventEmitter(), {
    pid: 42,
    exitCode: null as number | null,
    signalCode: null as string | null,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => {
      child.exitCode = 1;
      child.emit("exit", 1);
      child.emit("close", 1);
      return true;
    }),
  });
  return child;
}
it("keeps credentials off argv and redacts even split output echoes", async () => {
  const f = fixture((child, input) => {
    expect(JSON.parse(input)).toMatchObject({
      auth: "private-password",
      address: "192.0.2.8",
    });
    child.stdout.write("private-");
    child.stdout.write("password");
    child.exitCode = 0;
    child.emit("exit", 0);
    child.emit("close", 0);
  });
  const result = await runEspotaProcess(f.request);
  expect(result).toMatchObject({ exitCode: 0, stdout: "[REDACTED]" });
  expect(JSON.stringify(spawn.mock.calls)).not.toContain("private-password");
  expect(f.custody.prepareSpawn).toHaveBeenCalledOnce();
  expect(f.custody.releaseAfterExit).toHaveBeenCalledOnce();
});
it("terminates and confirms cleanup on timeout", async () => {
  const f = fixture();
  await expect(
    runEspotaProcess({ ...f.request, timeoutMs: 10 }),
  ).rejects.toMatchObject({
    code: "OTA_TIMEOUT",
    context: { cleanupPending: false },
  });
  expect(f.child.kill).toHaveBeenCalled();
  expect(f.custody.releaseAfterExit).toHaveBeenCalledOnce();
});
it("bounds child output and releases only after cancellation closes it", async () => {
  const f = fixture((child) =>
    child.stdout.write(Buffer.alloc(1024 * 1024 + 1)),
  );
  await expect(runEspotaProcess(f.request)).rejects.toMatchObject({
    code: "OTA_OUTPUT_LIMIT",
    context: { cleanupPending: false },
  });
  expect(f.custody.releaseAfterExit).toHaveBeenCalledOnce();
});
it("rejects invalid input before custody or spawning", async () => {
  const f = fixture();
  await expect(
    runEspotaProcess({ ...f.request, auth: "bad\nsecret" }),
  ).rejects.toMatchObject({ code: "OTA_EXECUTION_INVALID" });
  expect(spawn).not.toHaveBeenCalled();
  expect(f.custody.prepareSpawn).not.toHaveBeenCalled();
});
