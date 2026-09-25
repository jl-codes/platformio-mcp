/** J-Link bindings select a physical serial without retaining conflicting network or probe selectors. */
import path from "node:path";
import { expect, it } from "vitest";
import { bindJLinkProbe } from "../src/core/debug/debug-jlink-binding.js";
const probe = {
  vendorId: "1366",
  productId: "0105",
  serialNumber: "580011111",
  location: "usb:1",
};
const command = {
  executable: path.resolve("JLinkGDBServerCL.exe"),
  cwd: path.resolve("."),
  arguments: [
    "-device",
    "STM32F407VG",
    "-if",
    "SWD",
    "-select",
    "USB",
    "-port",
    "2331",
  ],
};
it("preserves target settings and emits a single explicit serial and loopback endpoint", () => {
  const result = bindJLinkProbe(command, probe, 3333);
  expect(result.arguments).toEqual([
    "-device",
    "STM32F407VG",
    "-if",
    "SWD",
    "-select",
    "USB=580011111",
    "-port",
    "3333",
    "-LocalhostOnly",
    "1",
  ]);
  expect(command.arguments).toContain("2331");
});
it.each([
  ["-USB", "other"],
  ["-select", "IP=remote"],
  ["-IP", "remote"],
  ["-LocalhostOnly", "0"],
  ["-nolocalhostonly"],
  ["-USB=other"],
  ["-port"],
])("rejects conflicting or malformed options %j", (...args) => {
  expect(() =>
    bindJLinkProbe({ ...command, arguments: args }, probe, 3333),
  ).toThrow();
});
it("accepts the selected serial and an existing implicit localhost restriction", () => {
  expect(
    bindJLinkProbe(
      { ...command, arguments: ["-USB", probe.serialNumber, "-LocalhostOnly"] },
      probe,
      3333,
    ).arguments,
  ).toEqual([
    "-USB",
    probe.serialNumber,
    "-port",
    "3333",
    "-LocalhostOnly",
    "1",
  ]);
});
it.each(["0", "3", "nickname", "58001;bad"])(
  "rejects an ambiguous or nonnumeric serial %s",
  (serialNumber) => {
    expect(() =>
      bindJLinkProbe(command, { ...probe, serialNumber }, 3333),
    ).toThrow();
  },
);

it("accepts legacy lowercase USB syntax while keeping explicit localhost-only restriction", () => {
  const result = bindJLinkProbe(
    { ...command, arguments: ["-select", "usb=" + probe.serialNumber] },
    probe,
    3333,
  );
  expect(result.arguments).toEqual([
    "-select",
    "USB=" + probe.serialNumber,
    "-port",
    "3333",
    "-LocalhostOnly",
    "1",
  ]);
});
it("retains modern syntax when the configured command explicitly requires it", () => {
  const result = bindJLinkProbe(
    { ...command, arguments: ["-select", "USB", "-USB", probe.serialNumber] },
    probe,
    3333,
  );
  expect(result.arguments).toEqual([
    "-USB",
    probe.serialNumber,
    "-port",
    "3333",
    "-LocalhostOnly",
    "1",
  ]);
});
