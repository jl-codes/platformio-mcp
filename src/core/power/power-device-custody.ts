/** Coordinate host-resolved meter and DUT leases for one supervised power operation. */
import {
  DeviceLeaseStore,
  type DeviceLease,
  type DeviceResource,
} from "../devices/device-lease.js";
import type { ProcessDeviceCustody } from "../devices/process-device-custody.js";
import type { SerialPowerHold } from "../serial/session-manager.js";
import { PlatformIOError } from "../../utils/errors.js";

/** Trusted discovery supplies existing lease-domain keys; public arguments must never supply these identities. */
export interface PowerCustodyBinding {
  resources: readonly DeviceResource[];
  revalidate(): Promise<void> | void;
}

/** Retain this inert owner before prepareSpawn so acquisition and rollback failures cannot lose held leases. */
export class PowerDeviceCustody implements ProcessDeviceCustody {
  private readonly resources: DeviceResource[];
  private readonly held = new Set<DeviceLease>();
  private preparing?: Promise<void>;
  private used = false;
  private closing = false;

  /** Meter and powered DUT must both be bound by the host, including endpoint and physical identity scopes. */
  constructor(
    private readonly meter: PowerCustodyBinding,
    private readonly dut: PowerCustodyBinding,
    private readonly store = new DeviceLeaseStore(),
    private readonly dutHold?: SerialPowerHold,
  ) {
    const valid = (binding: PowerCustodyBinding) =>
      binding.resources.length > 0 &&
      binding.resources.length <= 8 &&
      binding.resources.every(
        (resource) =>
          ["serial", "probe", "network"].includes(resource.kind) &&
          typeof resource.identity === "string" &&
          !!resource.identity.trim() &&
          resource.identity.length <= 1024 &&
          !/[\x00-\x1f\x7f]/.test(resource.identity),
      );
    if (!valid(meter) || !valid(dut))
      throw new PlatformIOError(
        "Power operation requires host-bound meter and DUT resources.",
        "POWER_BINDING_INVALID",
      );
    const key = (resource: DeviceResource) =>
      JSON.stringify([resource.kind, resource.identity]);
    const meterKeys = new Set(meter.resources.map(key));
    if (dut.resources.some((resource) => meterKeys.has(key(resource))))
      throw new PlatformIOError(
        "Meter and DUT must be distinct physical resources.",
        "POWER_BINDING_INVALID",
      );
    if (dutHold) {
      const heldKeys = new Set(dutHold.resources.map(key));
      if (
        heldKeys.size !== dut.resources.length ||
        dut.resources.some((resource) => !heldKeys.has(key(resource)))
      )
        throw new PlatformIOError(
          "Trigger monitor does not own the selected DUT resources.",
          "POWER_DUT_SCOPE_MISMATCH",
        );
    }
    this.resources = [
      ...new Map(
        [...meter.resources, ...(dutHold ? [] : dut.resources)].map(
          (resource) => [key(resource), { ...resource }],
        ),
      ).values(),
    ].sort((a, b) => key(a).localeCompare(key(b)));
  }

  /** Acquire all exclusions, refresh both bindings, then persist uncertainty before the caller spawns. */
  prepareSpawn(): Promise<void> {
    if (this.preparing) return this.preparing;
    if (this.used || this.closing)
      return Promise.reject(
        new PlatformIOError(
          "Power custody owner is already used or closing.",
          "POWER_CUSTODY_CLOSED",
        ),
      );
    this.used = true;
    const attempt = this.prepare();
    this.preparing = attempt;
    void attempt
      .finally(() => {
        this.preparing = undefined;
      })
      .catch(() => {});
    return attempt;
  }

  private async prepare(): Promise<void> {
    // Retain each successful acquisition immediately; the process owner handles rollback on any failure.
    for (const resource of this.resources)
      this.held.add(this.store.acquire(resource));
    await this.meter.revalidate();
    await this.dut.revalidate();
    await this.dutHold?.prepareSpawn();
    if (this.closing)
      throw new PlatformIOError(
        "Power custody closed during discovery.",
        "POWER_CUSTODY_CLOSED",
      );
    for (const lease of this.held) this.store.beginHandoff(lease);
  }

  /** Called only after no process started or the supervised process and device cleanup are confirmed. */
  releaseAfterExit(): void {
    this.closing = true;
    if (this.preparing)
      throw new PlatformIOError(
        "Power discovery is still running; custody remains held.",
        "DEVICE_CLEANUP_PENDING",
        { cleanupPending: true },
      );
    let failed = false;
    for (const lease of this.held) {
      try {
        this.store.cancelHandoff(lease);
        this.store.release(lease);
        this.held.delete(lease);
      } catch {
        failed = true;
      }
    }
    try {
      this.dutHold?.releaseAfterExit();
    } catch {
      failed = true;
    }
    if (failed)
      throw new PlatformIOError(
        "Power resource cleanup is incomplete; retry this owner.",
        "DEVICE_CLEANUP_PENDING",
        { cleanupPending: true },
      );
  }
}
