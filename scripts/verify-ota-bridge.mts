/** Verify the native OTA bridge with loopback-only fixtures; pass an absolute Python executable and optional evidence output path. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import dgram from "node:dgram";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { runEspotaProcess } from "../src/core/ota/espota-process.ts";
const pythonExecutable = process.argv[2];
if (!pythonExecutable || !path.isAbsolute(pythonExecutable))
  throw new Error("Pass an absolute Python interpreter path.");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pio-ota-native-"));
try {
  const socket = dgram.createSocket("udp4");
  await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise<void>((resolve) => socket.close(resolve));
  const image = path.join(temporary, "image.bin");
  await fs.writeFile(image, "fixture image");
  const script = path.resolve("tests/fixtures/ota/bridge-runtime.py");
  const sha = async (file: string) =>
    createHash("sha256")
      .update(await fs.readFile(file))
      .digest("hex");
  let prepared = 0,
    released = 0;
  const result = await runEspotaProcess({
    pythonExecutable,
    uploaderScript: script,
    imagePath: image,
    imageSha256: await sha(image),
    uploaderSha256: await sha(script),
    address: "127.0.0.1",
    port,
    auth: "not-a-real-password",
    filesystem: false,
    timeoutMs: 10000,
    custody: {
      prepareSpawn() {
        prepared++;
      },
      releaseAfterExit() {
        released++;
      },
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(prepared, 1);
  assert.equal(released, 1);
  assert(result.stdout.includes("[REDACTED]"));
  assert(!JSON.stringify(result).includes("not-a-real-password"));
  assert(
    result.stdout.includes("udp-peer-filter=passed tcp-peer-filter=passed"),
  );
  assert(result.stderr.includes("[INFO]: Success"));
  const evidence = {
    observedAt: new Date().toISOString(),
    platform: process.platform,
    pythonExecutable,
    physicalDeviceContacted: false,
    assertion:
      "private credential redaction, INFO completion marker, UDP endpoint filter, TCP peer filter, confirmed cleanup",
    outcome: "pass",
    sourceSha256: await sha("src/core/ota/espota-process.ts"),
    fixtureSha256: await sha(script),
  };
  if (process.argv[3])
    await fs.writeFile(
      process.argv[3],
      JSON.stringify(evidence, null, 2) + "\n",
    );
  console.log(JSON.stringify(evidence));
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
