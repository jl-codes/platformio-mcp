/** Bounded PPK2 bridge protocol validation; reported device cleanup never substitutes for process ownership proof. */
import { z } from "zod";
import { StringDecoder } from "node:string_decoder";
import { PlatformIOError } from "../../utils/errors.js";

/** Host-resolved meter parameters; authorization and physical DUT binding must precede execution. */
export const Ppk2RequestSchema = z
  .object({
    port: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[^\x00-\x1f\x7f]+$/),
    mode: z.enum(["ampere", "source"]),
    voltageMv: z.number().int().min(800).max(5000),
    currentLimitMa: z.number().finite().positive().max(1000),
    seconds: z.number().finite().positive().max(600),
  })
  .strict()
  .refine((input) => input.mode !== "source" || input.currentLimitMa <= 600);
const finishedSchema = z
  .object({
    event: z.literal("finished"),
    outcome: z
      .string()
      .regex(/^(?:complete|PPK2_[A-Z_]+)$/)
      .max(80),
    sampleCount: z.number().int().nonnegative().max(60100000),
    partialWindowSamples: z.number().int().min(0).max(999),
    emittedWindows: z.number().int().min(0).max(60100),
    unreportedWindows: z.number().int().min(0).max(100),
    durationSeconds: z.number().finite().min(0).max(630),
    partialRawBytes: z.number().int().min(0).max(3),
    deviceTouched: z.boolean(),
    outputOffWritten: z.boolean(),
    outputOffPhysicallyVerified: z.literal(false),
    powerMayBeOn: z.boolean(),
    measurementStopped: z.boolean(),
    serialClosed: z.boolean(),
  })
  .strict();
const eventSchema = z.discriminatedUnion("event", [
  z
    .object({
      event: z.literal("started"),
      mode: z.enum(["ampere", "source"]),
      sampleRateHz: z.literal(100000),
      windowSamples: z.literal(1000),
      currentLimitKind: z.literal("software_trip"),
    })
    .strict(),
  z
    .object({
      event: z.literal("samples"),
      currentMa: z
        .array(z.number().finite().min(-1000).max(1000))
        .min(1)
        .max(100),
    })
    .strict(),
  z
    .object({
      event: z.literal("unavailable"),
      code: z.enum([
        "PPK2_API_MISSING",
        "PPK2_API_INCOMPATIBLE",
        "PPK2_REQUEST_INVALID",
      ]),
    })
    .strict(),
  finishedSchema,
]);
/** Consume only stdout from the owned bridge; decoder limits and terminal state fail closed. */
export class Ppk2Protocol {
  private readonly request: z.infer<typeof Ppk2RequestSchema>;
  private readonly decoder = new StringDecoder("utf8");
  private buffer = "";
  private bytes = 0;
  private started = false;
  private failed = false;
  private ended = false;
  private readonly samples: number[] = [];
  private finished?: z.infer<typeof finishedSchema>;
  private unavailable?: string;

  /** The exact validated request is retained so another mode or oversized stream cannot be substituted. */
  constructor(input: unknown) {
    const parsed = Ppk2RequestSchema.safeParse(input);
    if (!parsed.success)
      throw new PlatformIOError(
        "Invalid PPK2 request.",
        "PPK2_REQUEST_INVALID",
      );
    this.request = parsed.data;
  }

  /** Reject overflow, malformed records, duplicate terminals and samples arriving before startup. */
  accept(chunk: Buffer): void {
    if (this.failed || this.ended) this.invalid();
    this.bytes += chunk.length;
    if (this.bytes > 1024 * 1024) this.invalid();
    this.buffer += this.decoder.write(chunk);
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line || Buffer.byteLength(line) > 16384) this.invalid();
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        this.invalid();
      }
      const parsed = eventSchema.safeParse(value);
      if (!parsed.success || this.finished || this.unavailable) this.invalid();
      const record = parsed.data;
      switch (record.event) {
        case "started":
          if (this.started || record.mode !== this.request.mode) this.invalid();
          this.started = true;
          break;
        case "samples":
          if (
            !this.started ||
            record.currentMa.some(
              (value) =>
                Math.abs(value) > this.request.currentLimitMa + 0.0000005,
            )
          )
            this.invalid();
          this.samples.push(...record.currentMa);
          if (
            this.samples.length * 1000 >
            Math.ceil(this.request.seconds * 100000) + 100000
          )
            this.invalid();
          break;
        case "unavailable":
          if (this.started || this.samples.length) this.invalid();
          this.unavailable = record.code;
          break;
        case "finished":
          if (
            record.emittedWindows !== this.samples.length ||
            record.sampleCount !==
              (record.emittedWindows + record.unreportedWindows) * 1000 +
                record.partialWindowSamples ||
            record.sampleCount >
              Math.ceil(this.request.seconds * 100000) + 100000
          )
            this.invalid();
          if (
            (!this.started &&
              (record.sampleCount || record.outcome === "complete")) ||
            (!record.deviceTouched && (this.started || record.powerMayBeOn))
          )
            this.invalid();
          if (record.outcome === "complete" && record.unreportedWindows)
            this.invalid();
          if (
            this.request.mode === "source" &&
            record.outputOffWritten &&
            record.powerMayBeOn
          )
            this.invalid();
          this.finished = record;
          break;
      }
    }
    if (Buffer.byteLength(this.buffer) > 16384) this.invalid();
  }

  /** Process EOF requires a complete terminal record; it never promotes partial output to success. */
  end(): void {
    if (this.failed) this.invalid();
    if (this.ended) return;
    this.buffer += this.decoder.end();
    this.ended = true;
    if (this.buffer.length || (!this.finished && !this.unavailable))
      this.invalid();
  }

  /** Device cleanup is a bridge report only; the host must also prove owned process/group closure. */
  snapshot() {
    const finish = this.finished;
    const cleanupReported =
      !this.failed &&
      !!(
        this.unavailable ||
        (finish &&
          finish.serialClosed &&
          finish.measurementStopped &&
          !finish.powerMayBeOn &&
          (this.request.mode !== "source" ||
            !finish.deviceTouched ||
            finish.outputOffWritten))
      );
    return {
      started: this.started,
      ended: this.ended,
      failed: this.failed,
      terminal: !!(finish || this.unavailable),
      unavailable: this.unavailable ?? null,
      cleanupReported,
      finished: finish ? { ...finish } : null,
      currentMa: [...this.samples],
    };
  }
  private invalid(): never {
    this.failed = true;
    throw new PlatformIOError(
      "Invalid or incomplete PPK2 bridge protocol.",
      "PPK2_PROTOCOL_INVALID",
    );
  }
}
