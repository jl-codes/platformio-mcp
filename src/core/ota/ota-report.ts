/** Bounded OTA protocol outcomes distinguish completed transfer from device runtime health. */
import { PlatformIOError } from "../../utils/errors.js";
const failures: readonly [RegExp, string, string][] = [
  [
    /Host \S+ Not Found/,
    "host_not_found",
    "Resolve the board hostname or select its current IP address.",
  ],
  [
    /No response from the ESP/,
    "no_response",
    "Check the OTA UDP port, network path and running ArduinoOTA service.",
  ],
  [
    /Authentication Failed|No Answer to our Authentication/,
    "auth_failed",
    "Check the configured OTA credential.",
  ],
  [
    /Bad Answer:/,
    "bad_answer",
    "The selected service did not accept the OTA invitation.",
  ],
  [
    /No response from device/,
    "no_callback",
    "Check the board's TCP callback route and the host firewall.",
  ],
  [
    /Error Uploading/,
    "transfer_failed",
    "The transfer was interrupted; check the device and network before retrying.",
  ],
  [
    /Error response from device|No Result!/,
    "device_rejected",
    "Check image format, OTA partition capacity and device logs.",
  ],
  [
    /Please specify IP address or host name/,
    "no_upload_port",
    "Select an explicit OTA destination.",
  ],
];
/** Parse only already-redacted bounded uploader output; process exit alone cannot prove successful flashing. */
export function summarizeOtaTransfer(
  output: string,
  exitCode: number,
  timedOut = false,
) {
  if (
    typeof output !== "string" ||
    Buffer.byteLength(output) > 1024 * 1024 ||
    !Number.isInteger(exitCode)
  )
    throw new PlatformIOError(
      "Invalid OTA report input.",
      "OTA_REPORT_INVALID",
    );
  const succeeded = /\[INFO\]: Success|Result: OK/.test(output);
  const failure = failures.find(([pattern]) => pattern.test(output));
  let progress: number | null = null;
  for (const match of output.matchAll(/Uploading: \[=*[ =]*\] (\d{1,3})%/g)) {
    const value = Number(match[1]);
    if (value <= 100) progress = value;
  }
  const ok = !timedOut && exitCode === 0 && succeeded && !failure;
  return {
    ok,
    error: ok ? null : timedOut ? "timeout" : (failure?.[1] ?? "upload_failed"),
    hint: ok
      ? "Observe the device separately to verify runtime health."
      : timedOut
        ? "The bounded upload deadline expired."
        : (failure?.[2] ??
          "Inspect the retained uploader log and image selection."),
    progress_percent: progress,
    auto_switched: output.includes("`upload_protocol` is switched to `espota`"),
    runtime_verified: false as const,
  };
}
