import { describe, it, expect } from "vitest";
import { validateSerialPort } from "../src/utils/validation.js";

describe("validateSerialPort", () => {
  it("accepts the stable Linux names users are told to use", () => {
    // Rejecting these locked Linux users out of every CLI --port.
    expect(
      validateSerialPort("/dev/serial/by-id/usb-1a86_USB_Serial-if00-port0"),
    ).toBe(true);
    expect(
      validateSerialPort(
        "/dev/serial/by-path/pci-0000:00:14.0-usb-0:1:1.0-port0",
      ),
    ).toBe(true);
    expect(validateSerialPort("/dev/ttyAMA0")).toBe(true);
  });

  it("still accepts the classic names", () => {
    expect(validateSerialPort("/dev/ttyUSB0")).toBe(true);
    expect(validateSerialPort("/dev/ttyACM3")).toBe(true);
    expect(validateSerialPort("/dev/cu.usbserial-0001")).toBe(true);
    expect(validateSerialPort("COM3")).toBe(true);
  });

  it("refuses names that could not be a device or would be unsafe as a filename", () => {
    expect(validateSerialPort("/dev/serial/by-id/../../etc")).toBe(false);
    expect(validateSerialPort("/dev/cu.x; rm -rf ~")).toBe(false);
    expect(validateSerialPort("/etc/passwd")).toBe(false);
    expect(validateSerialPort("")).toBe(false);
  });
});
