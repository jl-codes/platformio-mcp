/** Offline flash layout validation for custom offsets and corrupted device records. */
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  parseEspPartitionBinary,
  parseEspPartitionCsv,
  parsePartitionNumber,
} from "../src/core/esp-partitions.js";
const layout = { tableOffset: 0x10000, flashSize: 0x400000 };
it("resolves custom table placement, app alignment, OTA subtypes and end-address sizes", () => {
  expect(
    parseEspPartitionCsv(
      "# Name,Type,SubType,Offset,Size,Flags\nnvs,data,nvs,,24K,\napp,app,ota_0,,-0x200000,encrypted\ncrash,data,coredump,,64K,",
      layout,
    ),
  ).toEqual([
    {
      name: "nvs",
      type: 1,
      subtype: 2,
      offset: 0x11000,
      size: 0x6000,
      flags: 0,
    },
    {
      name: "app",
      type: 0,
      subtype: 0x10,
      offset: 0x20000,
      size: 0x1e0000,
      flags: 1,
    },
    {
      name: "crash",
      type: 1,
      subtype: 3,
      offset: 0x200000,
      size: 0x10000,
      flags: 0,
    },
  ]);
});
it.each([
  "app,app,factory,0x10000,1M,",
  "a,data,nvs,0x11000,0x3000,\nb,data,nvs,0x12000,0x1000,",
  "a,data,nvs,0x11000,0x1000,\na,data,nvs,0x12000,0x1000,",
  "app,app,factory,0x21000,1M,",
  "app,app,factory,0x20000,8M,",
  "a,data,nvs,0xfffff000,0x2000,",
  "a,data,nvs,,0,",
  "a,data,nvs,,4K,unknown",
])("rejects an unsafe layout: %s", (csv) => {
  expect(() => parseEspPartitionCsv(csv, layout)).toThrow();
});
it("does not expand operator environment variables", () => {
  expect(() =>
    parseEspPartitionCsv("a,data,nvs,,$" + "{SECRET},", layout),
  ).toThrow();
});
it.each(["NaN", "Infinity", "1.2", "1MB", "-1", "0x100000001"])(
  "rejects invalid quantity %s",
  (number) => {
    expect(() => parsePartitionNumber(number)).toThrow();
  },
);
function binary(): Buffer {
  const data = Buffer.alloc(0xc00, 255);
  data.writeUInt16LE(0x50aa, 0);
  data[2] = 1;
  data[3] = 3;
  data.writeUInt32LE(0x11000, 4);
  data.writeUInt32LE(0x10000, 8);
  data.fill(0, 12, 32);
  data.write("crash", 12, "utf8");
  data.writeUInt16LE(0xebeb, 32);
  createHash("md5").update(data.subarray(0, 32)).digest().copy(data, 48);
  return data;
}
it("checks a binary checksum and preserves the coredump location", () => {
  expect(parseEspPartitionBinary(binary(), layout)).toEqual([
    {
      name: "crash",
      type: 1,
      subtype: 3,
      offset: 0x11000,
      size: 0x10000,
      flags: 0,
    },
  ]);
});
it.each(["digest", "entry", "terminator", "padding", "ordering"])(
  "rejects binary corruption: %s",
  (kind) => {
    const data = binary();
    if (kind === "digest") data[48] ^= 1;
    if (kind === "entry") data[4] ^= 1;
    if (kind === "terminator") data.fill(0, 64);
    if (kind === "padding") data[34] = 0;
    if (kind === "ordering") data.copy(data, 64, 0, 32);
    expect(() => parseEspPartitionBinary(data, layout)).toThrow();
  },
);
it("accepts an erased table and bounds the sector trailer separately", () => {
  expect(parseEspPartitionBinary(Buffer.alloc(0xc00, 255), layout)).toEqual([]);
  const data = Buffer.alloc(0x1000, 0);
  binary().copy(data);
  expect(parseEspPartitionBinary(data, layout)).toHaveLength(1);
});
it("requires a resolved aligned table offset", () => {
  expect(() => parseEspPartitionCsv("", { tableOffset: NaN })).toThrow();
  expect(() => parseEspPartitionCsv("", { tableOffset: 0x8001 })).toThrow();
});

it("accepts case-insensitive names and default data subtype", () => {
  expect(parseEspPartitionCsv("a,DATA,,0x11000,4K,", layout)[0].subtype).toBe(
    6,
  );
  expect(
    parseEspPartitionCsv("a,DATA,NVS,0x11000,4K,", layout)[0].subtype,
  ).toBe(2);
});
it("rejects read-only crash storage", () => {
  expect(() =>
    parseEspPartitionCsv("crash,data,coredump,,64K,readonly", layout),
  ).toThrow();
});
