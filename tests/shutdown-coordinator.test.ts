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
