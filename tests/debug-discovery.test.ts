/** Debugger metadata must not turn project paths or symlink escapes into host executables. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  discoverDebuggerRoots,
  discoverDebugBackendRoots,
  resolveDebugBackendExecutable,
  resolveDebuggerExecutable,
  selectDebugMetadata,
} from "../src/core/debug/debug-discovery.js";
let root: string;
let project: string;
let install: string;
let gdb: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-debug-discovery-"));
  project = path.join(root, "project");
  install = path.join(root, "tool-xtensa-esp-elf-gdb");
  fs.mkdirSync(project);
  fs.mkdirSync(install);
  gdb = path.join(install, "xtensa-esp32-elf-gdb");
  fs.writeFileSync(gdb, "test only");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
it("uses the selected gdb_path even when the compiler belongs to a different package", async () => {
  const compiler = path.join(root, "compiler", "gcc");
  const metadata = JSON.stringify({
    wrong: {
      cc_path: compiler,
      prog_path: path.join(project, "wrong.elf"),
      gdb_path: path.join(root, "wrong-gdb"),
    },
    selected: {
      cc_path: compiler,
      prog_path: path.join(project, "firmware.elf"),
      gdb_path: gdb,
    },
  });
  expect(selectDebugMetadata(metadata, "selected")).toMatchObject({
    debuggerPath: gdb,
    compilerPath: compiler,
  });
  expect(await resolveDebuggerExecutable(gdb, [install], project)).toBe(
    await fs.promises.realpath(gdb),
  );
});
it("rejects missing or relative debugger metadata without a PATH fallback", () => {
  for (const candidate of [undefined, "gdb", "relative/gdb", 123]) {
    expect(() =>
      selectDebugMetadata(
        JSON.stringify({
          env: {
            cc_path: path.join(root, "gcc"),
            prog_path: path.join(project, "fw.elf"),
            gdb_path: candidate,
          },
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "GDB_METADATA_INVALID" }));
  }
});
it("rejects project roots, ancestor roots and executable-shaped project files", async () => {
  const local = path.join(project, "gdb");
  fs.writeFileSync(local, "untrusted");
  for (const roots of [[project], [root], [install]]) {
    await expect(
      resolveDebuggerExecutable(local, roots, project),
    ).rejects.toMatchObject({
      code: "GDB_EXECUTABLE_UNTRUSTED",
    });
  }
});
it("rejects a directory alias that redirects an installed path into the project", async () => {
  const local = path.join(project, "gdb");
  fs.writeFileSync(local, "untrusted");
  const alias = path.join(install, "redirect");
  fs.symlinkSync(
    project,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(
    resolveDebuggerExecutable(path.join(alias, "gdb"), [install], project),
  ).rejects.toMatchObject({
    code: "GDB_EXECUTABLE_UNTRUSTED",
  });
});

it("discovers a registered standalone debugger package from host Core metadata", async () => {
  const packages = path.join(root, "core", "packages");
  const pkg = path.join(packages, "tool-xtensa-esp-elf-gdb");
  fs.mkdirSync(pkg, { recursive: true });
  const executable = path.join(pkg, "xtensa-esp32-elf-gdb");
  fs.writeFileSync(executable, "fixture");
  fs.writeFileSync(
    path.join(pkg, "package.json"),
    JSON.stringify({
      name: "tool-xtensa-esp-elf-gdb",
      version: "12.1",
    }),
  );
  const record = path.join(pkg, ".piopm");
  fs.writeFileSync(
    record,
    JSON.stringify({
      type: "tool",
      name: "tool-xtensa-esp-elf-gdb",
      version: "12.1",
    }),
  );
  const info = { core_dir: { value: path.join(root, "core") } };
  expect(await discoverDebuggerRoots(executable, info, project, {})).toEqual([
    await fs.promises.realpath(pkg),
  ]);
  fs.writeFileSync(
    record,
    JSON.stringify({
      type: "tool",
      name: "tool-xtensa-esp-elf-gdb",
      version: "11",
    }),
  );
  await expect(
    discoverDebuggerRoots(executable, info, project, {}),
  ).rejects.toMatchObject({
    code: "GDB_EXECUTABLE_UNTRUSTED",
  });
});
it("accepts an explicit operator installation without requiring Core metadata", async () => {
  expect(
    await discoverDebuggerRoots(gdb, null, project, {
      PIO_MCP_DEBUGGER_ROOTS: JSON.stringify([install]),
    }),
  ).toEqual([await fs.promises.realpath(install)]);
});
it("does not silently fall back when explicit debugger configuration is malformed", async () => {
  for (const value of ["", "[]", "{}", '["relative"]']) {
    await expect(
      discoverDebuggerRoots(gdb, {}, project, {
        PIO_MCP_DEBUGGER_ROOTS: value,
      }),
    ).rejects.toMatchObject({ code: "GDB_EXECUTABLE_UNTRUSTED" });
  }
});

it.each(["openocd", "JLinkGDBServerCL.exe", "ST-LINK_gdbserver", "st-util"])(
  "accepts operator-installed backend %s with separate trust",
  async (name) => {
    const backend = path.join(install, name);
    fs.writeFileSync(backend, "fixture");
    expect(
      await discoverDebugBackendRoots(backend, null, project, {
        PIO_MCP_DEBUG_BACKEND_ROOTS: JSON.stringify([install]),
      }),
    ).toEqual([await fs.promises.realpath(install)]);
    await expect(
      discoverDebugBackendRoots(backend, null, project, {
        PIO_MCP_DEBUGGER_ROOTS: JSON.stringify([install]),
      }),
    ).rejects.toMatchObject({ code: "DEBUG_BACKEND_EXECUTABLE_UNTRUSTED" });
  },
);
it("rejects project backends and shell executables inside operator roots", async () => {
  const local = path.join(project, "openocd");
  const shell = path.join(install, "cmd.exe");
  fs.writeFileSync(local, "fixture");
  fs.writeFileSync(shell, "fixture");
  for (const [candidate, roots] of [
    [local, [project]],
    [local, [root]],
    [shell, [install]],
  ] as const)
    await expect(
      resolveDebugBackendExecutable(candidate, roots, project),
    ).rejects.toMatchObject({ code: "DEBUG_BACKEND_EXECUTABLE_UNTRUSTED" });
});
it("requires backend package registration to match the installed manifest", async () => {
  const core = path.join(root, "core");
  const pkg = path.join(core, "packages", "tool-openocd-esp32");
  fs.mkdirSync(pkg, { recursive: true });
  const backend = path.join(pkg, "openocd");
  fs.writeFileSync(backend, "fixture");
  const metadata = { name: "tool-openocd-esp32", version: "1.0" };
  fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify(metadata));
  fs.writeFileSync(
    path.join(pkg, ".piopm"),
    JSON.stringify({ ...metadata, type: "tool" }),
  );
  const info = { core_dir: { value: core } };
  expect(await discoverDebugBackendRoots(backend, info, project, {})).toEqual([
    await fs.promises.realpath(pkg),
  ]);
  fs.writeFileSync(
    path.join(pkg, ".piopm"),
    JSON.stringify({ ...metadata, version: "other", type: "tool" }),
  );
  await expect(
    discoverDebugBackendRoots(backend, info, project, {}),
  ).rejects.toMatchObject({ code: "DEBUG_BACKEND_EXECUTABLE_UNTRUSTED" });
});
