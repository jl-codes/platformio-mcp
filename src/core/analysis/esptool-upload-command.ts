/** Validate the executable and device prefix of a captured raw esptool upload command. */
import fs from "node:fs/promises";
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";
import { parseEspUploadImageOperands } from "./esptool-upload-inputs.js";

/** Host-resolved identities from installed tools and the authorized selected device. */
export interface EspUploadCommandContext {
  pythonPath: string;
  esptoolPath: string;
  chip: string;
  port: string;
}

/**
 * Validate captured argv against host identities without invoking a shell or executing the uploader.
 * This is not a permission grant; the caller still binds approval to the retained manifest and holds
 * device custody across execution. Only the raw write-flash command grammar is supported here.
 */
export async function validateEspUploadCommand(
  expandedArgv: readonly string[],
  context: EspUploadCommandContext,
): Promise<void> {
  const argv = [...expandedArgv];
  const selected = { ...context };
  const invalid = () =>
    new PlatformIOError(
      "Captured uploader does not match the selected tools or device.",
      "UPLOAD_COMMAND_UNSUPPORTED",
    );
  parseEspUploadImageOperands(argv);
  if (
    !path.isAbsolute(selected.pythonPath) ||
    !path.isAbsolute(selected.esptoolPath) ||
    !path.isAbsolute(argv[0]) ||
    !path.isAbsolute(argv[1] ?? "") ||
    /\.(?:cmd|bat|ps1|sh|py)$/i.test(selected.pythonPath) ||
    !/\.py$/i.test(selected.esptoolPath) ||
    !selected.chip ||
    !selected.port
  )
    throw invalid();
  const [python, esptool, actualPython, actualEsptool] = await Promise.all([
    fs.realpath(selected.pythonPath),
    fs.realpath(selected.esptoolPath),
    fs.realpath(argv[0]),
    fs.realpath(argv[1]),
  ]);
  if (
    python !== actualPython ||
    esptool !== actualEsptool ||
    !(await fs.stat(python)).isFile() ||
    !(await fs.stat(esptool)).isFile()
  )
    throw invalid();
  const commandIndex = argv.findIndex(
    (arg) => arg === "write_flash" || arg === "write-flash",
  );
  const options = new Map<string, string>();
  for (let index = 2; index < commandIndex; ) {
    const raw = argv[index];
    const equals = raw.indexOf("=");
    const flag = (equals < 0 ? raw : raw.slice(0, equals)).replaceAll("_", "-");
    const name =
      (
        { "-p": "--port", "-b": "--baud", "-c": "--chip" } as Record<
          string,
          string
        >
      )[flag] ?? flag;
    if (
      ![
        "--chip",
        "--port",
        "--baud",
        "--before",
        "--after",
        "--no-stub",
      ].includes(name) ||
      options.has(name)
    )
      throw invalid();
    if (name === "--no-stub") {
      if (equals >= 0) throw invalid();
      options.set(name, "true");
      index++;
      continue;
    }
    const value = equals < 0 ? argv[index + 1] : raw.slice(equals + 1);
    if (
      !value ||
      value.startsWith("-") ||
      (equals < 0 && index + 1 >= commandIndex)
    )
      throw invalid();
    options.set(name, value);
    index += equals < 0 ? 2 : 1;
  }
  if (
    options.get("--chip") !== selected.chip ||
    options.get("--port") !== selected.port
  )
    throw invalid();
  const baud = options.get("--baud");
  if (
    baud !== undefined &&
    (!/^[1-9][0-9]*$/.test(baud) || !Number.isSafeInteger(Number(baud)))
  )
    throw invalid();
  const before = options.get("--before")?.replaceAll("_", "-");
  const after = options.get("--after")?.replaceAll("_", "-");
  if (
    before !== undefined &&
    !["default-reset", "usb-reset", "no-reset", "no-reset-no-sync"].includes(
      before,
    )
  )
    throw invalid();
  if (
    after !== undefined &&
    !["hard-reset", "soft-reset", "no-reset", "no-reset-stub"].includes(after)
  )
    throw invalid();
}
