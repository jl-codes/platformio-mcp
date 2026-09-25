/** Offline core reports through trusted GDB with fixed, fail-fast command-file startup. */
import fs from "node:fs/promises";
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";
import { resolveDebuggerExecutable } from "../debug/debug-discovery.js";
import { runAnalysisProcess } from "./analysis-process.js";
import {
  withEspCoredumpArtifacts,
  type EspCoredumpAnalysisInput,
} from "./esp-coredump-analysis.js";
import {
  withConvertedEspCoredump,
  type EspCoredumpConversionOptions,
} from "./esp-coredump-conversion.js";
import { parseEspCoredumpReport } from "./esp-coredump-report.js";

/** Trusted host-selected tools; adapters must authorize tool execution separately from file reads. */
export interface EspCoredumpReportOptions extends EspCoredumpConversionOptions {
  debuggerExecutable: string;
  trustedDebuggerRoots: readonly string[];
}

/** Quote one absolute file name for GDB command syntax, rejecting command separators. */
function gdbFile(file: string): string {
  if (!path.isAbsolute(file) || /[\x00-\x1f\x7f]/.test(file))
    throw new PlatformIOError(
      "Invalid core-analysis artifact path.",
      "COREDUMP_PATH_INVALID",
    );
  return JSON.stringify(file.replace(/\\/g, "/"));
}

/** Decode crash registers/backtrace without connecting a target, reading live memory or running startup files. */
export async function analyzeEspCoredump(
  input: EspCoredumpAnalysisInput,
  options: EspCoredumpReportOptions,
  capturedBytes?: Uint8Array, // Internal acquisition transport; no public raw-byte argument.
) {
  input.validatePolicy();
  options.validatePolicy();
  const debuggerExecutable = await resolveDebuggerExecutable(
    options.debuggerExecutable,
    options.trustedDebuggerRoots,
    input.workspaceDir,
  );
  return withEspCoredumpArtifacts(
    input,
    async (artifacts) =>
      withConvertedEspCoredump(
        artifacts,
        options,
        async (corePath, coreSha256) => {
          const script = path.join(path.dirname(corePath), "report.gdb");
          const coreName = path.basename(corePath);
          if (!/^[a-zA-Z0-9_.-]+$/.test(coreName))
            throw new PlatformIOError(
              "Invalid converted core filename.",
              "COREDUMP_PATH_INVALID",
            );
          // GDB stops a sourced command file at the first error, before any later file-loading command.
          const commands = [
            "set auto-load off",
            "set may-call-functions off",
            "set auto-solib-add off",
            "set pagination off",
            "set confirm off",
            "set print elements 128",
            "file " + gdbFile(artifacts.elfPath),
            "core-file " + coreName,
            "echo ==================== CURRENT THREAD REGISTERS ====================\\n",
            "info registers",
            "echo ==================== CURRENT THREAD STACK ====================\\n",
            "backtrace 256",
            "echo ==================== THREADS INFO ====================\\n",
            "info threads",
          ];
          await fs.writeFile(script, commands.join("\n") + "\n", {
            flag: "wx",
            mode: 0o600,
          });
          options.validatePolicy();
          const output = await runAnalysisProcess(
            debuggerExecutable,
            [
              "-nx",
              "-nh",
              "--batch",
              "--quiet",
              "-iex",
              "set auto-load off",
              "-iex",
              "set may-call-functions off",
              "-x",
              script,
            ],
            {
              cwd: path.dirname(corePath),
              signal: options.signal,
              timeoutMs: 60000,
              maxOutputBytes: 4 * 1024 * 1024,
              environment: { DEBUGINFOD_URLS: "" },
            },
          );
          options.validatePolicy();
          const report = parseEspCoredumpReport(output.stdout);
          return {
            ok: true as const,
            ...report,
            dump: {
              source: artifacts.dump.source,
              identity: artifacts.dump.identity,
            },
            elf: artifacts.elfIdentity,
            firmware_correspondence: artifacts.correspondence,
            core_sha256: coreSha256,
            debugger: debuggerExecutable,
            stderr_present: output.stderr.length > 0,
          };
        },
      ),
    capturedBytes,
  );
}
