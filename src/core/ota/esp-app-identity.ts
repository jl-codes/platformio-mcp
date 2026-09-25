/** Read ESP-IDF application ELF identity from structurally validated ESP32 images.
 * Layout: https://github.com/espressif/esp-idf/blob/v5.5/components/esp_app_format/include/esp_app_desc.h
 * This is image metadata, not authenticated firmware provenance or proof of device execution.
 */
import { createHash } from "node:crypto";
import { PlatformIOError } from "../../utils/errors.js";

/** Return null for formats without a recognized app descriptor; reject corrupted recognized images. */
export function readEspAppElfHash(image: Buffer): string | null {
  if (
    image.length < 288 ||
    image[0] !== 0xe9 ||
    image.readUInt32LE(32) !== 0xabcd5432
  )
    return null;
  const invalid = () =>
    new PlatformIOError(
      "Invalid ESP application image structure or checksum.",
      "OTA_APP_IMAGE_INVALID",
    );
  if (
    image[1] < 1 ||
    image[1] > 16 ||
    image[23] > 1 ||
    image.readUInt32LE(28) < 256
  )
    throw invalid();
  let position = 24;
  let checksum = 0xef;
  for (let index = 0; index < image[1]; index++) {
    if (position + 8 > image.length) throw invalid();
    const size = image.readUInt32LE(position + 4);
    position += 8;
    if (size > image.length - position) throw invalid();
    for (let end = position + size; position < end; position++)
      checksum ^= image[position];
  }
  const checksumOffset = Math.floor(position / 16) * 16 + 15;
  if (checksumOffset >= image.length || image[checksumOffset] !== checksum)
    throw invalid();
  if (image[23] === 1) {
    const digestOffset = checksumOffset + 1;
    if (
      digestOffset + 32 > image.length ||
      !createHash("sha256")
        .update(image.subarray(0, digestOffset))
        .digest()
        .equals(image.subarray(digestOffset, digestOffset + 32))
    )
      throw invalid();
  }
  const hash = image.subarray(176, 208);
  return hash.every((value) => value === 0) ||
    hash.every((value) => value === 255)
    ? null
    : hash.toString("hex");
}
