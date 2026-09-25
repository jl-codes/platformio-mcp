/** Shutdown coordination never exits one subsystem ahead of another's owned-device cleanup. */
import { expect, it, vi } from "vitest";
import { ShutdownCoordinator } from "../src/utils/shutdown-coordinator.js";
it("waits for every subsystem and coalesces repeated signals", async () => {
  const coordinator = new ShutdownCoordinator();
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const serial = vi.fn(() => pending);
  coordinator.register(serial);
  coordinator.register(async () => {});
  const first = coordinator.close();
  expect(coordinator.close()).toBe(first);
  let closed = false;
  void first.then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  finish();
  expect(await first).toBe(0);
  expect(serial).toHaveBeenCalledTimes(1);
});
it("reports failed cleanup while still cleaning other subsystems", async () => {
  const coordinator = new ShutdownCoordinator();
  const other = vi.fn(async () => {});
  coordinator.register(async () => {
    throw new Error("closure unconfirmed");
  });
  coordinator.register(other);
  expect(await coordinator.close()).toBe(1);
  expect(other).toHaveBeenCalledOnce();
});
it("does not revisit explicitly closed subsystems", async () => {
  const coordinator = new ShutdownCoordinator();
  const cleanup = vi.fn(async () => {});
  coordinator.register(cleanup)();
  expect(await coordinator.close()).toBe(0);
  expect(cleanup).not.toHaveBeenCalled();
});


it("finishes registered cleanup after actual client stdin disconnect", async () => {
  const { spawn } = await import("node:child_process");
  const moduleUrl = new URL("../src/utils/shutdown-coordinator.ts", import.meta.url).href;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
    import { registerShutdownTask, requestProcessShutdown } from ${JSON.stringify(moduleUrl)};
    process.stdin.once("end", requestProcessShutdown);
    const keepAlive = setInterval(() => {}, 1000);
    registerShutdownTask(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      clearInterval(keepAlive);
      process.stdout.write("cleaned");
    });
    process.stdin.resume();
    process.stdout.write("ready");
  `], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  let stderr = "";
  child.stderr.on("data", data => { stderr += data; });
  child.stdout.on("data", data => {
    output += data;
    if (output.includes("ready")) child.stdin.end();
  });
  const deadline = setTimeout(() => child.kill(), 5000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(output).toBe("readycleaned");
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null) child.kill();
  }
}, 10000);
