/** Reference package vocabulary mapping without package execution. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { mapPackageCompatibilityRequest } from "../src/adapters/package-compat.js";
it("maps reference search defaults without requiring a project", async () => {
  expect(
    await mapPackageCompatibilityRequest("pio_pkg_search", { query: "" }),
  ).toEqual({
    action: "pkg_search",
    args: { query: "", kind: "library", page: 1 },
  });
});
it("maps project package operations with explicit and launch defaults", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-compat-"));
  try {
    fs.writeFileSync(path.join(root, "platformio.ini"), "[env:test]\n");
    const expected = fs.realpathSync.native(root);
    for (const name of ["pio_pkg_list", "pio_pkg_outdated", "pio_pkg_update"])
      expect(
        await mapPackageCompatibilityRequest(
          name,
          { project_dir: null, env: null },
          { projectDir: root },
        ),
      ).toEqual({ action: name.slice(4), args: { projectDir: expected } });
    expect(
      await mapPackageCompatibilityRequest(
        "pio_pkg_install",
        {
          spec: "owner/name@^1",
          type: "tool",
          env: "test",
          approval_id: "grant",
        },
        { cwd: root },
      ),
    ).toEqual({
      action: "pkg_install",
      args: {
        projectDir: expected,
        spec: "owner/name@^1",
        kind: "tool",
        environment: "test",
        approvalId: "grant",
      },
    });
    expect(
      (
        await mapPackageCompatibilityRequest(
          "pio_pkg_uninstall",
          { project_dir: "~", spec: "owner/name" },
          { home: root },
        )
      ).args.projectDir,
    ).toBe(expected);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
it("rejects unknown names, arguments and invalid package kinds", async () => {
  await expect(
    mapPackageCompatibilityRequest("__proto__", {}),
  ).rejects.toMatchObject({ code: "COMPAT_TOOL_UNKNOWN" });
  for (const args of [
    { query: "x", type: "binary" },
    { query: "x", approved: true },
    { query: "x", page: 0 },
  ])
    await expect(
      mapPackageCompatibilityRequest("pio_pkg_search", args),
    ).rejects.toMatchObject({ code: "COMPAT_ARGUMENT_INVALID" });
});
