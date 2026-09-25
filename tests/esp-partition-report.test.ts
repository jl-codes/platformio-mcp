/** Partition reports distinguish offline capacity evidence from actual device contents. */
import { expect, it } from "vitest";
import {
  compareEspPartitions,
  projectEspPartition,
  reportEspPartitions,
} from "../src/core/esp-partition-report.js";
import type { EspPartition } from "../src/core/esp-partitions.js";
const layout = { tableOffset: 0x8000, flashSize: 0x400000 };
const app: EspPartition = {
  name: "factory",
  type: 0,
  subtype: 0,
  offset: 0x10000,
  size: 0x100000,
  flags: 0,
};
const nvs: EspPartition = {
  name: "nvs",
  type: 1,
  subtype: 2,
  offset: 0x9000,
  size: 0x4000,
  flags: 0,
};
it("detects flag-only changes rather than declaring the device identical", () => {
  expect(
    compareEspPartitions([app], [{ ...app, flags: 1 }], layout),
  ).toMatchObject([{ name: "factory", kind: "changed", fields: ["flags"] }]);
});
it("reports missing, changed and extra partitions in stable order", () => {
  expect(
    compareEspPartitions(
      [nvs, app],
      [
        { ...app, size: 0x200000 },
        { ...nvs, name: "config" },
      ],
      layout,
    ).map(({ name, kind }) => ({ name, kind })),
  ).toEqual([
    { name: "nvs", kind: "missing_on_device" },
    { name: "factory", kind: "changed" },
    { name: "config", kind: "extra_on_device" },
  ]);
});
it("preserves unknown flag bits and vendor identifiers in reports", () => {
  expect(
    projectEspPartition({
      ...nvs,
      type: 0x40,
      subtype: 0x91,
      flags: 0x80000003,
    }),
  ).toMatchObject({
    type: "0x40",
    subtype: "0x91",
    flags: ["encrypted", "readonly"],
    unknown_flags: 0x80000000,
  });
});
it("does not infer firmware fit when no image was supplied", () => {
  const result = reportEspPartitions([nvs, app], layout);
  expect(result).toMatchObject({
    ok: true,
    firmware_size: null,
    application_fit: [],
    evidence: "offline_layout",
  });
  expect(result.issues.some((issue) => issue.code.startsWith("app_"))).toBe(
    false,
  );
});
it("distinguishes image overflow from valid layout geometry", () => {
  const result = reportEspPartitions([nvs, app], layout, 0x110000);
  expect(result.ok).toBe(false);
  expect(result.issues).toContainEqual(
    expect.objectContaining({ code: "app_too_big", severity: "error" }),
  );
  expect(result.application_fit).toMatchObject([
    { name: "factory", fits: false },
  ]);
});
it("reports supplied flash capacity overruns without pretending to measure flash", () => {
  const result = reportEspPartitions([app], { ...layout, flashSize: 0x80000 });
  expect(result).toMatchObject({ ok: false, flash_size: 0x80000 });
  expect(result.issues).toContainEqual(
    expect.objectContaining({ code: "exceeds_flash" }),
  );
});
it("checks each application slot and missing OTA selection metadata", () => {
  const result = reportEspPartitions(
    [
      { ...app, subtype: 16 },
      { ...app, name: "slot1", subtype: 17, offset: 0x110000, size: 0x80000 },
    ],
    layout,
    0x90000,
  );
  expect(result.application_fit.map((slot) => slot.fits)).toEqual([
    true,
    false,
  ]);
  expect(result.issues.map((issue) => issue.code)).toEqual(
    expect.arrayContaining([
      "ota_without_otadata",
      "uneven_ota_slots",
      "app_too_big",
    ]),
  );
});
it("keeps absent flash capacity unknown", () => {
  expect(reportEspPartitions([app], { tableOffset: 0x8000 })).toMatchObject({
    flash_size: null,
  });
});
it.each([-1, NaN, Infinity, 0x100000000])(
  "rejects invalid firmware length %s",
  (size) => {
    expect(() => reportEspPartitions([app], layout, size)).toThrow();
  },
);
it("rejects duplicate names before comparison can collapse them", () => {
  expect(() =>
    compareEspPartitions([app, { ...app, offset: 0x110000 }], [app], layout),
  ).toThrow();
});
