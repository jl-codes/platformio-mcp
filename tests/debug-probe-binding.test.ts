/** Explicit probe binding keeps metacharacters as serial data and rejects competing startup commands. */
import path from "node:path";
import { expect, it } from "vitest";
import {
  bindOpenOcdProbe,
  selectLocalDebugEndpoint,
} from "../src/core/debug/debug-probe-binding.js";
const probe = {
  vendorId: "0403",
  productId: "6010",
  serialNumber: "FT123",
  location: "usb:1",
};
const command = {
  executable: path.resolve("openocd.exe"),
  cwd: path.resolve("."),
  arguments: ["-f", "board/esp32.cfg"],
};
it("binds the serial and loopback endpoint both before and after trusted configuration", () => {
  const result = bindOpenOcdProbe(command, probe, 3333);
  expect(result.arguments.slice(0, 4)).toEqual([
    "-c",
    'adapter serial "FT123"',
    "-c",
    "bindto 127.0.0.1",
  ]);
  expect(
    result.arguments.filter((arg) => arg === 'adapter serial "FT123"'),
  ).toHaveLength(2);
  expect(result.arguments).toContain("gdb_port 3333");
  expect(result.arguments).toContain("telnet_port disabled");
  expect(command.arguments).toEqual(["-f", "board/esp32.cfg"]);
});
it("quotes Tcl substitutions inside a discovered serial", () => {
  const serial = 'x$env(HOME)[exec whoami]";bad';
  const result = bindOpenOcdProbe(
    command,
    { ...probe, serialNumber: serial },
    3333,
  );
  expect(result.arguments[1]).toBe(
    'adapter serial "x\\$env(HOME)\\[exec whoami\\]\\";bad"',
  );
});
it.each([
  "init",
  "adapter serial other",
  "adapter speed 100; init",
  "ftdi_serial other",
])("rejects conflicting command %s", (text) => {
  expect(() =>
    bindOpenOcdProbe({ ...command, arguments: ["-c", text] }, probe, 3333),
  ).toThrow();
});
it("rejects unrelated backend executables and nonlocal endpoints", () => {
  expect(() =>
    bindOpenOcdProbe(
      { ...command, executable: path.resolve("other.exe") },
      probe,
      3333,
    ),
  ).toThrow();
  for (const value of [
    null,
    "pipe",
    "192.0.2.1:3333",
    ":0",
    ":65536",
    "localhost:3333;halt",
  ])
    expect(() => selectLocalDebugEndpoint(value)).toThrow();
  for (const value of [":3333", "localhost:3333", "127.0.0.1:3333"])
    expect(selectLocalDebugEndpoint(value)).toEqual({
      host: "127.0.0.1",
      port: 3333,
    });
});
