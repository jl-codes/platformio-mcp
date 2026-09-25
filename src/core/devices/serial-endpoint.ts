/**
 * Canonical serial endpoint lease keys and metadata revalidation without opening a device.
 * Provides resolveSerialEndpoint; endpoint identity alone does not prove board identity across re-enumeration.
 */
import fs from "node:fs";
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";
import type { DeviceResource } from "./device-lease.js";

/** Internal OS metadata providers, injectable for deterministic cross-platform alias tests. */
export interface SerialEndpointOptions {
  platform?: NodeJS.Platform;
  realpath?: (port: string) => string;
  stat?: (port: string) => { characterDevice: boolean; deviceNumber: bigint };
}
/** A resolved endpoint is a lease scope, not a permission grant or confirmed physical-board binding. */
export interface ResolvedSerialEndpoint {
  readonly requestedPort: string;
  readonly canonicalPort: string;
  readonly resource: Readonly<DeviceResource>;
  readonly identityBasis:
    | "windows-port-name"
    | "unix-device-number"
    | "darwin-serial-pair";
  readonly presence: "unverified" | "character-device";
  readonly survivesReenumeration: false;
  revalidate(): void; // Recheck immediately before open; public adapters must also validate hardware identity.
}
interface EndpointSnapshot {
  canonicalPort: string;
  identity: string;
  deviceNumber?: string;
  identityBasis: ResolvedSerialEndpoint["identityBasis"];
  presence: ResolvedSerialEndpoint["presence"];
}

/** Restrict metadata lookup to bounded names; no shell or serial handle is involved. */
function validatePort(port: string): void {
  if (
    typeof port !== "string" ||
    !port ||
    port.length > 512 ||
    /[\x00-\x1f\x7f]/.test(port)
  )
    throw new PlatformIOError(
      "Invalid serial endpoint name.",
      "SERIAL_ENDPOINT_INVALID",
    );
}

/**
 * Resolve spelling/path aliases to a shared lease key, retaining the requested name for change detection.
 * Unix metadata confirms a character device, not that the device is an authorized UART or intended board.
 * Windows name normalization does not enumerate or confirm presence; trusted discovery must do that.
 */
export function resolveSerialEndpoint(
  port: string,
  options: SerialEndpointOptions = {},
): ResolvedSerialEndpoint {
  validatePort(port);
  const platform = options.platform ?? process.platform;
  const realpath = options.realpath ?? fs.realpathSync.native;
  const stat =
    options.stat ??
    ((target: string) => {
      const metadata = fs.statSync(target, { bigint: true });
      return {
        characterDevice: metadata.isCharacterDevice(),
        deviceNumber: metadata.rdev,
      };
    });
  const snapshot = (): EndpointSnapshot => {
    if (platform === "win32") {
      const localPrefix = "\\\\.\\";
      const name = port.startsWith(localPrefix)
        ? port.slice(localPrefix.length)
        : port;
      const match = /^COM([1-9][0-9]{0,8})$/i.exec(name);
      if (!match)
        throw new PlatformIOError(
          "Expected a COM port or its local device-path spelling.",
          "SERIAL_ENDPOINT_INVALID",
        );
      const canonicalPort = `COM${match[1]}`;
      return {
        canonicalPort,
        identity: `endpoint:win32:${canonicalPort}`,
        identityBasis: "windows-port-name",
        presence: "unverified",
      };
    }
    if (platform !== "linux" && platform !== "darwin")
      throw new PlatformIOError(
        "Serial endpoint identity is unavailable on this platform.",
        "SERIAL_ENDPOINT_UNSUPPORTED",
      );
    if (
      !path.posix.isAbsolute(port) ||
      !path.posix.normalize(port).startsWith("/dev/")
    )
      throw new PlatformIOError(
        "Unix serial endpoints must resolve within /dev.",
        "SERIAL_ENDPOINT_INVALID",
      );
    let canonicalPort: string;
    let metadata: ReturnType<typeof stat>;
    try {
      canonicalPort = realpath(port);
      validatePort(canonicalPort);
      if (
        !path.posix.isAbsolute(canonicalPort) ||
        !path.posix.normalize(canonicalPort).startsWith("/dev/")
      )
        throw new PlatformIOError(
          "Serial alias resolves outside /dev.",
          "SERIAL_ENDPOINT_INVALID",
        );
      metadata = stat(canonicalPort);
    } catch (error) {
      if (error instanceof PlatformIOError) throw error;
      throw new PlatformIOError(
        "Serial endpoint metadata is unavailable.",
        "SERIAL_ENDPOINT_UNAVAILABLE",
      );
    }
    if (
      !metadata.characterDevice ||
      typeof metadata.deviceNumber !== "bigint" ||
      metadata.deviceNumber < 0n ||
      metadata.deviceNumber > 0xffffffffffffffffn
    )
      throw new PlatformIOError(
        "Serial endpoint is not a valid character device.",
        "SERIAL_ENDPOINT_INVALID",
      );
    const deviceNumber = metadata.deviceNumber.toString();
    if (platform === "darwin") {
      const match = /^\/dev\/(?:cu|tty)\.([a-zA-Z0-9_.-]+)$/.exec(
        canonicalPort,
      );
      if (!match)
        throw new PlatformIOError(
          "Expected a Darwin callout/dial-in serial endpoint.",
          "SERIAL_ENDPOINT_INVALID",
        );
      // Conservatively serialize same-suffix callout/dial-in paths even though their device numbers differ.
      return {
        canonicalPort,
        identity: `endpoint:darwin:serial:${match[1]}`,
        deviceNumber,
        identityBasis: "darwin-serial-pair",
        presence: "character-device",
      };
    }
    return {
      canonicalPort,
      identity: `endpoint:linux:char:${deviceNumber}`,
      deviceNumber,
      identityBasis: "unix-device-number",
      presence: "character-device",
    };
  };
  const expected = snapshot();
  return Object.freeze({
    requestedPort: port,
    canonicalPort: expected.canonicalPort,
    resource: Object.freeze({
      kind: "serial" as const,
      identity: expected.identity,
    }),
    identityBasis: expected.identityBasis,
    presence: expected.presence,
    survivesReenumeration: false as const,
    revalidate() {
      const current = snapshot();
      if (
        current.canonicalPort !== expected.canonicalPort ||
        current.identity !== expected.identity ||
        current.deviceNumber !== expected.deviceNumber
      )
        throw new PlatformIOError(
          "Serial endpoint changed after selection; resolve and authorize again.",
          "SERIAL_ENDPOINT_CHANGED",
        );
    },
  });
}
