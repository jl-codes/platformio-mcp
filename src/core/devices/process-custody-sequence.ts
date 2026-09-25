/** Keep one device lease across sequential capture/upload children without an ownership gap. */
import { PlatformIOError } from "../../utils/errors.js";
import type { ProcessDeviceCustody } from "./process-device-custody.js";

/** A private child phase is released only after its process owner confirms closure. */
interface CustodyPhase {
  state: "created" | "preparing" | "prepared" | "closed";
}

/**
 * Split one host-held custody capability into sequential child phases. The parent handoff remains
 * pending between children and is released only by finish(). Callers must supply fresh policy and
 * device-selection validation for every phase; this class neither grants permission nor spawns.
 */
export class ProcessCustodySequence {
  private active?: CustodyPhase;
  private parentPrepared = false;
  private sealed = false;
  private released = false;
  private preparationFailed = false;

  constructor(
    private readonly parent: ProcessDeviceCustody,
    private readonly revalidate: () => void | Promise<void>,
  ) {}

  /** Reserve exactly one child phase; parallel and late consumers cannot share the capability. */
  nextPhase(): ProcessDeviceCustody {
    if (this.sealed || this.active || this.preparationFailed)
      throw new PlatformIOError(
        "Device sequence cannot start another process.",
        "DEVICE_SEQUENCE_UNAVAILABLE",
      );
    const phase: CustodyPhase = { state: "created" };
    this.active = phase;
    return {
      prepareSpawn: async () => {
        if (this.sealed || this.active !== phase || phase.state !== "created")
          throw new PlatformIOError(
            "Device process phase is no longer available.",
            "DEVICE_SEQUENCE_UNAVAILABLE",
          );
        phase.state = "preparing";
        try {
          await this.revalidate();
          if (this.sealed || phase.state !== "preparing")
            throw new PlatformIOError(
              "Device sequence was closed before spawn.",
              "DEVICE_SEQUENCE_UNAVAILABLE",
            );
          if (!this.parentPrepared) {
            await this.parent.prepareSpawn();
            this.parentPrepared = true;
          }
          if (this.sealed || phase.state !== "preparing")
            throw new PlatformIOError(
              "Device sequence was closed before spawn.",
              "DEVICE_SEQUENCE_UNAVAILABLE",
            );
          phase.state = "prepared";
        } catch (error) {
          this.preparationFailed = true;
          // prepareSpawn has settled, so the owner may confirm no child started via releaseAfterExit.
          phase.state = "created";
          throw error;
        }
      },
      releaseAfterExit: () => {
        if (phase.state === "closed") return;
        if (phase.state === "preparing")
          throw new PlatformIOError(
            "Device preparation is still running.",
            "DEVICE_CLEANUP_PENDING",
            { cleanupPending: true },
          );
        phase.state = "closed";
        if (this.active === phase) this.active = undefined;
      },
    };
  }

  /** Release the parent only after all child closure is confirmed; cleanup failures remain retryable. */
  finish(): void {
    if (this.released) return;
    this.sealed = true;
    // No prepare call is in flight for a created phase; invalidate any late consumer before release.
    if (this.active?.state === "created") {
      this.active.state = "closed";
      this.active = undefined;
    }
    if (this.active)
      throw new PlatformIOError(
        "Device process closure is unconfirmed.",
        "DEVICE_CLEANUP_PENDING",
        { cleanupPending: true },
      );
    try {
      this.parent.releaseAfterExit();
      this.released = true;
    } catch (error) {
      throw new PlatformIOError(
        error instanceof Error
          ? error.message
          : "Device sequence cleanup failed.",
        "DEVICE_CLEANUP_PENDING",
        { cleanupPending: true },
      );
    }
  }
}
