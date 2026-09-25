/** Select one OTA environment from computed Core configuration; private auth values must never enter reports. */
import path from "node:path";
import { parseProjectEnvironments } from "../project-inspection.js";
import { PlatformIOError } from "../../utils/errors.js";

/** Parse already authorized bounded configuration; this function neither builds nor opens a device. */
export function selectOtaConfiguration(
  output: string,
  projectDir: string,
  environment?: string,
) {
  const publicView = parseProjectEnvironments(output);
  const selected = environment ?? publicView.defaultEnvironments[0];
  if (
    !selected ||
    !/^[a-zA-Z0-9_-]{1,50}$/.test(selected) ||
    !publicView.envs.some((item) => item.name === selected)
  )
    throw new PlatformIOError(
      "Select one valid OTA environment.",
      "OTA_ENVIRONMENT_INVALID",
    );
  // The shared parser validated shape/size first. This private view retains upload credentials only for the executor.
  const raw = JSON.parse(output) as Array<[string, Array<[string, unknown]>]>;
  const options = Object.fromEntries(
    raw.find(([name]) => name === "env:" + selected)![1],
  );
  const platform = options.platform;
  const family =
    typeof platform === "string" && platform.includes("espressif8266")
      ? ("espressif8266" as const)
      : typeof platform === "string" && platform.includes("espressif32")
        ? ("espressif32" as const)
        : undefined;
  if (!family)
    throw new PlatformIOError(
      "OTA requires an espressif32 or espressif8266 environment.",
      "OTA_FAMILY_UNSUPPORTED",
    );
  const flagsInput = options.upload_flags;
  const flags =
    flagsInput == null
      ? []
      : typeof flagsInput === "string"
        ? flagsInput.split(/[\s,]+/).filter(Boolean)
        : Array.isArray(flagsInput) &&
            flagsInput.every((item) => typeof item === "string")
          ? flagsInput.flatMap((item) => item.split(/\s+/).filter(Boolean))
          : undefined;
  if (
    !flags ||
    flags.length > 256 ||
    flags.some((item) => item.length > 4096 || /[\x00-\x1f\x7f]/.test(item))
  )
    throw new PlatformIOError(
      "Invalid OTA upload flags.",
      "OTA_CONFIG_INVALID",
    );
  let auth: string | undefined, configuredPort: number | undefined;
  const otherFlags: string[] = [];
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index];
    const equals = flag.indexOf("=");
    const name = equals < 0 ? flag : flag.slice(0, equals);
    if (!["-a", "--auth", "-p", "--port"].includes(name)) {
      otherFlags.push(flag);
      continue;
    }
    const value = equals < 0 ? flags[++index] : flag.slice(equals + 1);
    if (value === undefined || value.startsWith("-") || /["']/.test(value))
      throw new PlatformIOError(
        "OTA auth/port flags require an unambiguous value.",
        "OTA_CONFIG_INVALID",
      );
    if (name === "-a" || name === "--auth") {
      if (auth !== undefined || value.length > 1024)
        throw new PlatformIOError(
          "Duplicate or oversized OTA authentication flag.",
          "OTA_CONFIG_INVALID",
        );
      auth = value;
    } else {
      const parsed = Number(value);
      if (
        configuredPort !== undefined ||
        !/^\d+$/.test(value) ||
        !Number.isInteger(parsed) ||
        parsed < 1 ||
        parsed > 65535
      )
        throw new PlatformIOError(
          "Invalid or duplicate OTA port flag.",
          "OTA_CONFIG_INVALID",
        );
      configuredPort = parsed;
    }
  }
  const buildDirectory = publicView.platformioSection.build_dir ?? ".pio/build";
  if (
    typeof buildDirectory !== "string" ||
    !buildDirectory ||
    /[\x00-\x1f\x7f]/.test(buildDirectory)
  )
    throw new PlatformIOError(
      "Invalid OTA build directory.",
      "OTA_CONFIG_INVALID",
    );
  const filesystem = options["board_build.filesystem"];
  if (
    filesystem != null &&
    !["spiffs", "littlefs", "fatfs"].includes(String(filesystem))
  )
    throw new PlatformIOError(
      "Select an explicit supported filesystem image.",
      "OTA_FILESYSTEM_UNSUPPORTED",
    );
  return {
    environment: selected,
    family,
    auth,
    configuredPort: configuredPort ?? (family === "espressif32" ? 3232 : 8266),
    otherFlags,
    declaredProtocol:
      typeof options.upload_protocol === "string"
        ? options.upload_protocol
        : null,
    buildDirectory: path.resolve(projectDir, buildDirectory, selected),
    filesystemImage:
      filesystem == null ? undefined : String(filesystem) + ".bin",
  };
}
