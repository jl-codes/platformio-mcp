/** Bounded literal and regex matching; untrusted regex executes only in a terminable worker. */
import { Worker } from "node:worker_threads";
import { PlatformIOError } from "../utils/errors.js";

/** Explicit matching semantics. Legacy assertion callers should keep literal mode. */
export interface PatternOptions {
  mode?: "literal" | "regex";
  ignoreCase?: boolean;
  timeoutMs?: number;
  pythonNamedGroups?: boolean;
}

/** Translates supported Python named groups; rejects escapes with different ECMAScript meaning. */
function regexSource(pattern: string, translate: boolean): string {
  if (!translate) return pattern;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "\\") {
      i++;
      if (/[AZzGRNUae]/.test(pattern[i] ?? ""))
        throw new PlatformIOError(
          "Unsupported Python regex escape; use the documented ECMAScript subset.",
          "PATTERN_UNSUPPORTED",
        );
    }
  }
  return pattern
    .replace(/\(\?P<([A-Za-z_][A-Za-z0-9_]*)>/g, "(?<$1>")
    .replace(/\(\?P=([A-Za-z_][A-Za-z0-9_]*)\)/g, "\\k<$1>");
}

// Constant worker source: patterns and log text are data, never interpolated executable code.
const WORKER_SOURCE = `
const {parentPort,workerData}=require('node:worker_threads');
parentPort.once('message', () => {
try {
  const regex=new RegExp(workerData.pattern,workerData.ignoreCase?'i':'');
  const indices=[];
  for(let index=0;index<workerData.lines.length;index++) {
    if(regex.test(workerData.lines[index])) indices.push(index);
  }
  parentPort.postMessage({indices});
} catch {parentPort.postMessage({invalid:true});}
});
parentPort.postMessage({ready:true});
`;

let activeRegexWorkers = 0;

/** Returns matching line indices, failing explicitly on timeout rather than returning partial matches. */
export async function matchBoundedLines(
  lines: readonly string[],
  pattern: string,
  options: PatternOptions = {},
): Promise<number[]> {
  if (
    typeof pattern !== "string" ||
    pattern.length > 4096 ||
    lines.length > 10000 ||
    lines.some((line) => typeof line !== "string") ||
    lines.reduce((sum, line) => sum + Buffer.byteLength(line), 0) > 1024 * 1024
  ) {
    throw new PlatformIOError(
      "Pattern matching is limited to 4096 pattern characters, 10000 lines and 1 MiB of input.",
      "PATTERN_INPUT_LIMIT",
    );
  }
  if (
    options.mode !== undefined &&
    options.mode !== "literal" &&
    options.mode !== "regex"
  )
    throw new PlatformIOError(
      "Unknown pattern matching mode.",
      "PATTERN_INVALID",
    );
  if ((options.mode ?? "literal") === "literal") {
    const needle = options.ignoreCase ? pattern.toLowerCase() : pattern;
    return lines.flatMap((line, index) =>
      (options.ignoreCase ? line.toLowerCase() : line).includes(needle)
        ? [index]
        : [],
    );
  }
  const timeoutMs = options.timeoutMs ?? 1000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2000)
    throw new PlatformIOError(
      "Regex timeout must be between 1 and 2000 ms.",
      "PATTERN_INVALID",
    );
  const source = regexSource(pattern, options.pythonNamedGroups ?? false);
  if (activeRegexWorkers >= 4)
    throw new PlatformIOError(
      "Regex worker capacity is busy; retry after current searches finish.",
      "PATTERN_BUSY",
    );
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        lines,
        pattern: source,
        ignoreCase: options.ignoreCase ?? false,
      },
      resourceLimits: {
        maxOldGenerationSizeMb: 32,
        maxYoungGenerationSizeMb: 8,
        stackSizeMb: 2,
      },
    });
    activeRegexWorkers++;
    let settled = false;
    let executing = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error, indices?: number[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker
        .terminate()
        .finally(() => {
          activeRegexWorkers--;
        })
        .then(() => {
          if (error) reject(error);
          else resolve(indices!);
        }, reject);
    };
    timer = setTimeout(
      () =>
        finish(
          new PlatformIOError(
            "Regex worker exceeded its startup deadline.",
            "PATTERN_WORKER_STARTUP_TIMEOUT",
          ),
        ),
      5000,
    );
    worker.on(
      "message",
      (message: { ready?: boolean; invalid?: boolean; indices?: number[] }) => {
        if (settled) return;
        if (message.ready) {
          if (executing) return;
          executing = true;
          clearTimeout(timer);
          timer = setTimeout(
            () =>
              finish(
                new PlatformIOError(
                  "Regex exceeded its execution deadline.",
                  "PATTERN_TIMEOUT",
                ),
              ),
            timeoutMs,
          );
          // Start the budget before permitting compilation or matching in the ready worker.
          worker.postMessage({ run: true });
          return;
        }
        if (!executing)
          return finish(
            new PlatformIOError(
              "Unexpected regex worker response.",
              "PATTERN_WORKER_FAILED",
            ),
          );
        finish(
          message.invalid
            ? new PlatformIOError(
                "Invalid or unsupported regular expression.",
                "PATTERN_INVALID",
              )
            : undefined,
          message.indices,
        );
      },
    );
    worker.once("error", () =>
      finish(
        new PlatformIOError("Regex worker failed.", "PATTERN_WORKER_FAILED"),
      ),
    );
    worker.once("exit", () => {
      if (!settled)
        finish(
          new PlatformIOError(
            "Regex worker exited before returning a result.",
            "PATTERN_WORKER_FAILED",
          ),
        );
    });
  });
}
