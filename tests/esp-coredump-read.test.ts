/** Core partition reads validate selection before device access and preserve empty-dump semantics. */
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../src/core/esp-flash-read.js", () => ({ readEspFlash: vi.fn() }));
import { readEspFlash } from "../src/core/esp-flash-read.js";
import { readEspCoredumpPartition } from "../src/core/analysis/esp-coredump-read.js";
const request = {
  projectDir: "project",
  port: "port",
  partition: {
    name: "crash",
    type: 1,
    subtype: 3,
    offset: 0x310000,
    size: 4096,
    flags: 0,
  },
};
beforeEach(() => vi.clearAllMocks());
it.each([{ type: 0 }, { flags: 1 }, { offset: 1 }, { size: 17 * 1024 * 1024 }])(
  "rejects invalid or encrypted partition before I/O",
  async (change) => {
    await expect(
      readEspCoredumpPartition({
        ...request,
        partition: { ...request.partition, ...change },
      }),
    ).rejects.toBeDefined();
    expect(readEspFlash).not.toHaveBeenCalled();
  },
);
it("reads the selected offset and treats erased flash as no recorded crash", async () => {
  vi.mocked(readEspFlash).mockResolvedValueOnce({
    bytes: Buffer.alloc(4096, 255),
    sha256: "fixture",
    port: "canonical",
    offset: 0x310000,
    length: 4096,
    logPath: "log",
  });
  const result = await readEspCoredumpPartition({
    ...request,
    approvalId: "device",
    commandApprovalId: "host",
  });
  expect(result).toMatchObject({
    present: false,
    source: { offset: 0x310000, port: "canonical" },
  });
  expect(result.bytes).toEqual(Buffer.alloc(4096, 255));
  expect(readEspFlash).toHaveBeenCalledWith(
    expect.objectContaining({
      offset: 0x310000,
      length: 4096,
      approvalId: "device",
      commandApprovalId: "host",
    }),
    {},
  );
});
