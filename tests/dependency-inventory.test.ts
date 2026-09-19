/** Temporary filesystem inventory checks without PlatformIO or hardware execution. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { collectDependencyInventory } from "../src/core/dependency-inventory.js";
it("collects preferred JSON and properties, deduplicates roots and reports incomplete evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pio-inventory-"));
  try {
    for (const name of ["A", "B", "Broken", "Missing"])
      await fs.mkdir(path.join(root, name));
    await fs.writeFile(
      path.join(root, "A", "library.json"),
      '{"name":"Actual A","dependencies":{"B":"*"}}',
    );
    await fs.writeFile(
      path.join(root, "B", "library.properties"),
      "name=B\nversion=1.2",
    );
    await fs.writeFile(path.join(root, "Broken", "library.json"), "{");
    await fs.writeFile(
      path.join(root, "Broken", "library.properties"),
      "name=Hidden fallback",
    );
    const result = await collectDependencyInventory([
      { directory: root, source: "lib" },
      { directory: root, source: "extra" },
    ]);
    expect(result.libraries).toHaveLength(4);
    expect(result.libraries).toContainEqual(
      expect.objectContaining({
        name: "Actual A",
        dependencies: ["B"],
        source: "lib",
      }),
    );
    expect(result.libraries.some((lib) => lib.name === "Hidden fallback")).toBe(
      false,
    );
    expect(result.complete).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "DEPENDENCY_MANIFEST_INVALID" }),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
it("allows absent optional roots and refuses oversized manifests", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pio-inventory-"));
  try {
    expect(
      (
        await collectDependencyInventory([
          { directory: path.join(root, "absent"), source: "lib" },
        ])
      ).complete,
    ).toBe(true);
    await fs.mkdir(path.join(root, "Big"));
    await fs.writeFile(
      path.join(root, "Big", "library.json"),
      "x".repeat(1024 * 1024 + 1),
    );
    await expect(
      collectDependencyInventory([{ directory: root, source: "lib" }]),
    ).rejects.toMatchObject({ code: "DEPENDENCY_LIMIT" });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
