/** ESP app identity parsing checks complete image bounds and both checksum forms. */
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { readEspAppElfHash } from "../src/core/ota/esp-app-identity.js";
function fixture(digest = true) {
  const image = Buffer.alloc(304);
  image[0] = 0xe9;
  image[1] = 1;
  image[23] = digest ? 1 : 0;
  image.writeUInt32LE(256, 28);
  image.writeUInt32LE(0xabcd5432, 32);
  image.fill(0x12, 176, 208);
  let checksum = 0xef;
  for (const byte of image.subarray(32, 288)) checksum ^= byte;
  image[303] = checksum;
  return digest
    ? Buffer.concat([image, createHash("sha256").update(image).digest()])
    : image;
}
it.each([true, false])(
  "reads the descriptor hash with appended digest=%s",
  (digest) => {
    expect(readEspAppElfHash(fixture(digest))).toBe("12".repeat(32));
  },
);
it("does not identify unsupported formats as ESP-IDF application images", () => {
  expect(readEspAppElfHash(Buffer.alloc(2))).toBeNull();
  expect(readEspAppElfHash(Buffer.alloc(400))).toBeNull();
});
it("rejects corrupt segment lengths, checksums, digests and truncated images", () => {
  const length = fixture();
  length.writeUInt32LE(0xffffffff, 28);
  const checksum = fixture();
  checksum[303] ^= 1;
  const digest = fixture();
  digest[335] ^= 1;
  const count = fixture();
  count[1] = 17;
  for (const image of [
    length,
    checksum,
    digest,
    count,
    fixture().subarray(0, 300),
  ])
    expect(() => readEspAppElfHash(image)).toThrow(
      expect.objectContaining({ code: "OTA_APP_IMAGE_INVALID" }),
    );
});
