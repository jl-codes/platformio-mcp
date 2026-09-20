/** Session ownership, policy boundaries and lease cleanup with maintained mock streams, never hardware. */
import { captureTransientMemory } from "../src/core/serial/transient-memory-capture.js";
import { captureSessionMemory } from "../src/core/serial/memory-capture.js";
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
import { resolveSerialEndpoint } from "../src/core/devices/serial-endpoint.js";
import { DeviceLeaseStore } from "../src/core/devices/device-lease.js";
import {
  DirectSerialTransport,
  type SerialPortHandle,
} from "../src/core/serial/serial-transport.js";
import { PowerDeviceCustody } from "../src/core/power/power-device-custody.js";
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

  it("holds endpoint and USB scopes together and releases both after confirmed closure", async () => {
    const f = fixture();
    const request = f.request();
    const usb = { kind: "serial" as const, identity: "usb:fixture" };
    const session = await f.manager.start(f.owner, {
      ...request,
      additionalResources: [usb],
    });
    for (const resource of [request.resource, usb])
      expect(() => f.leases.acquire(resource)).toThrow(
        expect.objectContaining({ code: "DEVICE_BUSY" }),
      );
    await f.manager.stop(f.owner, session.sessionId);
    for (const resource of [request.resource, usb])
      f.leases.release(f.leases.acquire(resource));
  });
  it("rolls back acquired scopes without opening when a later identity scope is busy", async () => {
    const f = fixture();
    const request = {
      ...f.request(),
      resource: { kind: "serial" as const, identity: "a:endpoint" },
    };
    const usb = { kind: "serial" as const, identity: "z:usb" };
    const held = f.leases.acquire(usb);
    try {
      await expect(
        f.manager.start(f.owner, { ...request, additionalResources: [usb] }),
      ).rejects.toMatchObject({
        code: "DEVICE_BUSY",
        context: { cleanupPending: false },
      });
      expect(f.transport).not.toHaveBeenCalled();
      f.leases.release(f.leases.acquire(request.resource));
    } finally {
      f.leases.release(held);
    }
  });

  it("retains only failed lease releases for owned cleanup retry", async () => {
    const f = fixture();
    const request = f.request();
    const usb = { kind: "serial" as const, identity: "usb:retry" };
    const session = await f.manager.start(f.owner, {
      ...request,
      additionalResources: [usb],
    });
    const release = f.leases.release.bind(f.leases);
    const spy = vi
      .spyOn(f.leases, "release")
      .mockImplementationOnce(() => {
        throw new Error("temporary failure");
      })
      .mockImplementation(release);
    await f.manager.stop(f.owner, session.sessionId);
    // confirmedClosed cleanup and stop may each attempt release; all successful handles must be dropped.
    const after = await f.manager.stop(f.owner, session.sessionId);
    expect(after.cleanupPending).toBe(false);
    expect(spy.mock.calls.length).toBe(3);
    for (const resource of [request.resource, usb])
      f.leases.release(f.leases.acquire(resource));
  });

  it("binds trusted discovery to both scopes and rejects USB replacement before open", async () => {
    const f = fixture();
    const record = {
      path: "COM44",
      vendorId: "10c4",
      productId: "ea60",
      serialNumber: "one",
    };
    const list = vi.fn(async () => [record]);
    const original = f.transport.getMockImplementation()!;
    f.transport.mockImplementationOnce(async (...args) => {
      const transport = await original(...args);
      list.mockResolvedValue([{ ...record, serialNumber: "two" }]);
      return transport;
    });
    await expect(
      f.manager.startDiscovered(
        f.owner,
        { projectDir: f.root, path: "com44", baudRate: 115200 },
        {
          list,
          resolve: (port) => resolveSerialEndpoint(port, { platform: "win32" }),
        },
      ),
    ).rejects.toMatchObject({
      code: "SERIAL_DEVICE_CHANGED",
      context: { cleanupPending: false },
    });
    expect(f.ports.get("COM44")?.isOpen).toBe(false);
  });
  it("bounds stalled metadata checks without opening a transport", async () => {
    const f = fixture();
    await expect(
      f.manager.start(f.owner, {
        ...f.request(),
        operationTimeoutMs: 10,
        revalidateEndpoint: () => new Promise<void>(() => {}),
      }),
    ).rejects.toMatchObject({
      code: "SERIAL_DISCOVERY_TIMEOUT",
      context: { cleanupPending: false },
    });
    expect(f.transport).not.toHaveBeenCalled();
  });

  it("rechecks policy after asynchronous discovery before acquiring or opening", async () => {
    let revoked = false;
    const f = fixture(async () => () => {
      if (revoked)
        throw new PlatformIOError("Policy changed.", "POLICY_CHANGED");
    });
    await expect(
      f.manager.start(f.owner, {
        ...f.request(),
        revalidateEndpoint: async () => {
          await Promise.resolve();
          revoked = true;
        },
      }),
    ).rejects.toMatchObject({
      code: "POLICY_CHANGED",
      context: { cleanupPending: false },
    });
    expect(f.transport).not.toHaveBeenCalled();
  });

  it("cancels pending initial discovery on owner cleanup and never opens after its late result", async () => {
    const f = fixture();
    let finish!: (records: { path: string }[]) => void;
    const pending = f.manager.startDiscovered(
      f.owner,
      { projectDir: f.root, path: "COM44", baudRate: 115200 },
      {
        list: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
        resolve: (port) => resolveSerialEndpoint(port, { platform: "win32" }),
      },
    );
    await Promise.resolve();
    await f.manager.stopAll(f.owner);
    finish([{ path: "COM44" }]);
    await expect(pending).rejects.toMatchObject({ code: "SERIAL_CLOSED" });
    expect(f.transport).not.toHaveBeenCalled();
  });
  it("counts stalled discovery against session capacity and returns capacity after timeout", async () => {
    const f = fixture();
    const requests = Array.from({ length: 8 }, () =>
      f.manager.startDiscovered(
        f.owner,
        {
          projectDir: f.root,
          path: "COM44",
          baudRate: 115200,
          operationTimeoutMs: 20,
        },
        {
          list: () => new Promise(() => {}),
          resolve: (port) => resolveSerialEndpoint(port, { platform: "win32" }),
        },
      ),
    );
    const settled = Promise.allSettled(requests);
    await expect(f.manager.start(f.owner, f.request())).rejects.toMatchObject({
      code: "SERIAL_SESSION_LIMIT",
    });
    expect(
      (await settled).every((result) => result.status === "rejected"),
    ).toBe(true);
    const started = await f.manager.start(f.owner, f.request());
    expect(started.state).toBe("open");
  });

  it("permanently prevents disconnected owners from starting or writing while keeping owned cleanup available", async () => {
    const f = fixture();
    const started = await f.manager.start(f.owner, f.request());
    await f.manager.disconnectOwner(f.owner);
    await expect(f.manager.start(f.owner, f.request())).rejects.toMatchObject({
      code: "SERIAL_OWNER_DISCONNECTED",
    });
    await expect(
      f.manager.write(f.owner, started.sessionId, Buffer.from("command")),
    ).rejects.toMatchObject({ code: "SERIAL_OWNER_DISCONNECTED" });
    expect(
      (await f.manager.stop(f.owner, started.sessionId)).cleanupPending,
    ).toBe(false);
    expect(f.manager.list(f.owner)).toHaveLength(1);
    expect((await f.manager.read(f.owner, started.sessionId)).state).toBe(
      "stopped",
    );
    const other = f.manager.createOwner();
    const next = await f.manager.start(other, f.request());
    await f.manager.stop(other, next.sessionId);
  });

  it("returns and matches filtered text from the owned direct session buffer", async () => {
    const f = fixture();
    const started = await f.manager.start(f.owner, f.request());
    await f.manager.write(
      f.owner,
      started.sessionId,
      Buffer.from("wifi_password=private-value\n"),
    );
    const read = await f.manager.read(f.owner, started.sessionId, {
      waitFor: "[REDACTED_SECRET]",
      timeoutMs: 1000,
    });
    expect(read).toMatchObject({ matched: true, redactionApplied: true });
    expect([...read.lines, read.partial].filter(Boolean)).toEqual([
      "[REDACTED_SECRET]",
    ]);
    expect(JSON.stringify(read)).not.toContain("private-value");
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

it("collects memory from a real owned manager and rejects a different owner", async () => {
  const f = fixture();
  const started = await f.manager.start(f.owner, f.request());
  const ready = f.manager.read(f.owner, started.sessionId, {
    waitFor: "largest: 2000",
    timeoutMs: 1000,
  });
  await f.manager.write(
    f.owner,
    started.sessionId,
    Buffer.from("Free heap: 10000 min: 9000 largest: 2000\n"),
  );
  expect((await ready).matched).toBe(true);
  const result = await captureSessionMemory(
    f.manager,
    f.owner,
    started.sessionId,
    { seconds: 0.05 },
  );
  expect(result).toMatchObject({
    ok: true,
    redactionApplied: true,
    metrics: { free_heap: { last: 10000 } },
    fragmentation: { ratio: 0.2 },
  });
  await expect(
    captureSessionMemory(
      f.manager,
      f.manager.createOwner(),
      started.sessionId,
      { seconds: 0 },
    ),
  ).rejects.toThrow();
  await f.manager.stop(f.owner, started.sessionId);
  expect(
    await captureSessionMemory(f.manager, f.owner, started.sessionId, {
      seconds: 0,
    }),
  ).toMatchObject({ ok: true, state: "stopped" });
});

it("closes one-shot memory sessions after successful analysis and parser failure", async () => {
  const f = fixture();
  const service = {
    sessions: f.manager,
    captureMemory: (
      owner: typeof f.owner,
      id: string,
      input: Parameters<typeof captureSessionMemory>[3],
      signal?: AbortSignal,
    ) => captureSessionMemory(f.manager, owner, id, input, signal),
    startWithDiscovery: async () => {
      const started = await f.manager.start(f.owner, f.request());
      await f.manager.write(
        f.owner,
        started.sessionId,
        Buffer.from("Free heap: 1234\n"),
      );
      return started;
    },
  };
  const result = await captureTransientMemory(service, f.owner, f.request(), {
    seconds: 0.05,
  });
  expect(result).toMatchObject({
    ok: true,
    cleanupPending: false,
    state: "stopped",
    metrics: { free_heap: { last: 1234 } },
  });
  await expect(
    captureTransientMemory(service, f.owner, f.request(), {
      seconds: 0.05,
      pattern: "[",
    }),
  ).rejects.toMatchObject({
    code: "PATTERN_INVALID",
    context: { cleanupPending: false },
  });
  expect(
    f.manager
      .list(f.owner)
      .every(
        (session) => session.state === "stopped" && !session.cleanupPending,
      ),
  ).toBe(true);
  expect([...f.ports.values()].every((port) => !port.isOpen)).toBe(true);
});
it("rejects invalid and already-cancelled memory captures before startup", async () => {
  const f = fixture();
  const startWithDiscovery = vi.fn();
  const service = {
    sessions: f.manager,
    startWithDiscovery,
    captureMemory: vi.fn(),
  };
  await expect(
    captureTransientMemory(service, f.owner, f.request(), { seconds: -1 }),
  ).rejects.toThrow();
  await expect(
    captureTransientMemory(
      service,
      f.owner,
      f.request(),
      {},
      AbortSignal.abort(),
    ),
  ).rejects.toMatchObject({ code: "SERIAL_CANCELLED" });
  expect(startWithDiscovery).not.toHaveBeenCalled();
});

it("runs immutable identity preflight before constructing a serial transport", async () => {
  const f = fixture();
  const beforeStart = vi.fn(async (request: Readonly<SerialSessionRequest>) => {
    expect(request.path).toBe("COM44");
    expect(request.additionalResources).toHaveLength(1);
    expect(Object.isFrozen(request)).toBe(true);
    expect(f.transport).not.toHaveBeenCalled();
    throw new PlatformIOError("Approval needed", "APPROVAL_REQUIRED");
  });
  await expect(
    f.manager.startDiscovered(
      f.owner,
      { projectDir: f.root, path: "com44", baudRate: 115200 },
      {
        list: async () => [
          {
            path: "COM44",
            vendorId: "10c4",
            productId: "ea60",
            serialNumber: "one",
          },
        ],
        resolve: (port) => resolveSerialEndpoint(port, { platform: "win32" }),
        beforeStart,
      },
    ),
  ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  expect(beforeStart).toHaveBeenCalledOnce();
  expect(f.transport).not.toHaveBeenCalled();
  expect(f.manager.list(f.owner)).toEqual([]);
});
it("does not resume startup when its owner stops during preflight", async () => {
  const f = fixture();
  await expect(
    f.manager.startDiscovered(
      f.owner,
      { projectDir: f.root, path: "COM44", baudRate: 115200 },
      {
        list: async () => [{ path: "COM44" }],
        resolve: (port) => resolveSerialEndpoint(port, { platform: "win32" }),
        beforeStart: async () => {
          await f.manager.stopAll(f.owner);
        },
      },
    ),
  ).rejects.toMatchObject({ code: "SERIAL_CLOSED" });
  expect(f.transport).not.toHaveBeenCalled();
});

describe("owned monitor retention for power collection", () => {
  it("rejects foreign sessions and concurrent power borrowers", async () => {
    const f = fixture();
    const started = await f.manager.start(f.owner, f.request());
    expect(() =>
      f.manager.holdForPower(f.manager.createOwner(), started.sessionId),
    ).toThrow(expect.objectContaining({ code: "SERIAL_SESSION_NOT_OWNED" }));
    const hold = f.manager.holdForPower(f.owner, started.sessionId);
    expect(() => f.manager.holdForPower(f.owner, started.sessionId)).toThrow(
      expect.objectContaining({ code: "POWER_DUT_BUSY" }),
    );
    hold.releaseAfterExit();
  });
  it("aborts on monitor stop while retaining endpoint and physical leases until power cleanup", async () => {
    const f = fixture(),
      request = f.request();
    request.additionalResources = [
      { kind: "serial", identity: "usb:" + randomUUID() },
    ];
    const started = await f.manager.start(f.owner, request);
    const hold = f.manager.holdForPower(f.owner, started.sessionId);
    expect(hold.resources).toHaveLength(2);
    await hold.prepareSpawn();
    const stopped = await f.manager.stop(f.owner, started.sessionId);
    expect(hold.signal.aborted).toBe(true);
    expect(stopped.cleanupPending).toBe(true);
    for (const resource of hold.resources)
      expect(() => f.leases.acquire(resource)).toThrow(
        expect.objectContaining({ code: "DEVICE_HANDOFF_PENDING" }),
      );
    hold.releaseAfterExit();
    hold.releaseAfterExit();
    for (const resource of hold.resources) {
      const lease = f.leases.acquire(resource);
      f.leases.release(lease);
    }
    expect(
      (await f.manager.stop(f.owner, started.sessionId)).cleanupPending,
    ).toBe(false);
  });
  it("returns custody to a still-open monitor without closing or releasing its device", async () => {
    const f = fixture(),
      request = f.request();
    const started = await f.manager.start(f.owner, request);
    const hold = f.manager.holdForPower(f.owner, started.sessionId);
    await hold.prepareSpawn();
    hold.releaseAfterExit();
    expect(f.manager.list(f.owner)[0].state).toBe("open");
    expect(() => f.leases.acquire(request.resource)).toThrow(
      expect.objectContaining({ code: "DEVICE_BUSY" }),
    );
    const second = f.manager.holdForPower(f.owner, started.sessionId);
    second.releaseAfterExit();
  });
  it("retains a failed handoff cancellation for retry", async () => {
    const f = fixture(),
      request = f.request();
    const started = await f.manager.start(f.owner, request);
    const hold = f.manager.holdForPower(f.owner, started.sessionId);
    await hold.prepareSpawn();
    await f.manager.stop(f.owner, started.sessionId);
    const cancel = vi
      .spyOn(f.leases, "cancelHandoff")
      .mockImplementationOnce(() => {
        throw new Error("lease update failed");
      });
    expect(() => hold.releaseAfterExit()).toThrow("lease update failed");
    expect(() => f.leases.acquire(request.resource)).toThrow(
      expect.objectContaining({ code: "DEVICE_HANDOFF_PENDING" }),
    );
    hold.releaseAfterExit();
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(f.leases.status(request.resource).status).toBe("unclaimed");
  });
});

it("joins actual monitor custody to meter custody and releases both after stopped-monitor cleanup", async () => {
  const f = fixture(),
    request = f.request();
  request.additionalResources = [
    { kind: "serial", identity: "usb:" + randomUUID() },
  ];
  const started = await f.manager.start(f.owner, request);
  const hold = f.manager.holdForPower(f.owner, started.sessionId);
  const meterResource = {
    kind: "serial" as const,
    identity: "meter:" + randomUUID(),
  };
  const custody = new PowerDeviceCustody(
    { resources: [meterResource], revalidate: async () => {} },
    { resources: hold.resources, revalidate: async () => {} },
    f.leases,
    hold,
  );
  await custody.prepareSpawn();
  await f.manager.stop(f.owner, started.sessionId);
  expect(hold.signal.aborted).toBe(true);
  for (const resource of [meterResource, ...hold.resources])
    expect(() => f.leases.acquire(resource)).toThrow(
      expect.objectContaining({ code: "DEVICE_HANDOFF_PENDING" }),
    );
  custody.releaseAfterExit();
  for (const resource of [meterResource, ...hold.resources])
    expect(f.leases.status(resource).status).toBe("unclaimed");
});

describe("upload to monitor custody", () => {
  it("retains every scope before, during and after upload until monitor closure", async () => {
    const f = fixture();
    const request = {
      ...f.request(),
      additionalResources: [
        { kind: "serial" as const, identity: "usb-upload-device" },
      ],
    };
    const assertHeld = () => {
      for (const resource of [request.resource, ...request.additionalResources])
        expect(() => f.leases.acquire(resource)).toThrow(
          expect.objectContaining({
            code: expect.stringMatching(/^DEVICE_(BUSY|HANDOFF_PENDING)$/),
          }),
        );
    };
    const started = await f.manager.start(
      f.owner,
      request,
      async ({ custody }) => {
        assertHeld();
        expect(f.transport).not.toHaveBeenCalled();
        await custody.prepareSpawn();
        assertHeld();
        custody.releaseAfterExit();
        assertHeld();
        expect(f.transport).not.toHaveBeenCalled();
      },
    );
    assertHeld();
    expect(started.state).toBe("open");
    await f.manager.stop(f.owner, started.sessionId);
    for (const resource of [request.resource, ...request.additionalResources])
      f.leases.release(f.leases.acquire(resource));
  });

  it("does not run an uploader when monitor authorization denies startup", async () => {
    const f = fixture(async () => {
      throw new PlatformIOError("Denied", "POLICY_DENIED");
    });
    const beforeOpen = vi.fn();
    await expect(
      f.manager.start(f.owner, f.request(), beforeOpen),
    ).rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(beforeOpen).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });

  it("keeps an uncertain uploader owned through stop and releases only after later closure proof", async () => {
    const f = fixture();
    const request = f.request();
    let release!: () => void;
    await expect(
      f.manager.start(f.owner, request, async ({ custody }) => {
        await custody.prepareSpawn();
        release = custody.releaseAfterExit;
      }),
    ).rejects.toMatchObject({
      code: "DEVICE_CLEANUP_PENDING",
      context: { cleanupPending: true },
    });
    const [session] = f.manager.list(f.owner);
    expect(f.transport).not.toHaveBeenCalled();
    expect(
      (await f.manager.stop(f.owner, session.sessionId)).cleanupPending,
    ).toBe(true);
    expect(() => f.leases.acquire(request.resource)).toThrow();
    release();
    expect(f.manager.list(f.owner)[0].cleanupPending).toBe(false);
    f.leases.release(f.leases.acquire(request.resource));
  });

  it("signals stop to the uploader without freeing its pending process lease", async () => {
    const f = fixture();
    const request = f.request();
    await expect(
      f.manager.start(
        f.owner,
        request,
        async ({ custody, sessionId, signal }) => {
          await custody.prepareSpawn();
          expect(
            (await f.manager.stop(f.owner, sessionId)).cleanupPending,
          ).toBe(true);
          expect(signal.aborted).toBe(true);
          expect(() => f.leases.acquire(request.resource)).toThrow();
          custody.releaseAfterExit();
        },
      ),
    ).rejects.toMatchObject({
      code: "SERIAL_CLOSED",
      context: { cleanupPending: false },
    });
    expect(f.transport).not.toHaveBeenCalled();
    f.leases.release(f.leases.acquire(request.resource));
  });

  it("retains retryable custody when clearing the uploader handoff fails", async () => {
    const f = fixture();
    const request = f.request();
    let release!: () => void;
    const cancel = vi
      .spyOn(f.leases, "cancelHandoff")
      .mockImplementationOnce(() => {
        throw new Error("lease storage unavailable");
      });
    await expect(
      f.manager.start(f.owner, request, async ({ custody }) => {
        await custody.prepareSpawn();
        release = custody.releaseAfterExit;
        release();
      }),
    ).rejects.toMatchObject({ context: { cleanupPending: true } });
    expect(f.transport).not.toHaveBeenCalled();
    expect(() => f.leases.acquire(request.resource)).toThrow();
    release();
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(f.manager.list(f.owner)[0].cleanupPending).toBe(false);
  });
});
