/** Serial endpoint normalization and change detection with injected metadata; no device is opened. */
import { describe, expect, it, vi } from "vitest";
import { resolveSerialEndpoint } from "../src/core/devices/serial-endpoint.js";

describe("serial endpoint identity", () => {
  it("coalesces Windows case and local device-path variants", () => {
    const names = ["COM42", "com42", String.raw`\\.\COM42`];
    const endpoints = names.map((name) =>
      resolveSerialEndpoint(name, { platform: "win32" }),
    );
    for (const endpoint of endpoints) {
      expect(endpoint).toMatchObject({
        canonicalPort: "COM42",
        presence: "unverified",
        survivesReenumeration: false,
      });
      expect(endpoint.resource).toEqual({
        kind: "serial",
        identity: "endpoint:win32:COM42",
      });
      endpoint.revalidate();
    }
  });
  it.each([
    "COM0",
    "COM01",
    "COM-1",
    "COM1:extra",
    " COM1",
    String.raw`\\server\COM1`,
    String.raw`\\.\pipe\serial`,
    "COM1\n",
  ])("rejects ambiguous/non-serial Windows name %s", (name) => {
    expect(() => resolveSerialEndpoint(name, { platform: "win32" })).toThrow();
  });
  it("maps Linux symlinks and duplicate device nodes to their character-device identity", () => {
    const options = {
      platform: "linux" as const,
      realpath: (name: string) =>
        name.includes("by-id") ? "/dev/ttyUSB0" : name,
      stat: () => ({ characterDevice: true, deviceNumber: 188n << 8n }),
    };
    const alias = resolveSerialEndpoint("/dev/serial/by-id/fixture", options);
    const direct = resolveSerialEndpoint("/dev/ttyUSB0", options);
    const duplicate = resolveSerialEndpoint("/dev/another-node", options);
    expect(alias.canonicalPort).toBe("/dev/ttyUSB0");
    expect(alias.resource).toEqual(direct.resource);
    expect(duplicate.resource).toEqual(direct.resource);
    alias.revalidate();
  });
  it("conservatively shares Darwin callout/dial-in keys while retaining their distinct paths", () => {
    const options = {
      platform: "darwin" as const,
      realpath: (name: string) => name,
      stat: (name: string) => ({
        characterDevice: true,
        deviceNumber: name.includes("/cu.") ? 100n : 101n,
      }),
    };
    const callout = resolveSerialEndpoint("/dev/cu.usbmodem123", options);
    const dialin = resolveSerialEndpoint("/dev/tty.usbmodem123", options);
    expect(callout.resource).toEqual(dialin.resource);
    expect(callout.canonicalPort).not.toBe(dialin.canonicalPort);
    expect(callout.resource).not.toEqual(
      resolveSerialEndpoint("/dev/cu.usbmodem456", options).resource,
    );
  });
  it("rejects normal files and aliases outside the device namespace", () => {
    const stat = vi.fn(() => ({ characterDevice: false, deviceNumber: 0n }));
    expect(() =>
      resolveSerialEndpoint("/dev/fixture", {
        platform: "linux",
        realpath: () => "/tmp/file",
        stat,
      }),
    ).toThrow();
    expect(stat).not.toHaveBeenCalled();
    expect(() =>
      resolveSerialEndpoint("/dev/fixture", {
        platform: "linux",
        realpath: (name) => name,
        stat,
      }),
    ).toThrow();
    expect(() =>
      resolveSerialEndpoint("relative", {
        platform: "linux",
        realpath: (name) => name,
        stat,
      }),
    ).toThrow();
    expect(() =>
      resolveSerialEndpoint("/dev/../tmp/file", {
        platform: "linux",
        realpath: (name) => name,
        stat,
      }),
    ).toThrow();
  });
  it("detects alias retargeting or device-number replacement before open", () => {
    let target = "/dev/ttyUSB0",
      deviceNumber = 100n;
    const endpoint = resolveSerialEndpoint("/dev/serial/by-id/fixture", {
      platform: "linux",
      realpath: () => target,
      stat: () => ({ characterDevice: true, deviceNumber }),
    });
    target = "/dev/ttyUSB1";
    expect(() => endpoint.revalidate()).toThrow(
      expect.objectContaining({ code: "SERIAL_ENDPOINT_CHANGED" }),
    );
    target = "/dev/ttyUSB0";
    deviceNumber = 101n;
    expect(() => endpoint.revalidate()).toThrow(
      expect.objectContaining({ code: "SERIAL_ENDPOINT_CHANGED" }),
    );
  });
  it("does not turn metadata errors into absence or a weaker fallback identity", () => {
    expect(() =>
      resolveSerialEndpoint("/dev/ttyUSB0", {
        platform: "linux",
        realpath: () => {
          throw new Error("denied");
        },
      }),
    ).toThrow(expect.objectContaining({ code: "SERIAL_ENDPOINT_UNAVAILABLE" }));
    expect(() =>
      resolveSerialEndpoint("COM1", { platform: "freebsd" }),
    ).toThrow(expect.objectContaining({ code: "SERIAL_ENDPOINT_UNSUPPORTED" }));
  });
});
