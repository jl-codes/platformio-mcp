/** Backend selection joins real installation validation, endpoint checks and physical probe binding without launching. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { prepareLocalDebugBackend } from "../src/core/debug/debug-backend-selection.js";
let root: string;
let prepared: Parameters<typeof prepareLocalDebugBackend>[0];
const probe = {
  vendorId: "1366",
  productId: "0105",
  serialNumber: "580011111",
  location: "usb:1",
};
beforeEach(() => {
  root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "pio-backend-selection-")),
  );
  const projectDir = path.join(root, "project"),
    installation = path.join(root, "tools");
  fs.mkdirSync(projectDir);
  fs.mkdirSync(installation);
  const executable = path.join(installation, "openocd.exe");
  fs.writeFileSync(executable, "fixture: never executed");
  prepared = {
    projectDir,
    trustedBackendRoots: [installation],
    configuration: {
      environment: "debug",
      debuggerPath: path.join(installation, "gdb"),
      elfPath: path.join(projectDir, "firmware.elf"),
      debugTool: "fixture",
      server: { executable, cwd: installation, arguments: ["-f", "board.cfg"] },
      port: ":3333",
      readyPattern: "Listening on port",
      initScript: "",
      generatedInitScript: "",
      generatedInitTemplate: "",
      initCommands: [],
      extraCommands: [],
      loadCommands: [],
      initBreak: null,
      loadMode: "always",
      supervisorPython: path.join(root, "python.exe"),
    },
  };
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
it("returns an exact OpenOCD command and identity for later custody", async () => {
  const result = await prepareLocalDebugBackend(prepared, probe);
  expect(result.endpoint).toEqual({ host: "127.0.0.1", port: 3333 });
  expect(result.options.command.arguments).toContain(
    'adapter serial "580011111"',
  );
  expect(result.options.pythonExecutable).toBe(
    prepared.configuration.supervisorPython,
  );
  expect(result.resource.identity).toContain(probe.serialNumber);
});
it("routes SEGGER commands through explicit USB selection", async () => {
  const file = path.join(root, "tools", "JLinkGDBServerCL.exe");
  fs.writeFileSync(file, "fixture");
  prepared.configuration.server = {
    executable: file,
    cwd: path.dirname(file),
    arguments: ["-device", "STM32F407VG"],
  };
  expect(
    (await prepareLocalDebugBackend(prepared, probe)).options.command.arguments,
  ).toContain("-USB");
});
it("rejects unsupported probe adapters even for a trusted executable", async () => {
  const file = path.join(root, "tools", "st-util");
  fs.writeFileSync(file, "fixture");
  prepared.configuration.server!.executable = file;
  await expect(prepareLocalDebugBackend(prepared, probe)).rejects.toMatchObject(
    { code: "DEBUG_BACKEND_BINDING_UNSUPPORTED" },
  );
});
it("rejects missing readiness and externally managed endpoints", async () => {
  prepared.configuration.readyPattern = null;
  await expect(prepareLocalDebugBackend(prepared, probe)).rejects.toMatchObject(
    { code: "DEBUG_READY_PATTERN_INVALID" },
  );
  prepared.configuration.readyPattern = "Listening";
  prepared.configuration.port = "192.0.2.1:3333";
  await expect(prepareLocalDebugBackend(prepared, probe)).rejects.toMatchObject(
    { code: "DEBUG_ENDPOINT_UNSUPPORTED" },
  );
});
it("revalidates executable roots after project preparation", async () => {
  const file = path.join(prepared.projectDir, "openocd.exe");
  fs.writeFileSync(file, "fixture");
  prepared.configuration.server!.executable = file;
  await expect(prepareLocalDebugBackend(prepared, probe)).rejects.toMatchObject(
    { code: "DEBUG_BACKEND_EXECUTABLE_UNTRUSTED" },
  );
});
