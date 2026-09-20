/** Physical lease contention, stale recovery and release authority without opening hardware. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
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
  }, 25000);
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
  it("keeps the original lease when transfer validation fails", () => {
    const store = new DeviceLeaseStore({
      root: directory(),
      inspect: (pid) =>
        pid === process.pid ? running() : { status: "unknown" },
    });
    const lease = store.acquire(resource);
    const target = {
      pid: process.pid === 42 ? 43 : 42,
      platform: process.platform,
      startToken: "child",
    };
    expect(() => store.transfer(lease, target)).toThrow(
      expect.objectContaining({ code: "DEVICE_TRANSFER_INVALID" }),
    );
    expect(() => store.transfer({ ...lease }, target)).toThrow(
      expect.objectContaining({ code: "DEVICE_LEASE_NOT_OWNED" }),
    );
    expect(() =>
      store.transfer(lease, { ...target, pid: process.pid }),
    ).toThrow();
    expect(() => store.transfer(lease, { ...target, pid: -1 })).toThrow();
    store.release(lease);
  });
  it("rejects a reused transfer target PID before changing the record", () => {
    const targetPid = process.pid === 42 ? 43 : 42;
    const store = new DeviceLeaseStore({
      root: directory(),
      inspect: (pid) =>
        pid === process.pid
          ? running()
          : {
              status: "running",
              identity: {
                pid,
                platform: process.platform,
                startToken: "replacement",
              },
            },
    });
    const lease = store.acquire(resource);
    expect(() =>
      store.transfer(lease, {
        pid: targetPid,
        platform: process.platform,
        startToken: "original",
      }),
    ).toThrow(expect.objectContaining({ code: "DEVICE_TRANSFER_INVALID" }));
    store.release(lease);
  });
  it("hands a lease to a real waiting child, invalidates the parent handle and consumes its ticket once", async () => {
    const root = directory();
    const childCwd = directory();
    const script = path.join(childCwd, "adopter.mjs");
    const storeUrl = pathToFileURL(
      path.resolve("src/core/devices/device-lease.ts"),
    ).href;
    const identityUrl = pathToFileURL(
      path.resolve("src/core/devices/process-identity.ts"),
    ).href;
    fs.writeFileSync(
      script,
      `
      import {DeviceLeaseStore} from ${JSON.stringify(storeUrl)};
      import {inspectProcessIdentity} from ${JSON.stringify(identityUrl)};
      const store = new DeviceLeaseStore({root:process.argv[2]});
      process.once('message', ticket => {
        try {
          const lease = store.adopt(ticket);
          let replayRejected = false;
          try { store.adopt(ticket); } catch (error) { replayRejected = error.code === 'DEVICE_TRANSFER_INVALID'; }
          process.send({type:'adopted', replayRejected});
          process.once('message', () => {
            store.release(lease);
            process.send({type:'released'}, () => process.disconnect());
          });
        } catch(error) { process.send({type:'failure', code:error.code}); process.disconnect(); }
      });
      process.send({type:'ready', observation:inspectProcessIdentity(process.pid)});
    `,
    );
    const store = new DeviceLeaseStore({ root });
    const lease = store.acquire(resource);
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
          PIO_MCP_DATA_DIR: path.join(childCwd, "another-data-root"),
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        windowsHide: true,
      },
    );
    const exited = once(child, "exit");
    const nextMessage = () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(
          () => finish(new Error("handoff message timed out")),
          10000,
        );
        const onError = (error: Error) => finish(error);
        const onExit = () =>
          finish(new Error("child exited before handoff message"));
        const onMessage = (message: Record<string, unknown>) =>
          finish(undefined, message);
        const finish = (error?: Error, message?: Record<string, unknown>) => {
          clearTimeout(timeout);
          child.off("error", onError);
          child.off("exit", onExit);
          child.off("message", onMessage);
          error ? reject(error) : resolve(message!);
        };
        child.once("error", onError);
        child.once("exit", onExit);
        child.once("message", onMessage);
      });
    try {
      const ready = await nextMessage();
      expect(ready.type).toBe("ready");
      const observation = ready.observation as ProcessObservation;
      expect(observation.status).toBe("running");
      if (observation.status !== "running")
        throw new Error("child identity missing");
      const ticket = store.transfer(lease, observation.identity);
      expect(() => store.release(lease)).toThrow(
        expect.objectContaining({ code: "DEVICE_LEASE_NOT_OWNED" }),
      );
      expect(() => store.adopt(ticket)).toThrow(
        expect.objectContaining({ code: "DEVICE_TRANSFER_INVALID" }),
      );
      const adopted = nextMessage();
      child.send(ticket);
      expect(await adopted).toMatchObject({
        type: "adopted",
        replayRejected: true,
      });
      expect(() => store.acquire(resource)).toThrow(
        expect.objectContaining({ code: "DEVICE_BUSY" }),
      );
      const released = nextMessage();
      child.send({ release: true });
      expect(await released).toMatchObject({ type: "released" });
      await exited;
      const next = store.acquire(resource);
      store.release(next);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited;
    }
  }, 20000);
  it("retains child ownership after the coordinator exits", async () => {
    const root = directory();
    const fixture = directory();
    const stopFile = path.join(fixture, "stop");
    const holderScript = path.join(fixture, "orphan-holder.mjs");
    const coordinatorScript = path.join(fixture, "coordinator.mjs");
    const loader = pathToFileURL(
      path.resolve("node_modules/tsx/dist/loader.mjs"),
    ).href;
    const storeUrl = pathToFileURL(
      path.resolve("src/core/devices/device-lease.ts"),
    ).href;
    const identityUrl = pathToFileURL(
      path.resolve("src/core/devices/process-identity.ts"),
    ).href;
    fs.writeFileSync(
      holderScript,
      `
      import fs from 'node:fs';
      import {DeviceLeaseStore} from ${JSON.stringify(storeUrl)};
      import {inspectProcessIdentity} from ${JSON.stringify(identityUrl)};
      const store = new DeviceLeaseStore({root:process.argv[2]});
      let lease;
      const expires = Date.now()+20000;
      const timer = setInterval(()=> {
        if (fs.existsSync(process.argv[3]) || Date.now()>expires) {
          if (lease) store.release(lease);
          clearInterval(timer); process.exit(0);
        }
      }, 25);
      process.once('message', ticket=> {
        lease=store.adopt(ticket);
        process.send({type:'adopted'});
      });
      process.send({type:'ready', observation:inspectProcessIdentity(process.pid)});
    `,
    );
    fs.writeFileSync(
      coordinatorScript,
      `
      import {spawn} from 'node:child_process';
      import {DeviceLeaseStore} from ${JSON.stringify(storeUrl)};
      const store=new DeviceLeaseStore({root:process.argv[2]});
      const lease=store.acquire(${JSON.stringify(resource)});
      const child=spawn(process.execPath,['--import',${JSON.stringify(loader)},${JSON.stringify(holderScript)},process.argv[2],process.argv[3]], {
        detached:true, stdio:['ignore','ignore','ignore','ipc'], windowsHide:true,
      });
      const timeout=setTimeout(()=>process.exit(2),10000);
      child.once('message', message=> {
        const identity=message.observation.identity;
        const ticket=store.transfer(lease,identity);
        child.once('message',()=> {
          clearTimeout(timeout);
          process.stdout.write(JSON.stringify(identity)+'\\n',()=>process.exit(0));
        });
        child.send(ticket);
      });
    `,
    );
    const coordinator = spawn(
      process.execPath,
      ["--import", loader, coordinatorScript, root, stopFile],
      {
        cwd: fixture,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const coordinatorExited = once(coordinator, "exit");
    let output = "";
    coordinator.stdout!.on("data", (data: Buffer) => {
      output += data.toString();
    });
    let holder:
      | { pid: number; platform: NodeJS.Platform; startToken: string }
      | undefined;
    try {
      const [code] = await coordinatorExited;
      expect(code).toBe(0);
      holder = JSON.parse(output.trim());
      const observation = inspectProcessIdentity(holder!.pid);
      expect(observation).toEqual({ status: "running", identity: holder });
      const competitor = new DeviceLeaseStore({ root });
      expect(() => competitor.acquire(resource)).toThrow(
        expect.objectContaining({ code: "DEVICE_BUSY" }),
      );
      fs.writeFileSync(stopFile, "stop");
      const deadline = Date.now() + 10000;
      while (
        Date.now() < deadline &&
        fs.readdirSync(root).some((name) => name.endsWith(".json"))
      )
        await new Promise((resolve) => setTimeout(resolve, 25));
      const next = competitor.acquire(resource);
      competitor.release(next);
    } finally {
      fs.writeFileSync(stopFile, "stop");
      if (coordinator.exitCode === null && coordinator.signalCode === null)
        coordinator.kill();
      await coordinatorExited;
      if (holder) {
        const deadline = Date.now() + 5000;
        while (
          Date.now() < deadline &&
          inspectProcessIdentity(holder.pid).status !== "absent"
        )
          await new Promise((resolve) => setTimeout(resolve, 25));
        expect(inspectProcessIdentity(holder.pid).status).toBe("absent");
      }
    }
  }, 30000);
});

it("reports lease ownership without exposing capabilities or recovering stale records", () => {
  const root = directory();
  let observation = running();
  const store = new DeviceLeaseStore({ root, inspect: () => observation });
  expect(store.status(resource)).toEqual({ status: "unclaimed", resource });
  const lease = store.acquire(resource);
  const recordFile = fs
    .readdirSync(root)
    .find((file) => file.endsWith(".json"))!;
  const original = fs.readFileSync(path.join(root, recordFile), "utf8");
  const state = store.status(resource);
  expect(state).toMatchObject({ status: "owned", ownerPid: process.pid });
  expect(Object.keys(state).sort()).toEqual([
    "acquiredAt",
    "ownerPid",
    "resource",
    "status",
  ]);
  expect(() => store.acquire(resource)).toThrow(
    expect.objectContaining({ code: "DEVICE_BUSY" }),
  );
  observation = { status: "unknown" };
  expect(store.status(resource).status).toBe("unknown");
  observation = { status: "absent" };
  expect(store.status(resource).status).toBe("stale");
  expect(fs.readFileSync(path.join(root, recordFile), "utf8")).toBe(original);
  observation = running();
  store.release(lease);
  expect(store.status(resource).status).toBe("unclaimed");
});

it("pins unresolved child handoff even when the coordinator is proven stale", () => {
  const root = directory();
  const original = new DeviceLeaseStore({ root, inspect: () => running() });
  const lease = original.acquire(resource);
  original.beginHandoff(lease);
  expect(() => original.release(lease)).toThrow(
    expect.objectContaining({ code: "DEVICE_HANDOFF_PENDING" }),
  );
  const replacement = new DeviceLeaseStore({
    root,
    inspect: () => running("replacement"),
  });
  expect(replacement.status(resource).status).toBe("unknown");
  expect(() => replacement.acquire(resource)).toThrow(
    expect.objectContaining({ code: "DEVICE_HANDOFF_PENDING" }),
  );
  expect(() => replacement.cancelHandoff({ ...lease })).toThrow(
    expect.objectContaining({ code: "DEVICE_LEASE_NOT_OWNED" }),
  );
  original.cancelHandoff(lease);
  original.release(lease);
});
it("clears the pending marker only when transfer records a verified child owner", () => {
  const root = directory();
  const child = {
    pid: process.pid + 1,
    platform: process.platform,
    startToken: "child",
  };
  const store = new DeviceLeaseStore({
    root,
    inspect: (pid) =>
      pid === child.pid ? { status: "running", identity: child } : running(),
  });
  const lease = store.acquire(resource);
  store.beginHandoff(lease);
  store.transfer(lease, child);
  expect(store.status(resource)).toMatchObject({
    status: "owned",
    ownerPid: child.pid,
  });
  expect(() => store.cancelHandoff(lease)).toThrow(
    expect.objectContaining({ code: "DEVICE_LEASE_NOT_OWNED" }),
  );
});

it("retains unresolved custody after the real coordinator process exits", () => {
  const root = directory();
  const script = path.join(directory(), "handoff-crash.mjs");
  const moduleUrl = pathToFileURL(
    path.resolve("src/core/devices/device-lease.ts"),
  ).href;
  fs.writeFileSync(
    script,
    `import {DeviceLeaseStore} from ${JSON.stringify(moduleUrl)};
    const store = new DeviceLeaseStore({root: process.argv[2]});
    const lease = store.acquire(${JSON.stringify(resource)});
    store.beginHandoff(lease);
    process.exit(0);`,
  );
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href,
      script,
      root,
    ],
    { encoding: "utf8", timeout: 15000, windowsHide: true },
  );
  expect(child.error).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  const store = new DeviceLeaseStore({ root });
  expect(store.status(resource).status).toBe("unknown");
  expect(() => store.acquire(resource)).toThrow(
    expect.objectContaining({ code: "DEVICE_HANDOFF_PENDING" }),
  );
}, 20000);

it("retires only an issued, unadopted transfer whose exact child is gone", () => {
  const root = directory();
  const child = {
    pid: process.pid + 1,
    platform: process.platform,
    startToken: "child",
  };
  let observation: ProcessObservation = { status: "running", identity: child };
  const store = new DeviceLeaseStore({
    root,
    inspect: (pid) => (pid === child.pid ? observation : running()),
  });
  const lease = store.acquire(resource);
  store.beginHandoff(lease);
  const ticket = store.transfer(lease, child);
  expect(() => store.finishTransfer({ ...ticket })).toThrow(
    expect.objectContaining({ code: "DEVICE_TRANSFER_INVALID" }),
  );
  expect(() => store.finishTransfer(ticket)).toThrow(
    expect.objectContaining({ code: "DEVICE_OWNER_UNKNOWN" }),
  );
  observation = { status: "unknown" };
  expect(() => store.finishTransfer(ticket)).toThrow(
    expect.objectContaining({ code: "DEVICE_OWNER_UNKNOWN" }),
  );
  observation = { status: "absent" };
  store.finishTransfer(ticket);
  expect(store.status(resource).status).toBe("unclaimed");
  expect(() => store.finishTransfer(ticket)).toThrow(
    expect.objectContaining({ code: "DEVICE_TRANSFER_INVALID" }),
  );
});
it("cannot retire a transferred resource that has since been reacquired", () => {
  const root = directory();
  const child = {
    pid: process.pid + 1,
    platform: process.platform,
    startToken: "child",
  };
  let alive = true;
  const store = new DeviceLeaseStore({
    root,
    inspect: (pid) =>
      pid === child.pid
        ? alive
          ? { status: "running", identity: child }
          : { status: "absent" }
        : running(),
  });
  const ticket = store.transfer(store.acquire(resource), child);
  alive = false;
  const replacement = store.acquire(resource);
  expect(() => store.finishTransfer(ticket)).toThrow(
    expect.objectContaining({ code: "DEVICE_LEASE_NOT_OWNED" }),
  );
  expect(store.status(resource).status).toBe("owned");
  store.release(replacement);
});
