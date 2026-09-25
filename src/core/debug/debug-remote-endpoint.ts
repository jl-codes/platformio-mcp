/** Normalize externally managed debugger endpoints without DNS or transport side effects. */
import { isIP } from "node:net";
import { PlatformIOError } from "../../utils/errors.js";

/** Parse a pinned numeric TCP endpoint; hostnames require a separate authorized resolution path. */
export function parseRemoteDebugEndpoint(value: string | null) {
  const invalid = (): never => {
    throw new PlatformIOError(
      "Select a numeric unicast debugger endpoint and port.",
      "DEBUG_ENDPOINT_UNSUPPORTED",
    );
  };
  if (typeof value !== "string" || value.length > 128) return invalid();
  const match = /^(?:\[([0-9a-fA-F:]+)\]|([^:\s]*)):([0-9]{1,5})$/.exec(value);
  if (!match) return invalid();
  let host = match[1] ?? match[2];
  const port = Number(match[3]);
  if (!host || host === "localhost") host = "127.0.0.1";
  if (port < 1 || port > 65535 || !isIP(host)) return invalid();
  if (isIP(host) === 6) {
    host = new URL("http://[" + host + "]/").hostname.slice(1, -1);
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
    if (mapped) {
      const high = parseInt(mapped[1], 16),
        low = parseInt(mapped[2], 16);
      host = [high >>> 8, high & 255, low >>> 8, low & 255].join(".");
    }
  }
  if (isIP(host) === 4) {
    const first = Number(host.split(".")[0]);
    if (first === 0 || first >= 224) return invalid();
  } else if (host === "::" || host.startsWith("ff")) return invalid();
  return Object.freeze({
    host,
    port,
    resource: Object.freeze({
      kind: "network" as const,
      identity: `debug-tcp:${host}:${port}`,
    }),
  });
}

/** Canonicalize an operator-selected TCP address without resolving project-controlled hostnames. */
export function parseRemoteDebugSelection(value: string | null) {
  try {
    return parseRemoteDebugEndpoint(value);
  } catch (error) {
    if (typeof value !== "string" || value.length > 260) throw error;
    const match = /^([a-zA-Z0-9.-]+):([0-9]{1,5})$/.exec(value);
    if (!match) throw error;
    const host = match[1].toLowerCase().replace(/\.$/, "");
    const port = Number(match[2]);
    if (
      host.length > 253 ||
      !/[a-z]/.test(host) ||
      port < 1 ||
      port > 65535 ||
      host
        .split(".")
        .some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    )
      throw error;
    if (host === "localhost")
      return parseRemoteDebugEndpoint(`127.0.0.1:${port}`);
    return Object.freeze({
      host,
      port,
      resource: Object.freeze({
        kind: "network" as const,
        identity: `debug-dns:${host}:${port}`,
      }),
    });
  }
}
