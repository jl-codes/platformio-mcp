/** Exercise actual host permissions and cleanup for sensitive analysis storage. */
import fs from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { withPrivateAnalysisDirectory } from "../src/core/analysis/private-analysis-directory.js";
it("establishes private storage and removes sensitive files after failure", async () => {
  let retained = "";
  await expect(
    withPrivateAnalysisDirectory(async (directory) => {
      retained = directory;
      if (process.platform !== "win32")
        expect((await fs.stat(directory)).mode & 0o777).toBe(0o700);
      await fs.writeFile(
        path.join(directory, "dump.raw"),
        "sensitive fixture",
        { mode: 0o600 },
      );
      throw new Error("analysis failed");
    }),
  ).rejects.toThrow("analysis failed");
  expect(retained).not.toBe("");
  await expect(fs.stat(retained)).rejects.toMatchObject({ code: "ENOENT" });
}, 20000);
