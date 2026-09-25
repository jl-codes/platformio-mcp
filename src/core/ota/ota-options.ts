/** Map supported espota flags to typed, approval-bound options without allowing destination/image overrides. */
import { isIP } from "node:net";
import { z } from "zod";
import { PlatformIOError } from "../../utils/errors.js";
/** Typed uploader settings; no arbitrary argument array reaches the executable. */
export const OtaUploaderOptionsSchema = z
  .object({
    hostAddress: z
      .string()
      .refine((value) => isIP(value) === 4)
      .optional(),
    hostPort: z.number().int().min(1).max(65535).optional(),
    invitationTimeoutSeconds: z.number().int().min(1).max(60).optional(),
  })
  .strict();
/** Internal selected uploader options, included in transfer approval identity. */
export type OtaUploaderOptions = z.infer<typeof OtaUploaderOptionsSchema>;
/** Accept reference host binding/deadline controls; the selected target and image remain authoritative. */
export function parseOtaUploaderOptions(
  flags: readonly string[],
  filesystem: boolean,
): OtaUploaderOptions {
  const options: Record<string, unknown> = {};
  const keys: Record<string, string> = {
    "-I": "hostAddress",
    "--host_ip": "hostAddress",
    "-P": "hostPort",
    "--host_port": "hostPort",
    "-t": "invitationTimeoutSeconds",
    "--timeout": "invitationTimeoutSeconds",
  };
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index];
    if (["-r", "--progress", "-d", "--debug"].includes(flag)) continue;
    if (["-s", "--spiffs"].includes(flag)) {
      if (!filesystem)
        throw new PlatformIOError(
          "Configured filesystem mode conflicts with the firmware request.",
          "OTA_FLAGS_CONFLICT",
        );
      continue;
    }
    const equals = flag.indexOf("="),
      name = equals < 0 ? flag : flag.slice(0, equals);
    const key = keys[name];
    if (!key)
      throw new PlatformIOError(
        "Unsupported OTA flag or attempt to override the bound target/image.",
        "OTA_FLAGS_UNSUPPORTED",
      );
    const value = equals < 0 ? flags[++index] : flag.slice(equals + 1);
    if (
      value === undefined ||
      Object.hasOwn(options, key) ||
      (key !== "hostAddress" && !/^\d+$/.test(value))
    )
      throw new PlatformIOError(
        "Invalid or repeated OTA uploader option.",
        "OTA_CONFIG_INVALID",
      );
    options[key] = key === "hostAddress" ? value : Number(value);
  }
  const parsed = OtaUploaderOptionsSchema.safeParse(options);
  if (!parsed.success)
    throw new PlatformIOError(
      "Invalid OTA interface, port or invitation timeout.",
      "OTA_CONFIG_INVALID",
    );
  return parsed.data;
}
