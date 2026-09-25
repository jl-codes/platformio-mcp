/** Resolved backend commands preserve package paths and exact argv without shell interpretation. */
import path from "node:path";
import { expect, it } from "vitest";
import { parseDebugServerCommand } from "../src/core/debug/debug-server-config.js";
const project = path.resolve("project"),
  installed = path.resolve("installed package");
it("resolves packaged server executables and preserves quoted arguments as single values", () => {
  const args = [
    "-s",
    path.join(installed, "scripts"),
    "-c",
    "adapter speed 1000",
  ];
  const result = parseDebugServerCommand(
    { cwd: installed, executable: "bin/openocd", arguments: args },
    project,
  );
  expect(result).toEqual({
    cwd: installed,
    executable: path.join(installed, "bin/openocd"),
    arguments: args,
  });
  args.push("later mutation");
  expect(result!.arguments).toHaveLength(4);
});
it("preserves an absolute custom server and the authorized project working directory", () => {
  const executable = path.join(installed, "JLinkGDBServer");
  expect(
    parseDebugServerCommand(
      { cwd: null, executable, arguments: ["-port", "2331"] },
      project,
    ),
  ).toMatchObject({ executable, cwd: project, arguments: ["-port", "2331"] });
  expect(parseDebugServerCommand(null, project)).toBeNull();
});
it.each([
  { cwd: null, executable: "openocd", arguments: [] },
  { cwd: "relative", executable: "openocd", arguments: [] },
  { cwd: installed, executable: "launch.cmd", arguments: [] },
  { cwd: installed, executable: "bin/openocd", arguments: ["bad\ncommand"] },
  {
    cwd: installed,
    executable: "bin/openocd",
    arguments: Array(257).fill("x"),
  },
  {
    cwd: installed,
    executable: "bin/openocd",
    arguments: Array(5).fill("x".repeat(32768)),
  },
])("rejects ambiguous or unbounded backend configuration %#", (value) => {
  expect(() => parseDebugServerCommand(value, project)).toThrowError(
    expect.objectContaining({ code: "DEBUG_SERVER_CONFIG_INVALID" }),
  );
});
