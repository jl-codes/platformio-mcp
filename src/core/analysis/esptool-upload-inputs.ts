/** Identify raw flash image operands from an already-expanded esptool argv, without shell parsing. */
import { PlatformIOError } from "../../utils/errors.js";

/** Exact argv position lets a trusted uploader replace only selected input files with retained paths. */
export interface EspUploadImageOperand {
  offset: number;
  path: string;
  argumentIndex: number;
}

const VALUE_FLAGS = new Set([
  "--flash-mode",
  "--flash-freq",
  "--flash-size",
  "-fm",
  "-ff",
  "-fs",
]);
const BOOLEAN_FLAGS = new Set([
  "--compress",
  "--no-compress",
  "--no-progress",
  "-z",
  "-u",
]);

/**
 * Accept the supported raw write-flash grammar only. Unknown/encryption/erase options need explicit
 * handling before identity can be claimed. Prefix argv remains owned and validated by the launcher.
 */
export function parseEspUploadImageOperands(
  argv: readonly string[],
): EspUploadImageOperand[] {
  const invalid = () =>
    new PlatformIOError(
      "Unsupported or ambiguous esptool upload operands.",
      "UPLOAD_COMMAND_UNSUPPORTED",
    );
  if (
    !Array.isArray(argv) ||
    argv.length > 256 ||
    argv.some(
      (arg) => typeof arg !== "string" || !arg || /[\x00-\x1f\x7f]/.test(arg),
    ) ||
    argv.join("").length > 1024 * 1024
  )
    throw invalid();
  const commands = argv.flatMap((arg, index) =>
    arg === "write_flash" || arg === "write-flash" ? [index] : [],
  );
  if (commands.length !== 1) throw invalid();
  const images: EspUploadImageOperand[] = [];
  let operandsOnly = false;
  for (let index = commands[0] + 1; index < argv.length; ) {
    const raw = argv[index];
    const flag = raw.replaceAll("_", "-");
    if (!operandsOnly && raw === "--") {
      operandsOnly = true;
      index++;
      continue;
    }
    if (!operandsOnly && BOOLEAN_FLAGS.has(flag)) {
      index++;
      continue;
    }
    if (!operandsOnly && VALUE_FLAGS.has(flag)) {
      if (!argv[index + 1] || argv[index + 1].startsWith("-")) throw invalid();
      index += 2;
      continue;
    }
    const equals = flag.indexOf("=");
    if (!operandsOnly && equals > 0 && VALUE_FLAGS.has(flag.slice(0, equals))) {
      if (!flag.slice(equals + 1) || flag[equals + 1] === "-") throw invalid();
      index++;
      continue;
    }
    if (!/^(?:0[xX][0-9a-fA-F]+|0|[1-9][0-9]*)$/.test(raw) || !argv[index + 1])
      throw invalid();
    const offset = Number(raw);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 0xffffffff ||
      (!operandsOnly && argv[index + 1].startsWith("-"))
    )
      throw invalid();
    images.push({ offset, path: argv[index + 1], argumentIndex: index + 1 });
    if (images.length > 32) throw invalid();
    index += 2;
  }
  if (
    !images.length ||
    new Set(images.map((image) => image.offset)).size !== images.length
  )
    throw invalid();
  return images;
}

/** Replace only verified image operands; preserve flags, offsets, executable and ordering byte-for-byte. */
export function substituteEspUploadImages(
  argv: readonly string[],
  replacements: readonly {
    argumentIndex: number;
    originalPath: string;
    retainedPath: string;
  }[],
): string[] {
  const operands = parseEspUploadImageOperands(argv);
  if (
    replacements.length !== operands.length ||
    new Set(replacements.map((item) => item.argumentIndex)).size !==
      replacements.length
  )
    throw new PlatformIOError(
      "Incomplete retained upload image mapping.",
      "UPLOAD_MANIFEST_INVALID",
    );
  const result = [...argv];
  for (const operand of operands) {
    const replacement = replacements.find(
      (item) => item.argumentIndex === operand.argumentIndex,
    );
    if (
      !replacement ||
      replacement.originalPath !== operand.path ||
      !replacement.retainedPath ||
      /[\x00-\x1f\x7f]/.test(replacement.retainedPath)
    )
      throw new PlatformIOError(
        "Retained upload image mapping changed.",
        "UPLOAD_MANIFEST_INVALID",
      );
    result[operand.argumentIndex] = replacement.retainedPath;
  }
  return result;
}
