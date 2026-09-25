/** Resolves GNU analysis companions only within an explicitly trusted toolchain root. */
import fs from "node:fs/promises";
import path from "node:path";
import { PlatformIOError } from "../../utils/errors.js";

/** Exact companion binaries resolved for one compiler installation. */
export interface AnalysisToolchain {
  compiler: string;
  root: string;
  addr2line: string;
  size: string;
  nm: string;
}

/** Tests containment using path components, not an unsafe shared string prefix. */
function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/**
 * Resolves compiler-adjacent GNU tools and rejects symlink escapes or ambiguous roots.
 * Trusted roots must come from operator/package discovery, not tool-call arguments.
 * @param compilerPath Absolute compiler selected from validated build metadata.
 * @param trustedRoots Explicit installed-toolchain roots authorized by the host.
 */
export async function resolveAnalysisToolchain(
  compilerPath: string,
  trustedRoots: readonly string[],
): Promise<AnalysisToolchain> {
  if (
    !path.isAbsolute(compilerPath) ||
    !trustedRoots.length ||
    trustedRoots.some((root) => !path.isAbsolute(root))
  )
    throw new PlatformIOError(
      "Analysis needs explicit absolute compiler and trusted-root paths.",
      "ANALYSIS_TOOLCHAIN_INVALID",
    );
  const compiler = await fs.realpath(compilerPath);
  const roots = [
    ...new Set(
      await Promise.all(trustedRoots.map((root) => fs.realpath(root))),
    ),
  ];
  const matches = roots.filter((root) => contained(root, compiler));
  if (!matches.length)
    throw new PlatformIOError(
      "Compiler is outside the trusted toolchain roots.",
      "ANALYSIS_TOOLCHAIN_UNTRUSTED",
    );
  // The narrowest containing root wins; nested package roots do not enlarge authority.
  const root = matches.sort((a, b) => b.length - a.length)[0];
  const name = path.basename(compiler);
  const match = name.match(
    /^((?:[a-z0-9_]+-)*)(?:gcc|g\+\+|cc|c\+\+)(\.exe)?$/i,
  );
  if (!match || !(await fs.stat(compiler)).isFile())
    throw new PlatformIOError(
      "Expected a native GNU-compatible compiler path.",
      "ANALYSIS_TOOLCHAIN_INVALID",
    );
  const companion = async (tool: string): Promise<string> => {
    let candidate: string;
    try {
      candidate = await fs.realpath(
        path.join(
          path.dirname(compiler),
          `${match[1]}${tool}${match[2] ?? ""}`,
        ),
      );
    } catch {
      throw new PlatformIOError(
        `The selected toolchain is missing ${tool}.`,
        "ANALYSIS_TOOL_UNAVAILABLE",
      );
    }
    if (!contained(root, candidate) || !(await fs.stat(candidate)).isFile())
      throw new PlatformIOError(
        `The ${tool} utility escapes the selected toolchain root.`,
        "ANALYSIS_TOOLCHAIN_UNTRUSTED",
      );
    return candidate;
  };
  const [addr2line, size, nm] = await Promise.all([
    companion("addr2line"),
    companion("size"),
    companion("nm"),
  ]);
  return { compiler, root, addr2line, size, nm };
}
