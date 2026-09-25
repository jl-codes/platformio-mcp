/** OTA snapshots preserve the approved bytes across rebuilds and reject mismatches. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { retainOtaImage } from "../src/core/ota/ota-artifacts.js";
let root: string, project: string, image: string;
let snapshot: Awaited<ReturnType<typeof retainOtaImage>> | undefined;
beforeEach(async () => {
  root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "pio-ota-image-")),
  );
  project = path.join(root, "project");
  await fs.mkdir(project);
  image = path.join(project, "firmware.bin");
  await fs.writeFile(image, Buffer.from([0xe9, 1, 2, 3]));
});
afterEach(async () => {
  await snapshot?.release();
  snapshot = undefined;
  await fs.rm(root, { recursive: true, force: true });
});
it("retains immutable upload bytes through later builds and releases idempotently", async () => {
  snapshot = await retainOtaImage(project, image);
  await fs.writeFile(image, "new build");
  expect(await fs.readFile(snapshot.path)).toEqual(
    Buffer.from([0xe9, 1, 2, 3]),
  );
  await snapshot.verify();
  await Promise.all([snapshot.release(), snapshot.release()]);
  await expect(fs.access(snapshot.path)).rejects.toMatchObject({
    code: "ENOENT",
  });
});
it("rejects wrong selected hashes and empty images", async () => {
  await expect(
    retainOtaImage(project, image, "0".repeat(64)),
  ).rejects.toMatchObject({ code: "OTA_IMAGE_CHANGED" });
  await fs.writeFile(image, "");
  await expect(retainOtaImage(project, image)).rejects.toMatchObject({
    code: "OTA_IMAGE_INVALID",
  });
});
it("rejects outside-workspace images and detects retained-copy tampering", async () => {
  const outside = path.join(root, "outside.bin");
  await fs.writeFile(outside, "outside");
  await expect(retainOtaImage(project, outside)).rejects.toMatchObject({
    code: "PARTITION_ARTIFACT_OUTSIDE_WORKSPACE",
  });
  snapshot = await retainOtaImage(project, image);
  await fs.writeFile(snapshot.path, "tampered");
  await expect(snapshot.verify()).rejects.toMatchObject({
    code: "OTA_IMAGE_CHANGED",
  });
});

it("preserves upload evidence after cleanup and a later rebuild without overwriting tampering", async () => {
  const archive = path.join(root, "archive");
  snapshot = await retainOtaImage(project, image, undefined, archive);
  const stored = await snapshot.archive();
  await fs.writeFile(image, "later build");
  expect(await snapshot.archive()).toBe(stored);
  await snapshot.release();
  expect(await fs.readFile(stored)).toEqual(Buffer.from([0xe9, 1, 2, 3]));
  await fs.writeFile(image, Buffer.from([0xe9, 1, 2, 3]));
  snapshot = await retainOtaImage(project, image, undefined, archive);
  await fs.writeFile(stored, "tampered archive");
  await expect(snapshot.archive()).rejects.toMatchObject({
    code: "OTA_ARCHIVE_INVALID",
  });
  expect(await fs.readFile(stored, "utf8")).toBe("tampered archive");
});
