/** Project-specific table offsets must come from unambiguous evidence. */
import { expect, it } from "vitest";
import {
  partitionOffsetFromSdkconfig,
  partitionOffsetFromFlashImages,
  resolvePartitionOffset,
} from "../src/core/esp-partition-location.js";
import { parseProjectEnvironments } from "../src/core/project-inspection.js";
it("extracts a custom sdkconfig offset without applying framework defaults", () => {
  expect(
    partitionOffsetFromSdkconfig(
      "# CONFIG_PARTITION_TABLE_OFFSET=0x8000\nCONFIG_PARTITION_TABLE_OFFSET=0x10000\n",
    ),
  ).toEqual({
    source: "sdkconfig:CONFIG_PARTITION_TABLE_OFFSET",
    offset: 0x10000,
  });
  expect(partitionOffsetFromSdkconfig("CONFIG_OTHER=y")).toBeNull();
  expect(() => resolvePartitionOffset([])).toThrow();
});
it.each([
  "CONFIG_PARTITION_TABLE_OFFSET=0x8001",
  "CONFIG_PARTITION_TABLE_OFFSET=0x8000\nCONFIG_PARTITION_TABLE_OFFSET=0x9000",
  "CONFIG_PARTITION_TABLE_OFFSET=execute()",
])("rejects invalid or duplicate settings", (text) => {
  expect(() => partitionOffsetFromSdkconfig(text)).toThrow();
});
it("matches the selected binary by full normalized path, not basename", () => {
  const images = [
    { path: "/one/partitions.bin", offset: "0x8000" },
    { path: "/two/partitions.bin", offset: "0x10000" },
  ];
  expect(
    partitionOffsetFromFlashImages(
      images,
      "/two/partitions.bin",
      (value) => value,
    )?.offset,
  ).toBe(0x10000);
  expect(
    partitionOffsetFromFlashImages(
      images,
      "/three/partitions.bin",
      (value) => value,
    ),
  ).toBeNull();
});
it("rejects contradictory generation and upload offsets", () => {
  expect(() =>
    resolvePartitionOffset(
      [{ source: "sdkconfig", offset: 0x10000 }],
      "0x8000",
    ),
  ).toThrow();
  expect(
    resolvePartitionOffset(
      [{ source: "sdkconfig", offset: 0x10000 }],
      "0x10000",
    ).tableOffset,
  ).toBe(0x10000);
});
it("preserves computed partition and board settings in environment reports", () => {
  const result = parseProjectEnvironments(
    JSON.stringify([
      [
        "env:custom",
        [
          ["board_build.partitions", "custom.csv"],
          ["board_upload.partition_table_offset", "0x10000"],
          ["board_upload.flash_size", "8MB"],
          ["board_build.mcu", "esp32s3"],
        ],
      ],
    ]),
  );
  expect(result.envs[0]).toMatchObject({
    partitionTable: "custom.csv",
    partitionTableUploadOffset: "0x10000",
    flashSize: "8MB",
    mcu: "esp32s3",
  });
});
