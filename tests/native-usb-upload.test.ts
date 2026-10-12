/** Regression coverage for native USB uploads, selectors, and write safety (issue #39). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UploadFirmwareParamsSchema, type SerialDevice } from "../src/types.js";
import {
  mapVidPidToBoard,
  mapVidPidToPlatform,
} from "../src/utils/hardware-maps.js";
import {
  resolveTarget,
  verifyTargetBinding,
} from "../src/core/target-resolution.js";
import { uploadFirmwareCore } from "../src/core/flash.js";
import {
  dispatchAuthorizedAction,
  authorizeAction,
} from "../src/core/action-dispatcher.js";
import { approveRequest } from "../src/core/policy/approvals.js";

const mocks = vi.hoisted(() => ({
  devices: vi.fn(),
  upload: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("../src/core/devices.js", () => ({ listDevicesCore: mocks.devices }));
vi.mock("../src/tools/upload.js", () => ({ uploadFirmware: mocks.upload }));
vi.mock("../src/utils/lock-manager.js", () => ({
  hardwareLockManager: {
    withImplicitLock: mocks.lock,
    requireLock: vi.fn(),
  },
}));

let root: string;
const native: SerialDevice = {
  port: "/dev/cu.usbmodem101",
  description: "USB JTAG/serial debug unit",
  hwid: "USB VID:PID=303A:1001 SER=S3FIRST LOCATION=1-2",
};
const noise: SerialDevice = {
  port: "/dev/cu.debug-console",
  description: "n/a",
  hwid: "n/a",
};
beforeEach(() => {
  vi.resetAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-native-upload-"));
  vi.stubEnv("PIO_MCP_DATA_DIR", root);
  fs.writeFileSync(
    path.join(root, "platformio.ini"),
    "[env:native]\nplatform = espressif32\nboard = um_nanos3\n",
  );
  mocks.devices.mockResolvedValue([noise, native]);
  mocks.lock.mockImplementation((execute) => execute());
  mocks.upload.mockResolvedValue({ success: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

it.each(["um_nanos3", "arduino_nano_esp32"])(
  "resolves raw native USB metadata for %s beside macOS noise",
  async (board) => {
    fs.writeFileSync(
      path.join(root, "platformio.ini"),
      `[env:native]\nplatform = espressif32\nboard = ${board}\n`,
    );
    const result = await resolveTarget({ projectDir: root });
    expect(result).toMatchObject({
      success: true,
      port: native.port,
      board,
      confidence: "medium",
    });
    expect(result.binding?.board).toBe(board);
  },
);

it.each(["USB VID:PID=303A:1001", "USB VID_303a&PID_1001"])(
  "recognizes a platform but never invents an exact board for %s",
  (hwid) => {
    expect(mapVidPidToPlatform(hwid)).toBe("espressif32");
    expect(
      mapVidPidToBoard(hwid, "Arduino Nano USB JTAG/serial debug unit"),
    ).toBeUndefined();
  },
);

it.each(["port", "uploadPort", "upload_port"])(
  "passes %s through schema and core to the discovered upload path",
  async (key) => {
    const params = UploadFirmwareParamsSchema.parse({
      projectDir: root,
      [key]: "/dev/tty.usbmodem101",
    });
    expect(params.port).toBe("/dev/tty.usbmodem101");
    await uploadFirmwareCore(params);
    expect(mocks.upload).toHaveBeenCalledWith(
      root,
      native.port,
      "native",
      undefined,
      undefined,
      undefined,
      undefined,
    );
  },
);

it("rejects conflicting selectors instead of silently choosing one", () => {
  for (const selectors of [
    { port: native.port, uploadPort: "/dev/cu.usbmodem102" },
    { uploadPort: native.port, upload_port: "/dev/cu.usbmodem102" },
    { port: native.port, upload_port: "/dev/cu.usbmodem102" },
  ])
    expect(() =>
      UploadFirmwareParamsSchema.parse({ projectDir: root, ...selectors }),
    ).toThrow(/Conflicting/);
  expect(
    UploadFirmwareParamsSchema.parse({
      projectDir: root,
      port: native.port,
      uploadPort: "/dev/tty.usbmodem101",
    }).port,
  ).toBe(native.port);
});

it.each(["port", "uploadPort", "upload_port"])("rejects an empty %s", (key) => {
  expect(() =>
    UploadFirmwareParamsSchema.parse({ projectDir: root, [key]: "" }),
  ).toThrow();
});

it("does not discard legitimate devices just because hardware IDs are unavailable", async () => {
  expect(
    await resolveTarget({ projectDir: root }, [
      { ...native, hwid: "n/a" },
      noise,
    ]),
  ).toMatchObject({ success: true });
});

it("does not match a different macOS suffix or fall back when an explicit port is absent", async () => {
  expect(
    await resolveTarget({ projectDir: root, port: "/dev/tty.usbmodem102" }),
  ).toMatchObject({ status: "unavailable" });
});

it("keeps two native USB devices ambiguous and never locks or writes", async () => {
  mocks.devices.mockResolvedValue([
    noise,
    native,
    {
      ...native,
      port: "/dev/cu.usbmodem102",
      hwid: native.hwid.replace("S3FIRST", "S3SECOND"),
    },
  ]);
  await expect(uploadFirmwareCore({ projectDir: root })).rejects.toMatchObject({
    code: "AMBIGUOUS_TARGET",
  });
  expect(mocks.lock).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
});

it("does not merge normalized paths with conflicting identities", async () => {
  mocks.devices.mockResolvedValue([
    native,
    {
      ...native,
      port: "/dev/tty.usbmodem101",
      hwid: native.hwid.replace("S3FIRST", "S3SECOND"),
    },
  ]);
  expect(
    await resolveTarget({ projectDir: root, port: native.port }),
  ).toMatchObject({ status: "ambiguous" });
});

it("does not infer a native ESP32 USB device for an incompatible configured platform", async () => {
  fs.writeFileSync(
    path.join(root, "platformio.ini"),
    "[env:native]\nplatform = atmelavr\nboard = uno\n",
  );
  expect(await resolveTarget({ projectDir: root })).toMatchObject({
    status: "unavailable",
  });
});

it("preserves serial identity revalidation after path normalization", async () => {
  const result = await resolveTarget({
    projectDir: root,
    port: "/dev/tty.usbmodem101",
  });
  await expect(
    verifyTargetBinding(result.binding!, {
      projectDir: root,
      environment: "native",
      devices: [{ ...native, port: "/dev/cu.usbmodem102" }],
    }),
  ).resolves.toMatchObject({ valid: true, portChanged: true });
  await expect(
    verifyTargetBinding(result.binding!, {
      projectDir: root,
      environment: "native",
      devices: [
        { ...native, hwid: native.hwid.replace("S3FIRST", "S3SECOND") },
      ],
    }),
  ).rejects.toMatchObject({ code: "STALE_TARGET_BINDING" });
});

it.each(["uploadPort", "upload_port"])(
  "requires an explicit approval bound to %s before any upload",
  async (key) => {
    const args = { projectDir: root, [key]: native.port };
    const context = { workspaceDir: root, actor: "agent" as const };
    const execute = () =>
      uploadFirmwareCore(UploadFirmwareParamsSchema.parse(args));
    await expect(
      dispatchAuthorizedAction("upload_firmware", args, context, execute),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(mocks.upload).not.toHaveBeenCalled();
    const pending = await authorizeAction("upload_firmware", args, context);
    approveRequest(pending.approvalId!);
    await expect(
      dispatchAuthorizedAction(
        "upload_firmware",
        {
          ...args,
          [key]: "/dev/cu.usbmodem102",
          approvalId: pending.approvalId,
        },
        context,
        execute,
      ),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(mocks.upload).not.toHaveBeenCalled();
    await dispatchAuthorizedAction(
      "upload_firmware",
      { ...args, approvalId: pending.approvalId },
      context,
      execute,
    );
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  },
);

it.each([
  "espressif32@6.9.0",
  "platformio/espressif32@^6.9.0",
  "https://example.invalid/custom-platform.zip",
])(
  "retains native USB fallback with platform selector %s",
  async (platform) => {
    fs.writeFileSync(
      path.join(root, "platformio.ini"),
      `[env:native]\nplatform = ${platform}\nboard = um_nanos3\n`,
    );
    expect(await resolveTarget({ projectDir: root })).toMatchObject({
      success: true,
    });
  },
);

it("keeps an unknown peer ambiguous despite an Espressif platform hint", async () => {
  expect(
    await resolveTarget({ projectDir: root }, [
      native,
      {
        port: "/dev/cu.usbserial-other",
        hwid: "n/a",
        description: "Unknown adapter",
      },
    ]),
  ).toMatchObject({ status: "ambiguous" });
});
