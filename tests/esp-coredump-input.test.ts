/** Raw core-dump integrity checks use independently generated Python zlib/hashlib fixtures. */
import { expect, it } from "vitest";
import {
  inspectRawEspCoredump,
  decodeEspCoredumpBase64,
} from "../src/core/analysis/esp-coredump-input.js";
const crc = Buffer.from(
  "2400000003000000010000000400000000000000020000006669787475726521168fe1cf",
  "hex",
);
const sha = Buffer.from(
  "3c000000010109000100000004000000000000007f454c467465737401ee574cb6c777ee968805c23a322ed66b4c79300d52b65951b9fba94b18f6c6",
  "hex",
);
it("validates CRC input, custom revision and bounded trailing partition bytes", () => {
  const result = inspectRawEspCoredump(
    Buffer.concat([crc, Buffer.alloc(16, 255)]),
  );
  expect(result.identity).toMatchObject({
    chip: "esp32",
    checksum: "crc32",
    chip_revision: 2,
    length: crc.length,
    trailing_bytes: 16,
  });
  expect(result.bytes).toEqual(crc);
});
it("validates the SHA256 ELF envelope for the encoded chip", () => {
  expect(inspectRawEspCoredump(sha).identity).toMatchObject({
    chip: "esp32s3",
    checksum: "sha256",
    payload_format: "elf",
  });
});
it.each([crc, sha])("rejects payload corruption", (fixture) => {
  const bad = Buffer.from(fixture);
  bad[24] ^= 1;
  expect(() => inspectRawEspCoredump(bad)).toThrowError(
    expect.objectContaining({ code: "COREDUMP_CHECKSUM_MISMATCH" }),
  );
});
it("rejects oversized declared length before checksum slicing", () => {
  const bad = Buffer.from(crc);
  bad.writeUInt32LE(0xffffffff, 0);
  expect(() => inspectRawEspCoredump(bad)).toThrowError(
    expect.objectContaining({ code: "COREDUMP_LENGTH_INVALID" }),
  );
});
it("distinguishes encrypted, erased and unsupported inputs", () => {
  expect(() => inspectRawEspCoredump(crc, true)).toThrowError(
    expect.objectContaining({ code: "COREDUMP_ENCRYPTED" }),
  );
  expect(() => inspectRawEspCoredump(Buffer.alloc(4096, 255))).toThrowError(
    expect.objectContaining({ code: "COREDUMP_EMPTY" }),
  );
  const bad = Buffer.from(crc);
  bad.writeUInt32LE(0xffff, 4);
  expect(() => inspectRawEspCoredump(bad)).toThrowError(
    expect.objectContaining({ code: "COREDUMP_FORMAT_UNSUPPORTED" }),
  );
});
it("decodes line-wrapped base64 but rejects ignored garbage and nonzero padding bits", () => {
  expect(decodeEspCoredumpBase64(crc.toString("base64") + "\r\n")).toEqual(crc);
  expect(() => decodeEspCoredumpBase64("Zg==!")).toThrow();
  expect(() => decodeEspCoredumpBase64("Zh==")).toThrow();
});
