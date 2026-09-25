/**
 * Bounded PlatformIO Core 6 package-output parsers.
 * Provides parsePackageSearch and parsePackageList without inventing missing registry identities.
 */
import { PlatformIOError } from "../utils/errors.js";

/** Package types supported by PlatformIO Core. */
export type PackageKind = "library" | "platform" | "tool";
/** A registry identity or installed display name, with explicit source context. */
export interface PackageRow {
  name: string;
  spec?: string; // Present only when the CLI actually prints an owner-qualified specification.
  version: string;
  kind?: PackageKind;
  environment?: string;
  requirement?: string;
  description?: string;
}
/** Parser coverage is separate from the subprocess exit status. */
export interface PackageParseResult {
  packages: PackageRow[];
  parseStatus: "complete" | "partial" | "unrecognized";
  truncated: boolean;
}

/** Normalize terminal styling and bound parser work before regular expressions. */
function linesFromOutput(output: string): string[] {
  if (Buffer.byteLength(output) > 10 * 1024 * 1024)
    throw new PlatformIOError(
      "Package output exceeds 10 MiB.",
      "PACKAGE_OUTPUT_LIMIT",
    );
  const lines = output.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/);
  if (lines.length > 100000 || lines.some((line) => line.length > 16384))
    throw new PlatformIOError(
      "Package output exceeds line limits.",
      "PACKAGE_OUTPUT_LIMIT",
    );
  return lines;
}

/** Parse Core 6 search pages; an unknown format never means zero matches. */
export function parsePackageSearch(output: string): PackageParseResult & {
  total?: number;
  page?: number;
  pages?: number;
} {
  const lines = linesFromOutput(output);
  const header = lines
    .map((line) => line.match(/^Found (\d+) packages \(page (\d+) of (\d+)\)$/))
    .find(Boolean);
  const empty = lines.some(
    (line) => line === "Nothing has been found by your request",
  );
  const packages: PackageRow[] = [];
  let candidates = 0;
  for (let i = 0; i + 1 < lines.length; i++) {
    const spec = lines[i].trim();
    if (!/^[a-zA-Z0-9_.-]+\/[^\s/][^/]*$/.test(spec)) continue;
    const metadata = lines[i + 1].match(
      /^(?:(?:Official|Verified|Community) )?(Library|Platform|Tool) \u2022 (.+?) \u2022 Published on /,
    );
    if (!metadata) continue;
    candidates++;
    if (packages.length < 2000)
      packages.push({
        name: spec.slice(spec.indexOf("/") + 1),
        spec,
        kind: metadata[1].toLowerCase() as PackageKind,
        version: metadata[2],
        description: lines[i + 2]?.trim() || undefined,
      });
  }
  const numbers = header?.slice(1).map(Number);
  const validHeader =
    numbers?.every(Number.isSafeInteger) &&
    numbers[1] >= 1 &&
    numbers[2] >= numbers[1] &&
    numbers[0] >= candidates;
  const recognized = Boolean(validHeader || empty);
  return {
    packages,
    truncated: candidates > packages.length,
    parseStatus: !recognized
      ? "unrecognized"
      : (empty && candidates === 0) || (validHeader && candidates > 0)
        ? "complete"
        : "partial",
    ...(validHeader
      ? { total: numbers![0], page: numbers![1], pages: numbers![2] }
      : empty
        ? { total: 0 }
        : {}),
  };
}

/** Parse Core 6 installed trees, preserving repeated packages in distinct environments. */
export function parsePackageList(output: string): PackageParseResult {
  const lines = linesFromOutput(output);
  const packages: PackageRow[] = [];
  let environment: string | undefined;
  let kind: PackageKind | undefined;
  let empty = false,
    candidates = 0,
    unparsed = 0;
  for (const line of lines) {
    const heading = line.match(/^Resolving (.+) dependencies\.\.\.$/);
    if (heading) {
      environment = heading[1];
      kind = undefined;
      continue;
    }
    if (line.trim() === "No packages") {
      empty = true;
      continue;
    }
    if (/^(Libraries|Tools|Platforms)$/.test(line)) {
      kind = (
        { Libraries: "library", Tools: "tool", Platforms: "platform" } as const
      )[line as "Libraries" | "Tools" | "Platforms"];
      continue;
    }
    const platform = line.startsWith("Platform ");
    const tree = /^[\s\u2502]*[\u251c\u2514]\u2500\u2500 /.test(line);
    if (!platform && !tree) continue;
    const normalized = platform
      ? line.slice(9)
      : line.replace(/^[\s\u2502]*[\u251c\u2514]\u2500\u2500 /, "");
    const match = normalized.match(/^(.+?) @ (\S+) \(required: (.*)\)$/);
    if (!match) {
      unparsed++;
      continue;
    }
    candidates++;
    if (packages.length < 2000)
      packages.push({
        name: match[1],
        version: match[2],
        requirement: match[3],
        environment,
        kind: platform ? "platform" : kind,
      });
    if (platform) kind = "tool";
  }
  return {
    packages,
    truncated: candidates > packages.length,
    parseStatus: unparsed
      ? "partial"
      : candidates > 0 || empty
        ? "complete"
        : "unrecognized",
  };
}
