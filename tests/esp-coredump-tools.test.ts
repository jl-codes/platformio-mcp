/** Host configuration, rather than caller tool arguments, establishes optional executable selection. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { resolveEspCoredumpTools } from "../src/core/analysis/esp-coredump-tools.js";
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "pio-core-tools-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it("requires explicit server configuration", async () => {
  await expect(resolveEspCoredumpTools(root, {})).rejects.toMatchObject({
    code: "COREDUMP_TOOLS_UNCONFIGURED",
  });
});
it("rejects relative or shell-shim interpreters", async () => {
  for (const python of ["python", path.join(root, "python.cmd")])
    await expect(
      resolveEspCoredumpTools(root, {
        PIO_MCP_COREDUMP_PYTHON: python,
        PIO_MCP_COREDUMP_GDB: path.join(root, "gdb"),
      }),
    ).rejects.toMatchObject({ code: "COREDUMP_TOOLS_INVALID" });
});
it("rejects a project-owned interpreter before debugger discovery", async () => {
  const python = path.join(root, "python.exe");
  await fs.writeFile(python, "fixture");
  await expect(
    resolveEspCoredumpTools(root, {
      PIO_MCP_COREDUMP_PYTHON: python,
      PIO_MCP_COREDUMP_GDB: path.join(root, "gdb"),
    }),
  ).rejects.toMatchObject({ code: "COREDUMP_TOOLS_INVALID" });
});
