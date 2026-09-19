/** Session ownership, policy boundaries and lease cleanup with maintained mock streams, never hardware. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { SerialPortMock } from "serialport";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SerialSessionManager,
  type SerialSessionAuthorizer,
  type SerialSessionRequest,
} from "../src/core/serial/session-manager.js";
import { DeviceLeaseStore } from "../src/core/devices/device-lease.js";
import {
  DirectSerialTransport,
  type SerialPortHandle,
} from "../src/core/serial/serial-transport.js";
import { PlatformIOError } from "../src/utils/errors.js";

const directories: string[] = [];
const cleanup: Array<() => Promise<unknown>> = [];
function fixture(authorize: SerialSessionAuthorizer = async () => () => {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "pio-session-"),
  );
  directories.push(root);
  const leases = new DeviceLeaseStore({
    root: path.join(root, "leases"),
    inspect: () => ({
      status: "running",
      identity: {
        pid: process.pid,
        platform: process.platform,
        startToken: "test-process",
      },
    }),
  });
  const ports = new Map<string, SerialPortMock>();
  const transport = vi.fn(async (options, onData) => {
    SerialPortMock.binding.createPort(options.path, {
      echo: true,
      record: true,
      maxReadSize: 1,
    });
    const port = new SerialPortMock({
      path: options.path,
      baudRate: options.baudRate,
      autoOpen: false,
    });
    ports.set(options.path, port);
    return new DirectSerialTransport(port, options, onData);
  }) as ReturnType<
    typeof vi.fn<
      typeof import("../src/core/serial/serial-transport.js").createDirectSerialTransport
    >
  >;
  const manager = new SerialSessionManager({ authorize, leases, transport });
  const owner = manager.createOwner();
  cleanup.push(() => manager.stopAll(owner));
  const request = (): SerialSessionRequest => {
    const id = randomUUID();
    return {
      projectDir: root,
      path: id,
      baudRate: 115200,
      resource: { kind: "serial", identity: id },
    };
  };
  return { root, leases, ports, manager, owner, request, transport };
}
afterEach(async () => {
  for (const stop of cleanup.splice(0)) await stop();
  for (const dir of directories.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("owned serial sessions", () => {
  it("joins an authorized mock port, UTF-8 buffer and exclusive lease through stop and retained reads", async () => {
    const f = fixture();
    const request = f.request();
    const started = await f.manager.start(f.owner, request);
    expect(started).toMatchObject({ state: "open", cleanupPending: true });
    expect(() => f.leases.acquire(request.resource)).toThrow(
      expect.objectContaining({ code: "DEVICE_BUSY" }),
    );
    const read = f.manager.read(f.owner, started.sessionId, {
      waitFor: "ready 🙂",
      timeoutMs: 1000,
    });
    expect(
      await f.manager.write(
        f.owner,
        started.sessionId,
        Buffer.from("ready 🙂\n"),
      ),
    ).toMatchObject({ drained: true });
    expect((await read).matched).toBe(true);
    expect(await f.manager.stop(f.owner, started.sessionId)).toMatchObject({
      state: "stopped",
      cleanupPending: false,
    });
    expect((await f.manager.read(f.owner, started.sessionId)).state).toBe(
      "stopped",
    );
    const next = f.leases.acquire(request.resource);
    f.leases.release(next);
    f.manager.forget(f.owner, started.sessionId);
    expect(f.manager.list(f.owner)).toEqual([]);
  });
  it("rechecks endpoint identity after asynchronous backend loading and releases without opening on replacement", async () => {
    const f = fixture();
    const request = f.request();
    let changed = false;
    const revalidate = vi.fn(() => {
      if (changed)
        throw new PlatformIOError(
          "Endpoint replaced.",
          "SERIAL_ENDPOINT_CHANGED",
        );
    });
    const original = f.transport.getMockImplementation()!;
    f.transport.mockImplementationOnce(async (...args) => {
      const transport = await original(...args);
      changed = true;
      return transport;
    });
    await expect(
      f.manager.start(f.owner, { ...request, revalidateEndpoint: revalidate }),
    ).rejects.toMatchObject({
      code: "SERIAL_ENDPOINT_CHANGED",
      context: { cleanupPending: false },
    });
    expect(revalidate).toHaveBeenCalledTimes(2);
    expect(f.ports.get(request.path)?.isOpen).toBe(false);
    const lease = f.leases.acquire(request.resource);
    f.leases.release(lease);
  });

  it("closes an opened transport when endpoint revalidation detects replacement after open", async () => {
    const f = fixture();
    const request = f.request();
    let checks = 0;
    await expect(
      f.manager.start(f.owner, {
        ...request,
        revalidateEndpoint: () => {
          if (++checks === 3)
            throw new PlatformIOError(
              "Endpoint replaced.",
              "SERIAL_ENDPOINT_CHANGED",
            );
        },
      }),
    ).rejects.toMatchObject({
      code: "SERIAL_ENDPOINT_CHANGED",
      context: { cleanupPending: false },
    });
    expect(checks).toBe(3);
    expect(f.ports.get(request.path)?.isOpen).toBe(false);
    const lease = f.leases.acquire(request.resource);
    f.leases.release(lease);
  });

  it("never accepts a guessed session ID or copied owner object as authority", async () => {
    const f = fixture();
    const started = await f.manager.start(f.owner, f.request());
    const other = f.manager.createOwner();
    expect(f.manager.list(other)).toEqual([]);
    await expect(
      f.manager.read(other, started.sessionId),
    ).rejects.toMatchObject({ code: "SERIAL_SESSION_NOT_OWNED" });
    await expect(
      f.manager.write(other, started.sessionId, Buffer.from("bad")),
    ).rejects.toMatchObject({ code: "SERIAL_SESSION_NOT_OWNED" });
    await expect(
      f.manager.stop(other, started.sessionId),
    ).rejects.toMatchObject({ code: "SERIAL_SESSION_NOT_OWNED" });
    expect(() => f.manager.list({ ...f.owner })).toThrow();
    expect(await f.manager.stopAll(other)).toEqual([]);
    expect(f.manager.list(f.owner)[0].state).toBe("open");
  });
  it("denies before acquiring/opening and preserves approval challenge metadata", async () => {
    const requests: unknown[] = [];
    const f = fixture(async (request) => {
      requests.push(request);
      throw new PlatformIOError("Approval required", "APPROVAL_REQUIRED", {
        approvalId: "challenge",
      });
    });
    await expect(f.manager.start(f.owner, f.request())).rejects.toMatchObject({
      code: "APPROVAL_REQUIRED",
      context: { approvalId: "challenge", cleanupPending: false },
    });
    expect(f.transport).not.toHaveBeenCalled();
    expect(requests[0]).not.toHaveProperty("sessionId");
    expect(requests[0]).toMatchObject({
      operationTimeoutMs: 5000,
      bufferLimits: { maxLines: 5000, maxBytes: 1048576, maxLineBytes: 16384 },
    });
  });
  it("revalidates after asynchronous transport loading and releases its unopened lease on policy change", async () => {
    let revision = 0;
    const f = fixture(async () => {
      const approved = revision;
      return () => {
        if (revision !== approved)
          throw new PlatformIOError("Policy changed", "POLICY_CHANGED");
      };
    });
    const original = f.transport.getMockImplementation()!;
    f.transport.mockImplementation(async (...args) => {
      const transport = await original(...args);
      revision++;
      return transport;
    });
    const request = f.request();
    await expect(f.manager.start(f.owner, request)).rejects.toMatchObject({
      code: "POLICY_CHANGED",
      context: { cleanupPending: false },
    });
    expect(f.ports.get(request.path)!.isOpen).toBe(false);
    const next = f.leases.acquire(request.resource);
    f.leases.release(next);
  });
  it("binds writes to a copied payload digest and allows cleanup after permission revocation", async () => {
    let allow = true;
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let hash: string | undefined;
    const f = fixture(async (request) => {
      if (!allow) throw new PlatformIOError("Denied", "POLICY_DENIED");
      if (request.operation === "write") {
        hash = request.bytesHash;
        await gate;
      }
      return () => {
        if (!allow) throw new PlatformIOError("Changed", "POLICY_CHANGED");
      };
    });
    const request = f.request();
    const started = await f.manager.start(f.owner, request);
    const bytes = Buffer.from("original");
    const writing = f.manager.write(f.owner, started.sessionId, bytes);
    bytes.fill(0);
    resume();
    await writing;
    expect(hash).toBe(createHash("sha256").update("original").digest("hex"));
    expect(f.ports.get(request.path)!.port!.recording.toString()).toBe(
      "original",
    );
    allow = false;
    await expect(
      f.manager.read(f.owner, started.sessionId),
    ).rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(await f.manager.stop(f.owner, started.sessionId)).toMatchObject({
      cleanupPending: false,
    });
  });
  it("withholds read output if policy changes while waiting", async () => {
    let revision = 0;
    const f = fixture(async () => {
      const approved = revision;
      return () => {
        if (approved !== revision)
          throw new PlatformIOError("Changed", "POLICY_CHANGED");
      };
    });
    const request = f.request();
    const started = await f.manager.start(f.owner, request);
    const reading = expect(
      f.manager.read(f.owner, started.sessionId, {
        timeoutMs: 1000,
        waitFor: "secret",
      }),
    ).rejects.toMatchObject({ code: "POLICY_CHANGED" });
    await Promise.resolve();
    revision++;
    f.ports.get(request.path)!.port!.emitData("secret\n");
    await reading;
  });
  it("reports failed lease release and keeps the session available for owned retry", async () => {
    const f = fixture();
    const started = await f.manager.start(f.owner, f.request());
    const original = f.leases.release.bind(f.leases);
    const release = vi.spyOn(f.leases, "release").mockImplementation(() => {
      throw new Error("gate busy");
    });
    expect(await f.manager.stop(f.owner, started.sessionId)).toMatchObject({
      cleanupPending: true,
      cleanupError: "SERIAL_LEASE_RELEASE_FAILED",
    });
    expect(() => f.manager.forget(f.owner, started.sessionId)).toThrow(
      expect.objectContaining({ code: "SERIAL_CLEANUP_PENDING" }),
    );
    release.mockImplementation(original);
    expect(await f.manager.stop(f.owner, started.sessionId)).toMatchObject({
      cleanupPending: false,
    });
  });
  it("caps pending starts and cancels a stopped request before any port opens", async () => {
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const f = fixture(async () => {
      await gate;
      return () => {};
    });
    const pending = Array.from({ length: 8 }, () =>
      f.manager.start(f.owner, f.request()).catch((error: Error) => error),
    );
    await expect(f.manager.start(f.owner, f.request())).rejects.toMatchObject({
      code: "SERIAL_SESSION_LIMIT",
    });
    const first = f.manager.list(f.owner)[0];
    expect(await f.manager.stop(f.owner, first.sessionId)).toMatchObject({
      cleanupPending: true,
    });
    resume();
    const results = await Promise.all(pending);
    expect(results[0]).toMatchObject({ code: "SERIAL_CLOSED" });
    expect(f.transport).toHaveBeenCalledTimes(7);
  });
  it("cleans a one-shot capture after an invalid pattern and reports the original error", async () => {
    const f = fixture();
    const request = f.request();
    await expect(
      f.manager.capture(f.owner, request, {
        waitFor: "[",
        patternOptions: { mode: "regex" },
      }),
    ).rejects.toMatchObject({
      code: "PATTERN_INVALID",
      context: { cleanupPending: false },
    });
    const next = f.leases.acquire(request.resource);
    f.leases.release(next);
    expect(f.manager.list(f.owner)[0].state).toBe("stopped");
  });
  it("keeps the lease while a native close remains unconfirmed", async () => {
    const f = fixture();
    class StalledClosePort extends EventEmitter implements SerialPortHandle {
      isOpen = false;
      closeCallback?: (error: Error | null) => void;
      open(callback: (error: Error | null) => void): void {
        this.isOpen = true;
        callback(null);
      }
      close(callback: (error: Error | null) => void): void {
        this.closeCallback = callback;
      }
      write(_bytes: Buffer, callback: (error?: Error | null) => void): boolean {
        callback();
        return true;
      }
      drain(callback: (error?: Error | null) => void): void {
        callback();
      }
      finish(): void {
        this.isOpen = false;
        this.emit("close");
        this.closeCallback?.(null);
      }
    }
    const port = new StalledClosePort();
    f.transport.mockImplementation(
      async (options, data) => new DirectSerialTransport(port, options, data),
    );
    const request = { ...f.request(), operationTimeoutMs: 15 };
    const started = await f.manager.start(f.owner, request);
    expect(await f.manager.stop(f.owner, started.sessionId)).toMatchObject({
      cleanupPending: true,
      cleanupError: "SERIAL_CLOSE_UNCONFIRMED",
    });
    expect(() => f.leases.acquire(request.resource)).toThrow(
      expect.objectContaining({ code: "DEVICE_BUSY" }),
    );
    port.finish();
    await Promise.resolve();
    expect(f.manager.list(f.owner)[0]).toMatchObject({ cleanupPending: false });
  });
  it("stops a request while the unopened transport factory is pending", async () => {
    const f = fixture();
    const original = f.transport.getMockImplementation()!;
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    f.transport.mockImplementation(async (...args) => {
      await gate;
      return original(...args);
    });
    const request = f.request();
    const pending = expect(
      f.manager.start(f.owner, request),
    ).rejects.toMatchObject({
      code: "SERIAL_CLOSED",
      context: { cleanupPending: false },
    });
    // Authorization resumes before loading the deferred factory.
    await Promise.resolve();
    await Promise.resolve();
    const info = f.manager.list(f.owner)[0];
    expect(await f.manager.stop(f.owner, info.sessionId)).toMatchObject({
      cleanupPending: true,
    });
    resume();
    await pending;
    expect(f.ports.get(request.path)!.isOpen).toBe(false);
    expect(f.manager.list(f.owner)[0]).toMatchObject({ cleanupPending: false });
    const next = f.leases.acquire(request.resource);
    f.leases.release(next);
  });
  it("bounds retained completed sessions without evicting a live owner", async () => {
    const f = fixture();
    const live = await f.manager.start(f.owner, f.request());
    let oldest = "";
    for (let index = 0; index < 18; index++) {
      const started = await f.manager.start(f.owner, f.request());
      oldest ||= started.sessionId;
      await f.manager.stop(f.owner, started.sessionId);
    }
    const retained = f.manager.list(f.owner);
    expect(retained).toHaveLength(17);
    expect(
      retained.find((session) => session.sessionId === live.sessionId)?.state,
    ).toBe("open");
    await expect(f.manager.read(f.owner, oldest)).rejects.toMatchObject({
      code: "SERIAL_SESSION_NOT_OWNED",
    });
  });
});
