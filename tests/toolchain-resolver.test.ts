/** Resolver tests inspect fixture paths only; fake binaries are never executed. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { resolveAnalysisToolchain } from "../src/core/analysis/toolchain-resolver.js";
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-toolchain-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function binaries(directory: string) {
  fs.mkdirSync(directory, { recursive: true });
  for (const name of ["gcc", "addr2line", "size", "nm"])
    fs.writeFileSync(
      path.join(directory, `arm-none-eabi-${name}.exe`),
      "fixture",
    );
  return path.join(directory, "arm-none-eabi-gcc.exe");
}
describe("trusted toolchain resolution", () => {
  it("resolves exact compiler companions in paths containing spaces", async () => {
    const installed = path.join(root, "installed tools");
    const compiler = binaries(path.join(installed, "bin"));
    const resolved = await resolveAnalysisToolchain(compiler, [installed]);
    expect(resolved.addr2line).toBe(
      path.join(installed, "bin", "arm-none-eabi-addr2line.exe"),
    );
  });
  it("rejects a sibling path with the same prefix", async () => {
    const installed = path.join(root, "tools");
    fs.mkdirSync(installed);
    const compiler = binaries(path.join(root, "tools-untrusted", "bin"));
    await expect(
      resolveAnalysisToolchain(compiler, [installed]),
    ).rejects.toMatchObject({ code: "ANALYSIS_TOOLCHAIN_UNTRUSTED" });
  });
  it("reports missing companions without selecting another installed toolchain", async () => {
    const compiler = binaries(path.join(root, "bin"));
    fs.unlinkSync(path.join(root, "bin", "arm-none-eabi-nm.exe"));
    await expect(
      resolveAnalysisToolchain(compiler, [root]),
    ).rejects.toMatchObject({ code: "ANALYSIS_TOOL_UNAVAILABLE" });
  });
  it("requires explicit roots and an absolute compiler path", async () => {
    await expect(resolveAnalysisToolchain("gcc", [root])).rejects.toMatchObject(
      { code: "ANALYSIS_TOOLCHAIN_INVALID" },
    );
    await expect(
      resolveAnalysisToolchain(path.join(root, "gcc"), []),
    ).rejects.toMatchObject({ code: "ANALYSIS_TOOLCHAIN_INVALID" });
  });
});
