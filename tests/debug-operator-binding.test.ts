/** Standalone remote mappings bind exact projects and preserve exclusion across endpoint aliases. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { resolveOperatorRemoteDebugBinding } from "../src/core/debug/debug-operator-binding.js";
import { DeviceLeaseStore } from "../src/core/devices/device-lease.js";
let root: string, project: string, filename: string, store: DeviceLeaseStore;
function document() {
  return {
    version: 1,
    bindings: [
      {
        projectDir: project,
        environment: "debug",
        endpoint: "127.0.0.1:3333",
        targetId: "lab-host/board-a",
      },
      {
        projectDir: project,
        environment: "debug",
        endpoint: "192.0.2.1:3333",
        targetId: "lab-host/board-a",
      },
    ],
  };
}
function resolve(endpoint = "localhost:3333") {
  return resolveOperatorRemoteDebugBinding(
    { projectDir: project, environment: "debug", endpoint },
    { filename, store },
  );
}
beforeEach(() => {
  root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "pio-operator-debug-")),
  );
  project = path.join(root, "project");
  fs.mkdirSync(project);
  filename = path.join(root, "debug-targets.json");
  fs.writeFileSync(filename, JSON.stringify(document()));
  store = new DeviceLeaseStore({
    root: path.join(root, "leases"),
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
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
it("excludes a second endpoint to the same target until owned cleanup completes", async () => {
  const first = await resolve();
  const second = await resolve("192.0.2.1:3333");
  const held = await first.acquireTarget();
  await held.prepareSpawn();
  await expect(second.acquireTarget()).rejects.toThrow();
  held.releaseAfterExit();
  const next = await second.acquireTarget();
  await next.prepareSpawn();
  next.releaseAfterExit();
});
it("rejects changed mappings before acquisition and before handoff", async () => {
  const binding = await resolve();
  const held = await binding.acquireTarget();
  const changed = document();
  changed.bindings[0].targetId = "different-board";
  fs.writeFileSync(filename, JSON.stringify(changed));
  await expect(binding.acquireTarget()).rejects.toMatchObject({
    code: "DEBUG_REMOTE_BINDING_CHANGED",
  });
  expect(() => held.prepareSpawn()).toThrow();
  held.releaseAfterExit();
});
it("requires a unique matching environment and endpoint", async () => {
  await expect(resolve("192.0.2.2:3333")).rejects.toMatchObject({
    code: "DEBUG_REMOTE_BINDING_REQUIRED",
  });
  const duplicate = document();
  duplicate.bindings.push({ ...duplicate.bindings[0] });
  fs.writeFileSync(filename, JSON.stringify(duplicate));
  await expect(resolve()).rejects.toMatchObject({
    code: "DEBUG_REMOTE_BINDING_REQUIRED",
  });
});
it("rejects project-owned maps, duplicate keys, unknown fields and oversize input", async () => {
  const external = filename;
  filename = path.join(project, "debug-targets.json");
  fs.writeFileSync(filename, JSON.stringify(document()));
  await expect(resolve()).rejects.toMatchObject({
    code: "DEBUG_REMOTE_BINDING_INVALID",
  });
  filename = external;
  for (const content of [
    '{"version":1,"version":1,"bindings":[]}',
    JSON.stringify({ ...document(), allow: true }),
    " ".repeat(65537),
  ]) {
    fs.writeFileSync(filename, content);
    await expect(resolve()).rejects.toMatchObject({
      code: "DEBUG_REMOTE_BINDING_INVALID",
    });
  }
});
