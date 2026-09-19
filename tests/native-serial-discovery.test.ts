/** Native enumeration boundary tests with injected providers; no device enumeration occurs. */
import { describe, expect, it, vi } from "vitest";
import { NativeSerialDiscovery } from "../src/core/devices/native-serial-discovery.js";
import { PlatformIOError } from "../src/utils/errors.js";
const allow = async () => () => {};
describe("native serial discovery", () => {
  it("returns frozen identity fields and discards unrelated OS metadata", async () => {
    const provider = new NativeSerialDiscovery({
      authorize: allow,
      load: async () => ({
        list: async () => [
          {
            path: "COM4",
            manufacturer: "untrusted text",
            vendorId: "10c4",
            productId: "ea60",
          },
        ],
      }),
    });
    const result = await provider.list();
    expect(result).toEqual([
      { path: "COM4", vendorId: "10c4", productId: "ea60" },
    ]);
    expect(Object.isFrozen(result[0])).toBe(true);
  });
  it("does not load native code when authorization denies", async () => {
    const load = vi.fn();
    const provider = new NativeSerialDiscovery({
      load,
      authorize: async () => {
        throw new PlatformIOError("Denied", "POLICY_DENIED");
      },
    });
    await expect(provider.list()).rejects.toMatchObject({
      code: "POLICY_DENIED",
    });
    expect(load).not.toHaveBeenCalled();
  });
  it("rechecks authorization after asynchronous backend loading", async () => {
    let revoked = false;
    const list = vi.fn();
    const provider = new NativeSerialDiscovery({
      authorize: async () => () => {
        if (revoked) throw new PlatformIOError("Changed", "POLICY_CHANGED");
      },
      load: async () => {
        revoked = true;
        return { list };
      },
    });
    await expect(provider.list()).rejects.toMatchObject({
      code: "POLICY_CHANGED",
    });
    expect(list).not.toHaveBeenCalled();
  });
  it("keeps timed-out native work single-flight until it actually settles", async () => {
    let finish!: (value: unknown) => void;
    const list = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          finish = resolve;
        }),
    );
    const provider = new NativeSerialDiscovery({
      authorize: allow,
      timeoutMs: 10,
      load: async () => ({ list }),
    });
    await expect(provider.list()).rejects.toMatchObject({
      code: "SERIAL_DISCOVERY_TIMEOUT",
    });
    await expect(provider.list()).rejects.toMatchObject({
      code: "SERIAL_DISCOVERY_BUSY",
    });
    expect(list).toHaveBeenCalledTimes(1);
    finish([]);
    await Promise.resolve();
    list.mockResolvedValue([]);
    await expect(provider.list()).resolves.toEqual([]);
  });
  it("rejects malformed or oversized results and preserves failure versus absence", async () => {
    for (const raw of [
      [{ path: "COM4", vendorId: "wrong" }],
      Array(1025).fill({ path: "COM4" }),
      null,
    ]) {
      const provider = new NativeSerialDiscovery({
        authorize: allow,
        load: async () => ({ list: async () => raw }),
      });
      await expect(provider.list()).rejects.toMatchObject({
        code: "SERIAL_DISCOVERY_INVALID",
      });
    }
    const provider = new NativeSerialDiscovery({
      authorize: allow,
      load: async () => ({
        list: async () => {
          throw new Error("OS error");
        },
      }),
    });
    await expect(provider.list()).rejects.toMatchObject({
      code: "SERIAL_DISCOVERY_FAILED",
    });
  });
});
