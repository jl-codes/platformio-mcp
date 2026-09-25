/**
 * Authorized native serial enumeration with bounded results and concurrency.
 * Provides NativeSerialDiscovery; enumeration never opens a serial port.
 */
import { loadSerialBackend } from "../serial/serial-backend.js";
import { z } from "zod";
import { PlatformIOError } from "../../utils/errors.js";
import type { SerialDiscoveryRecord } from "./serial-discovery-binding.js";

const field = z
  .string()
  .max(512)
  .refine((value) => !/[\x00-\x1f\x7f]/.test(value));
const recordsSchema = z
  .array(
    z.object({
      path: field.refine((value) => value.length > 0),
      vendorId: z
        .string()
        .regex(/^[0-9a-f]{4}$/i)
        .optional(),
      productId: z
        .string()
        .regex(/^[0-9a-f]{4}$/i)
        .optional(),
      serialNumber: field.optional(),
    }),
  )
  .max(1024);

/** Trusted integration dependencies; callers cannot supply these through tool arguments. */
export interface NativeSerialDiscoveryOptions {
  authorize: () => Promise<() => void>;
  timeoutMs?: number;
  load?: () => Promise<{ list: () => Promise<unknown> }>;
}

/** Load the optional maintained backend only after authorization. */
async function loadBackend(): Promise<{ list: () => Promise<unknown> }> {
  if (Number(process.versions.node.split(".")[0]) < 20)
    throw new PlatformIOError(
      "Native serial discovery requires Node 20 or newer.",
      "SERIAL_BACKEND_UNAVAILABLE",
    );
  try {
    const { SerialPort } = await loadSerialBackend();
    return { list: () => SerialPort.list() };
  } catch {
    throw new PlatformIOError(
      "The native serial backend is unavailable.",
      "SERIAL_BACKEND_UNAVAILABLE",
    );
  }
}

/**
 * One native enumeration may be outstanding per provider, including after caller timeout.
 * A timeout cannot cancel an OS enumeration; retaining the slot prevents repeated timed-out work accumulating.
 * The adapter supplies inspection authorization and its revision guard on every call.
 */
export class NativeSerialDiscovery {
  private active = false;
  private readonly timeoutMs: number;
  private readonly authorize: NativeSerialDiscoveryOptions["authorize"];
  private readonly load: NonNullable<NativeSerialDiscoveryOptions["load"]>;

  /** Snapshot dependencies and validate limits before invoking native code. */
  constructor(options: NativeSerialDiscoveryOptions) {
    this.timeoutMs = options.timeoutMs ?? 5000;
    if (
      !Number.isSafeInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > 30000 ||
      typeof options.authorize !== "function"
    )
      throw new PlatformIOError(
        "Invalid serial discovery configuration.",
        "SERIAL_DISCOVERY_INVALID",
      );
    this.authorize = options.authorize;
    this.load = options.load ?? loadBackend;
  }

  /** Return only validated identity fields; permissions errors and enumeration failures never become an empty list. */
  async list(): Promise<readonly SerialDiscoveryRecord[]> {
    if (this.active)
      throw new PlatformIOError(
        "Serial discovery is already pending.",
        "SERIAL_DISCOVERY_BUSY",
      );
    this.active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    const work = (async () => {
      try {
        const guard = await this.authorize();
        if (typeof guard !== "function")
          throw new PlatformIOError(
            "Discovery authorization returned no guard.",
            "SERIAL_AUTHORIZATION_REQUIRED",
          );
        if (expired) return [];
        guard();
        const backend = await this.load();
        if (expired) return [];
        guard();
        const raw = await backend.list();
        if (expired) return [];
        guard();
        const parsed = recordsSchema.safeParse(raw);
        if (!parsed.success)
          throw new PlatformIOError(
            "Native discovery returned invalid metadata.",
            "SERIAL_DISCOVERY_INVALID",
          );
        return Object.freeze(
          parsed.data.map((record) => Object.freeze(record)),
        );
      } catch (error) {
        if (error instanceof PlatformIOError) throw error;
        throw new PlatformIOError(
          "Native serial enumeration failed.",
          "SERIAL_DISCOVERY_FAILED",
        );
      } finally {
        this.active = false;
      }
    })();
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            expired = true;
            reject(
              new PlatformIOError(
                "Native serial enumeration timed out.",
                "SERIAL_DISCOVERY_TIMEOUT",
              ),
            );
          }, this.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
