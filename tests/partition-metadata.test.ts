/** Build-derived partition evidence uses the selected environment and build permission. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi, afterEach } from "vitest";
import { resolveBuildPartitionInputs } from "../src/tools/partition-project.js";
import { platformioExecutor } from "../src/platformio.js";
vi.mock("../src/platformio.js", () => ({
  platformioExecutor: { execute: vi.fn() },
}));
const roots: string[] = [];
afterEach(() => {
  vi.clearAllMocks();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function project(profile: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-partition-meta-"));
  roots.push(root);
  fs.writeFileSync(
    path.join(root, ".pio-mcp-policy.json"),
    JSON.stringify({ profile, overrides: { audit_all_agent_actions: false } }),
  );
  return root;
}
it("denies metadata under read-only policy before Core executes", async () => {
  const root = project("read_only");
  await expect(
    resolveBuildPartitionInputs(root, "fixture", {}),
  ).rejects.toMatchObject({ code: "POLICY_DENIED" });
  expect(platformioExecutor.execute).not.toHaveBeenCalled();
});
it("selects the partition binary and address from the authorized environment", async () => {
  const root = project("build_only");
  const table = path.join(root, ".pio", "build", "fixture", "partitions.bin");
  vi.mocked(platformioExecutor.execute).mockResolvedValue({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({
      fixture: {
        env_name: "fixture",
        extra: { flash_images: [{ path: table, offset: "0x10000" }] },
      },
    }),
  } as Awaited<ReturnType<typeof platformioExecutor.execute>>);
  const result = await resolveBuildPartitionInputs(root, "fixture", {});
  expect(result).toMatchObject({
    tablePath: table,
    offsetEvidence: { offset: 0x10000 },
  });
  expect(platformioExecutor.execute).toHaveBeenCalledWith(
    "project",
    expect.arrayContaining(["--environment", "fixture"]),
    expect.anything(),
  );
});
it("rejects multiple candidate binaries instead of guessing", async () => {
  const root = project("build_only");
  vi.mocked(platformioExecutor.execute).mockResolvedValue({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify({
      fixture: {
        extra: {
          flash_images: [
            { path: "one/partitions.bin", offset: "0x8000" },
            { path: "two/partitions.bin", offset: "0x10000" },
          ],
        },
      },
    }),
  } as Awaited<ReturnType<typeof platformioExecutor.execute>>);
  await expect(
    resolveBuildPartitionInputs(root, "fixture", {}),
  ).rejects.toMatchObject({ code: "PARTITION_METADATA_AMBIGUOUS" });
});
