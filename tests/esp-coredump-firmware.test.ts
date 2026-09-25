/** Synthetic ELF notes exercise bounded parsing and honest prefix matching. */
import { expect, it } from "vitest";
import {
  readEspCoredumpFirmwareIdentity,
  matchEspCoredumpFirmware,
} from "../src/core/analysis/esp-coredump-firmware.js";
function core(hash = "a".repeat(64)) {
  const bytes = Buffer.alloc(184);
  Buffer.from("7f454c46010101", "hex").copy(bytes);
  bytes.writeUInt16LE(4, 16);
  bytes.writeUInt16LE(94, 18);
  bytes.writeUInt32LE(1, 20);
  bytes.writeUInt32LE(52, 28);
  bytes.writeUInt16LE(52, 40);
  bytes.writeUInt16LE(32, 42);
  bytes.writeUInt16LE(1, 44);
  bytes.writeUInt32LE(4, 52);
  bytes.writeUInt32LE(84, 56);
  bytes.writeUInt32LE(100, 68);
  bytes.writeUInt32LE(18, 84);
  bytes.writeUInt32LE(68, 88);
  bytes.writeUInt32LE(8266, 92);
  bytes.write("ESP_CORE_DUMP_INFO\0", 96, "ascii");
  bytes.writeUInt32LE(0x101, 116);
  bytes.write(hash, 120, "ascii");
  return bytes;
}
it("extracts a full hash and rejects a different selected ELF", () => {
  const identity = readEspCoredumpFirmwareIdentity(core(), 0x101);
  expect(matchEspCoredumpFirmware(identity, "a".repeat(64))).toEqual({
    status: "matched",
    hashBits: 256,
  });
  expect(() => matchEspCoredumpFirmware(identity, "b".repeat(64))).toThrowError(
    expect.objectContaining({ code: "COREDUMP_ELF_MISMATCH" }),
  );
});
it("reports short hash evidence as a prefix, never a complete match", () => {
  const identity = readEspCoredumpFirmwareIdentity(core("abcd"), 0x101);
  expect(matchEspCoredumpFirmware(identity, "abcd" + "0".repeat(60))).toEqual({
    status: "prefix_matched",
    hashBits: 16,
  });
});
it("reports a missing application note without manufacturing identity", () => {
  const bytes = core();
  bytes.writeUInt32LE(1, 92);
  expect(
    matchEspCoredumpFirmware(
      readEspCoredumpFirmwareIdentity(bytes, 0x101),
      "a".repeat(64),
    ),
  ).toEqual({ status: "unavailable", hashBits: 0 });
});
it.each([
  "table",
  "segment",
  "name",
  "descriptor",
  "version",
  "machine",
  "nonascii",
  "padding",
])("rejects malformed %s evidence", (kind) => {
  const bytes = core("abcd");
  if (kind === "table") bytes.writeUInt32LE(0xfffffff0, 28);
  if (kind === "segment") bytes.writeUInt32LE(101, 68);
  if (kind === "name") bytes.writeUInt32LE(0xffffffff, 84);
  if (kind === "descriptor") bytes.writeUInt32LE(67, 88);
  if (kind === "version") bytes.writeUInt32LE(0x103, 116);
  if (kind === "machine") bytes.writeUInt16LE(243, 18);
  if (kind === "nonascii") bytes[120] = 0xe1;
  if (kind === "padding") bytes[130] = 1;
  expect(() => readEspCoredumpFirmwareIdentity(bytes, 0x101)).toThrowError(
    expect.objectContaining({ code: "COREDUMP_ELF_INVALID" }),
  );
});
