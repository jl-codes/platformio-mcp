/** Debugger metadata must not turn project paths or symlink escapes into host executables. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
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
    fs.realpathSync(gdb),
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
