/** Reconnect selects one exact USB serial identity and never a model or serial-prefix lookalike. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../src/platformio.js", () => ({
  platformioExecutor: { executeWithJsonOutput: mocks.list },
}));
vi.mock("../src/utils/semaphore.js", () => ({
  portSemaphoreManager: { getClaim: () => null },
}));
import { waitForDeviceByHwid } from "../src/tools/devices.js";
const hwid = "USB VID:PID=303A:1001 SER=ABC LOCATION=old";
const device = (port: string, identity = hwid) => ({
  port,
  hwid: identity,
  description: "fixture",
});
beforeEach(() => {
  mocks.list.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it("follows a unique exact serial across location and port changes", async () => {
  mocks.list.mockResolvedValue([
    device("COM8", "USB VID:PID=303a:1001 SER=ABC LOCATION=new"),
  ]);
  expect(await waitForDeviceByHwid(hwid, 1)).toBe("COM8");
});
it("rejects serial-prefix lookalikes", async () => {
  mocks.list.mockResolvedValue([
    device("COM8", "USB VID:PID=303A:1001 SER=ABCDE"),
  ]);
  expect(await waitForDeviceByHwid(hwid, 1)).toBeNull();
});
it("rejects duplicate USB serial identities", async () => {
  mocks.list.mockResolvedValue([device("COM8"), device("COM9")]);
  expect(await waitForDeviceByHwid(hwid, 1)).toBeNull();
});
it.each(["", "n/a", "USB VID:PID=303A:1001", "USB VID:PID=303A:1001 SER="])(
  "does not enumerate for insufficient identity %j",
  async (identity) => {
    expect(await waitForDeviceByHwid(identity, 1)).toBeNull();
    expect(mocks.list).not.toHaveBeenCalled();
  },
);
it("keeps differing models separate even with identical serial strings", async () => {
  mocks.list.mockResolvedValue([
    device("COM8", "USB VID:PID=303A:9999 SER=ABC"),
  ]);
  expect(await waitForDeviceByHwid(hwid, 1)).toBeNull();
});
