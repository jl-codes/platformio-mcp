/** Parse bounded PlatformIO LDF console trees without interpreting missing output as an empty graph. */
import { PlatformIOError } from "../utils/errors.js";
import { redactSecretsInText } from "./policy/redact.js";
/** One observed LDF node; repeated names remain separate observations. */
export interface DependencyGraphNode {
  name: string;
  version: string | null;
  dependencies: DependencyGraphNode[];
}
/** Extract one selected-environment graph and expose malformed or absent evidence explicitly. */
export function parseDependencyGraph(output: string) {
  if (Buffer.byteLength(output) > 10 * 1024 * 1024)
    throw new PlatformIOError(
      "Dependency build output exceeds 10 MiB.",
      "DEPENDENCY_GRAPH_LIMIT",
    );
  const lines = redactSecretsInText(output)
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split(/\r?\n/);
  if (lines.length > 100000 || lines.some((line) => line.length > 16384))
    throw new PlatformIOError(
      "Dependency build output exceeds line limits.",
      "DEPENDENCY_GRAPH_LIMIT",
    );
  let explicitEmpty = false;
  let scanning = false;
  const graph: DependencyGraphNode[] = [];
  const stack: DependencyGraphNode[] = [];
  let found = false,
    active = false,
    malformed = false,
    nodes = 0;
  for (const line of lines) {
    if (line.trim() === "Scanning dependencies...") {
      scanning = true;
      continue;
    }
    if (scanning && line.trim() === "No dependencies") {
      found = true;
      explicitEmpty = true;
      scanning = false;
      active = false;
      continue;
    }
    if (scanning && line.trim() && line.trim() !== "Dependency Graph")
      scanning = false;
    if (/^Dependency Graph\s*$/.test(line.trim())) {
      if (found) malformed = true;
      found = true;
      active = true;
      stack.length = 0;
      continue;
    }
    if (!active) continue;
    if (!line.trim()) continue;
    if (/^No dependencies\s*$/i.test(line.trim())) {
      explicitEmpty = true;
      active = false;
      continue;
    }
    const match = /^(\|(?:   \|)*)--\s+(.+?)(?:\s+@\s+(.+))?$/.exec(line);
    if (!match) {
      if (/^[|+` ]*[-|]/.test(line)) malformed = true;
      active = false;
      continue;
    }
    const depth = (match[1].length - 1) / 4;
    if (!Number.isInteger(depth) || depth > stack.length || depth > 64) {
      malformed = true;
      continue;
    }
    if (++nodes > 4096)
      throw new PlatformIOError(
        "Dependency graph exceeds 4096 nodes.",
        "DEPENDENCY_GRAPH_LIMIT",
      );
    const node: DependencyGraphNode = {
      name: match[2],
      version: match[3] ?? null,
      dependencies: [],
    };
    if (depth === 0) graph.push(node);
    else stack[depth - 1].dependencies.push(node);
    stack[depth] = node;
    stack.length = depth + 1;
  }
  return {
    graph,
    status:
      !found || (!graph.length && !explicitEmpty && !malformed)
        ? ("unavailable" as const)
        : malformed
          ? ("partial" as const)
          : ("complete" as const),
    recursionErrorObserved: /\bRecursionError\b/.test(output),
  };
}
