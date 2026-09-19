/** Physical lease contention, stale recovery and release authority without opening hardware. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  DeviceLeaseStore,
  stableDeviceLeaseRoot,
} from "../src/core/devices/device-lease.js";
import {
  inspectProcessIdentity,
  compareProcessIdentity,
  linuxStartToken,
  type ProcessObservation,
} from "../src/core/devices/process-identity.js";

const directories: string[] = [];
const directory = () => {
  const dir = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "pio-lease-"),
  );
  directories.push(dir);
  return dir;
};
const resource = {
  kind: "serial" as const,
  identity: "fixture:usb:serial:interface0",
};
const running = (startToken = "first"): ProcessObservation => ({
  status: "running",
  identity: { pid: process.pid, platform: process.platform, startToken },
});
afterEach(() => {
  for (const dir of directories.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("process ownership identity", () => {
  it("parses Linux names containing parentheses and includes boot identity", () => {
    const suffix = [
      "S",
      ...Array.from({ length: 18 }, () => "0"),
      "123456",
      "0",
    ].join(" ");
    const boot = "aabbccdd-1234-5678-aaaa-0123456789ab";
    expect(
      linuxStartToken(`123 (name ) with spaces) ${suffix}`, boot, 123),
    ).toBe(`${boot}:123456`);
    expect(() => linuxStartToken(`124 (name) ${suffix}`, boot, 123)).toThrow();
    expect(() => linuxStartToken("123 (bad) S 0", boot, 123)).toThrow();
  });
  it("never mistakes an observation error or a different PID domain for stale ownership", () => {
    const observation = running();
    if (observation.status !== "running") throw new Error("fixture");
    expect(
      compareProcessIdentity(observation.identity, { status: "unknown" }),
    ).toBe("unknown");
    expect(
      compareProcessIdentity(observation.identity, { status: "absent" }),
    ).toBe("stale");
    expect(
      compareProcessIdentity(observation.identity, running("second")),
    ).toBe("stale");
    expect(compareProcessIdentity(observation.identity, observation)).toBe(
      "alive",
    );
    expect(
      compareProcessIdentity(observation.identity, {
        status: "running",
        identity: { ...observation.identity, pid: process.pid + 1 },
      }),
    ).toBe("unknown");
    expect(() => inspectProcessIdentity(-1)).toThrow();
  });
  it("reads stable start metadata for the actual current host process", () => {
    const first = inspectProcessIdentity(process.pid);
    expect(first.status).toBe("running");
    expect(inspectProcessIdentity(process.pid)).toEqual(first);
  }, 10000);
});

describe("physical device lease store", () => {
  it("uses the account home independently of data/cache environment overrides", () => {
    const previous = process.env.PIO_MCP_DATA_DIR;
    try {
      process.env.PIO_MCP_DATA_DIR = directory();
      expect(stableDeviceLeaseRoot()).toBe(
        path.join(os.userInfo().homedir, ".platformio-mcp", "device-leases-v1"),
      );
    } finally {
      if (previous === undefined) delete process.env.PIO_MCP_DATA_DIR;
      else process.env.PIO_MCP_DATA_DIR = previous;
    }
  });
  it("prevents two stores from owning one resource and requires the original release capability", () => {
    const root = directory();
    const first = new DeviceLeaseStore({ root, inspect: () => running() });
    const second = new DeviceLeaseStore({ root, inspect: () => running() });
    const lease = first.acquire(resource);
    expect(() => second.acquire(resource)).toThrow(
      expect.objectContaining({ code: "DEVICE_BUSY" }),
    );
    expect(() => first.release({ ...lease })).toThrow(
      expect.objectContaining({ code: "DEVICE_LEASE_NOT_OWNED" }),
    );
    expect(() => second.release(lease)).toThrow();
    first.release(lease);
    expect(() => first.release(lease)).toThrow();
    const next = second.acquire(resource);
    second.release(next);
    expect(fs.readdirSync(root)).toEqual([]);
  });
  it("allows independent resources but distinguishes probes from serial interfaces", () => {
    const store = new DeviceLeaseStore({
      root: directory(),
      inspect: () => running(),
    });
    const serial = store.acquire(resource);
    const probe = store.acquire({ ...resource, kind: "probe" });
    store.release(serial);
    store.release(probe);
  });
  it("recovers reused PID identity and stops the previous capability from deleting the new lease", () => {
    const root = directory();
    const oldStore = new DeviceLeaseStore({ root, inspect: () => running() });
    const oldLease = oldStore.acquire(resource);
    const newStore = new DeviceLeaseStore({
      root,
      inspect: () => running("second"),
    });
    const newLease = newStore.acquire(resource);
    expect(() => oldStore.release(oldLease)).toThrow(
      expect.objectContaining({ code: "DEVICE_LEASE_NOT_OWNED" }),
    );
    expect(() => newStore.acquire(resource)).toThrow(
      expect.objectContaining({ code: "DEVICE_BUSY" }),
    );
    newStore.release(newLease);
  });
  it("does not recover unknown ownership or corrupt records", () => {
    const root = directory();
    new DeviceLeaseStore({ root, inspect: () => running() }).acquire(resource);
    let calls = 0;
    const second = new DeviceLeaseStore({
      root,
      inspect: () => (++calls === 1 ? running() : { status: "unknown" }),
    });
    expect(() => second.acquire(resource)).toThrow(
      expect.objectContaining({ code: "DEVICE_OWNER_UNKNOWN" }),
    );
    const record = path.join(
      root,
      fs.readdirSync(root).find((name) => name.endsWith(".json"))!,
    );
    fs.writeFileSync(record, "not json");
    expect(() => second.acquire(resource)).toThrow(
      expect.objectContaining({ code: "DEVICE_LEASE_CORRUPT" }),
    );
    expect(fs.readFileSync(record, "utf8")).toBe("not json");
  });
  it("fails closed for an interrupted update gate and never removes it by age", () => {
    const root = directory();
    const store = new DeviceLeaseStore({ root, inspect: () => running() });
    const lease = store.acquire(resource);
    const record = fs.readdirSync(root).find((name) => name.endsWith(".json"))!;
    const gate = path.join(root, record.replace(/\.json$/, ".gate"));
    fs.mkdirSync(gate);
    fs.utimesSync(gate, new Date(0), new Date(0));
    expect(() => store.release(lease)).toThrow(
      expect.objectContaining({ code: "DEVICE_LEASE_GATE_BUSY" }),
    );
    expect(fs.existsSync(gate)).toBe(true);
    fs.rmdirSync(gate);
    store.release(lease);
  });
  it("rejects symlinked lock roots, malformed identities and unavailable self identity", () => {
    const parent = directory();
    const target = directory();
    const link = path.join(parent, "linked");
    fs.symlinkSync(
      target,
      link,
      process.platform === "win32" ? "junction" : "dir",
    );
    const store = new DeviceLeaseStore({
      root: link,
      inspect: () => running(),
    });
    expect(() => store.acquire(resource)).toThrow(
      expect.objectContaining({ code: "DEVICE_LEASE_PATH_INVALID" }),
    );
    expect(() => store.acquire({ kind: "serial", identity: "\n" })).toThrow();
    expect(() =>
      new DeviceLeaseStore({
        root: parent,
        inspect: () => ({ status: "unknown" }),
      }).acquire(resource),
    ).toThrow();
  });
  it("coordinates real separate processes and recovers a lease only after its owner exits", async () => {
    const root = directory();
    const childCwd = directory();
    const script = path.join(childCwd, "holder.mjs");
    const moduleUrl = pathToFileURL(
      path.resolve("src/core/devices/device-lease.ts"),
    ).href;
    fs.writeFileSync(
      script,
      `import {DeviceLeaseStore} from ${JSON.stringify(moduleUrl)};
const store = new DeviceLeaseStore({root:process.argv[2]});
store.acquire(${JSON.stringify(resource)});
console.log('held');
setInterval(()=>{},1000);
`,
    );
    const child = spawn(
      process.execPath,
      [
        "--import",
        pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href,
        script,
        root,
      ],
      {
        cwd: childCwd,
        env: {
          ...process.env,
          PIO_MCP_DATA_DIR: path.join(childCwd, "different-data"),
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const exited = once(child, "exit");
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("holder startup timed out")),
          10000,
        );
        const finish = (error?: Error) => {
          clearTimeout(timeout);
          error ? reject(error) : resolve();
        };
        child.once("error", finish);
        child.once("exit", () =>
          finish(new Error("holder exited before ready")),
        );
        child.stdout!.once("data", (data: Buffer) =>
          data.toString().includes("held")
            ? finish()
            : finish(new Error("unexpected holder output")),
        );
      });
      const store = new DeviceLeaseStore({ root });
      expect(() => store.acquire(resource)).toThrow(
        expect.objectContaining({ code: "DEVICE_BUSY" }),
      );
      child.kill();
      await exited;
      const recovered = store.acquire(resource);
      store.release(recovered);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
    }
  }, 20000);
});
