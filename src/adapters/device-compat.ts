/**
 * Reference serial-device presentation without opening ports or asserting hardware identity.
 * Provides projectCompatibilityDevices for authorized discovery adapters.
 */
import type { SerialDevice } from "../types.js";

// Hint patterns adapted from the pinned reference devices.py; these are not identity checks.
const DEVELOPMENT_BOARD_HINT =
  /CP210|CH34|CH9102|FTDI|FT23|Silicon Labs|SLAB|usbserial|usbmodem|wchusbserial|ttyUSB|ttyACM|ESP|Arduino|STLink|ST-Link|JLink|J-Link|CMSIS|DAPLink|Espressif|USB/i;
const NOISE_PORT_HINT = /Bluetooth|debug-console|Jabra|AirPods|iPhone/i;

/**
 * Preserve the reference row shape and stable likely-first ordering.
 * Claim records and inferred board identities are deliberately not copied into public rows.
 * Monitor sessions must be supplied separately by the caller-owned session service.
 */
export function projectCompatibilityDevices(devices: readonly SerialDevice[]) {
  const rows = devices.map((device) => {
    const description = `${device.description} ${device.hwid} ${device.port}`;
    return {
      port: device.port,
      description: device.description,
      hwid: device.hwid,
      likely_dev_board:
        DEVELOPMENT_BOARD_HINT.test(description) &&
        !NOISE_PORT_HINT.test(description),
    };
  });
  rows.sort(
    (left, right) =>
      Number(right.likely_dev_board) - Number(left.likely_dev_board),
  );
  const likely = rows
    .filter((row) => row.likely_dev_board)
    .map((row) => row.port);
  return {
    ok: true as const,
    summary: `${rows.length} serial port(s). ${likely.length ? `Likely dev boards: ${likely.join(", ")}.` : "No port looks like a USB dev board; check the cable (data, not charge-only) and drivers."}`,
    devices: rows,
    likely_ports: likely,
  };
}
