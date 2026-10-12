/** Shared serial selector normalization and non-development port hints. */

/** Presentation hints only; neither these names nor USB IDs prove identity. */
export const NOISE_PORT_HINT =
  /Bluetooth|blth|debug-console|Jabra|AirPods|iPhone/i;

/** Compare macOS callout/dial-in names without changing the discovered upload path. */
export function normalizeSerialPort(port: string): string {
  return port.replace(/^\/dev\/tty\.(?=.+)/u, "/dev/cu.");
}
