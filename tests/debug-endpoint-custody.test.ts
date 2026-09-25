/** Local debugger endpoint exclusion survives probe failures and deferred cleanup. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  DebugEndpointCustody,
  createRemoteDebugEndpointCustody,
} from "../src/core/debug/debug-endpoint-custody.js";
import { DeviceLeaseStore } from "../src/core/devices/device-lease.js";
let root: string, store: DeviceLeaseStore;
import { parseRemoteDebugEndpoint } from "../src/core/debug/debug-remote-endpoint.js";
const resource = {
  kind: "network" as const,
  identity: "debug-tcp:127.0.0.1:3333",
};
beforeEach(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pio-debug-port-")),
  );
  store = new DeviceLeaseStore({
    root,
    inspect: () => ({
      status: "running",
      identity: {
        pid: process.pid,
        platform: process.platform,
        startToken: "fixture",
      },
    }),
  });
});
afterEach(async () => fs.rm(root, { recursive: true, force: true }));
const probe = () => ({
  prepareSpawn: vi.fn(async () => {}),
  releaseAfterExit: vi.fn(),
});
it("rejects an existing real listener without acquiring a probe", async () => {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  const acquire = vi.fn(async () => probe());
  const owner = new DebugEndpointCustody(port, acquire, store);
  try {
    await expect(owner.prepareSpawn()).rejects.toMatchObject({
      code: "DEBUG_ENDPOINT_BUSY",
    });
    expect(acquire).not.toHaveBeenCalled();
    owner.releaseAfterExit();
    expect(
      store.status({ kind: "network", identity: `debug-tcp:127.0.0.1:${port}` })
        .status,
    ).toBe("unclaimed");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
it("excludes another probe and retains the endpoint until failed probe cleanup succeeds", async () => {
  const firstProbe = probe();
  firstProbe.releaseAfterExit.mockImplementationOnce(() => {
    throw new Error("probe still held");
  });
  const owner = new DebugEndpointCustody(
    3333,
    async () => firstProbe,
    store,
    async () => {},
  );
  await owner.prepareSpawn();
  const otherAcquire = vi.fn(async () => probe());
  const other = new DebugEndpointCustody(
    3333,
    otherAcquire,
    store,
    async () => {},
  );
  await expect(other.prepareSpawn()).rejects.toMatchObject({
    code: "DEVICE_HANDOFF_PENDING",
  });
  other.releaseAfterExit();
  expect(otherAcquire).not.toHaveBeenCalled();
  expect(() => owner.releaseAfterExit()).toThrow("probe still held");
  expect(store.status(resource).status).toBe("unknown");
  owner.releaseAfterExit();
  owner.releaseAfterExit();
  expect(firstProbe.releaseAfterExit).toHaveBeenCalledTimes(2);
  expect(store.status(resource).status).toBe("unclaimed");
});
it("retains partial endpoint acquisition when probe acquisition fails", async () => {
  const owner = new DebugEndpointCustody(
    3333,
    async () => {
      throw new Error("probe busy");
    },
    store,
    async () => {},
  );
  await expect(owner.prepareSpawn()).rejects.toThrow("probe busy");
  expect(store.status(resource).status).toBe("owned");
  owner.releaseAfterExit();
  expect(store.status(resource).status).toBe("unclaimed");
});
it("rechecks availability after physical probe revalidation and retains cleanup", async () => {
  const held = probe();
  const check = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("listener raced"));
  const owner = new DebugEndpointCustody(3333, async () => held, store, check);
  await expect(owner.prepareSpawn()).rejects.toThrow("listener raced");
  expect(held.prepareSpawn).toHaveBeenCalledOnce();
  owner.releaseAfterExit();
  expect(held.releaseAfterExit).toHaveBeenCalledOnce();
  expect(store.status(resource).status).toBe("unclaimed");
});
it("cannot release a lease while asynchronous preparation still owns it", async () => {
  let finish!: () => void;
  const check = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const owner = new DebugEndpointCustody(
    3333,
    async () => probe(),
    store,
    check,
  );
  const pending = owner.prepareSpawn();
  expect(() => owner.releaseAfterExit()).toThrow("still acquiring custody");
  expect(store.status(resource).status).toBe("owned");
  finish();
  await pending;
  owner.releaseAfterExit();
  expect(store.status(resource).status).toBe("unclaimed");
});

it("excludes equivalent remote endpoints and retains host-bound target cleanup", async () => {
  const firstProbe = probe();
  const first = createRemoteDebugEndpointCustody(
    parseRemoteDebugEndpoint("[2001:db8::1]:3333"),
    async () => firstProbe,
    store,
  );
  await first.prepareSpawn();
  const acquire = vi.fn(async () => probe());
  const second = createRemoteDebugEndpointCustody(
    parseRemoteDebugEndpoint("[2001:0db8:0:0:0:0:0:1]:3333"),
    acquire,
    store,
  );
  await expect(second.prepareSpawn()).rejects.toMatchObject({
    code: "DEVICE_HANDOFF_PENDING",
  });
  second.releaseAfterExit();
  expect(acquire).not.toHaveBeenCalled();
  firstProbe.releaseAfterExit.mockImplementationOnce(() => {
    throw new Error("target still held");
  });
  expect(() => first.releaseAfterExit()).toThrow("target still held");
  expect(
    store.status(parseRemoteDebugEndpoint("[2001:db8::1]:3333").resource)
      .status,
  ).toBe("unknown");
  first.releaseAfterExit();
  expect(
    store.status(parseRemoteDebugEndpoint("[2001:db8::1]:3333").resource)
      .status,
  ).toBe("unclaimed");
});
