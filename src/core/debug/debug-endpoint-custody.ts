/** Coordinate local debugger TCP endpoints with physical probe custody and retryable cleanup. */
import net from "node:net";
import { DeviceLeaseStore, type DeviceLease } from "../devices/device-lease.js";
import type { ProcessDeviceCustody } from "../devices/process-device-custody.js";
import { PlatformIOError } from "../../utils/errors.js";
import { parseRemoteDebugEndpoint } from "./debug-remote-endpoint.js";

/** A local bind detects existing listeners without connecting to or commanding another server. */
export async function assertDebugEndpointAvailable(
  port: number,
): Promise<void> {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error) =>
      reject(
        new PlatformIOError(
          "The configured local debugger endpoint is unavailable.",
          "DEBUG_ENDPOINT_BUSY",
          { port, reason: (error as NodeJS.ErrnoException).code },
        ),
      ),
    );
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
}

/** Inert until prepareSpawn; the process owner retains this capability before any lease is allocated. */
export class DebugEndpointCustody implements ProcessDeviceCustody {
  private endpointLease?: DeviceLease;
  private probe?: ProcessDeviceCustody;
  private started = false;
  private closed = false;
  private preparing = false;
  private readonly endpoint;
  /** Host-only callbacks obtain physical ownership and supplement real endpoint availability checks in fixtures. */
  constructor(
    private readonly port: number,
    private readonly acquireProbe: () => Promise<ProcessDeviceCustody>,
    private readonly store = new DeviceLeaseStore(),
    private readonly check = assertDebugEndpointAvailable,
    endpointHost = "127.0.0.1", // Host-selected address; public requests never supply custody capabilities.
  ) {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new PlatformIOError(
        "Invalid local debugger port.",
        "DEBUG_ENDPOINT_UNSUPPORTED",
      );
    this.endpoint = parseRemoteDebugEndpoint(
      `${endpointHost.includes(":") ? `[${endpointHost}]` : endpointHost}:${port}`,
    );
  }
  /** Claim the shared endpoint before the probe and recheck the listener immediately before process handoff. */
  async prepareSpawn(): Promise<void> {
    if (this.started || this.closed)
      throw new PlatformIOError(
        "Debugger endpoint custody cannot be reused.",
        "DEBUG_CUSTODY_REUSED",
      );
    this.started = true;
    this.preparing = true;
    try {
      this.endpointLease = this.store.acquire(this.endpoint.resource);
      await this.check(this.port);
      this.probe = await this.acquireProbe();
      await this.probe.prepareSpawn();
      await this.check(this.port);
      this.store.beginHandoff(this.endpointLease);
    } finally {
      this.preparing = false;
    }
  }
  /** Call only after no child started or both owned descendant groups have closed; failed release stays retryable. */
  releaseAfterExit(): void {
    if (this.preparing)
      throw new PlatformIOError(
        "Debugger startup is still acquiring custody.",
        "DEVICE_CLEANUP_PENDING",
        { cleanupPending: true },
      );
    this.closed = true;
    if (this.probe) {
      this.probe.releaseAfterExit();
      this.probe = undefined;
    }
    if (this.endpointLease) {
      this.store.cancelHandoff(this.endpointLease);
      this.store.release(this.endpointLease);
      this.endpointLease = undefined;
    }
  }
}

/** Reserve an externally managed endpoint plus host-bound target custody without probing or owning its server. */
export function createRemoteDebugEndpointCustody(
  endpoint: ReturnType<typeof parseRemoteDebugEndpoint>,
  acquireTarget: () => Promise<ProcessDeviceCustody>,
  store = new DeviceLeaseStore(),
): ProcessDeviceCustody {
  // A remote server is expected to be listening. Target identity/revalidation still
  // comes from the host binding; knowing a network address is not physical custody.
  return new DebugEndpointCustody(
    endpoint.port,
    acquireTarget,
    store,
    async () => {},
    endpoint.host,
  );
}
