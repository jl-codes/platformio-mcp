/** Bounded dependency inventory analysis; findings distinguish observed manifests from lookup heuristics. */
import { z } from "zod";
import { PlatformIOError } from "../utils/errors.js";

const name = z.string().min(1).max(512);
const librarySchema = z
  .object({
    name,
    directoryName: name,
    path: z.string().min(1).max(32768),
    source: z.enum(["lib", "extra", "libdeps"]),
    version: z.string().max(512).nullable(),
    dependencies: z.array(name).max(512),
  })
  .strict();
const declarationSchema = z
  .object({
    spec: z.string().max(4096),
    name: name.nullable(),
    kind: z.enum(["registry", "local", "vcs", "unknown"]),
    constrained: z.boolean(),
  })
  .strict();
/** An installed manifest observation; input order is discovery order, not proof of linker selection. */
export type DependencyLibrary = z.infer<typeof librarySchema>;
/** Parsed declaration evidence; a version range is constrained but not an exact reproducible pin. */
export type DependencyDeclaration = z.infer<typeof declarationSchema>;
/** A bounded actionable finding, with evidence strength explicit. */
export interface DependencyIssue {
  severity: "error" | "warning" | "info";
  kind:
    | "name_collision"
    | "unpinned"
    | "not_installed"
    | "undeclared"
    | "circular";
  evidence: "manifest" | "heuristic";
  libraries: string[];
  paths: string[];
  message: string;
}
/** Audit observed libraries without performing filesystem access, package changes or builds. */
export function auditDependencies(
  declaredInput: unknown,
  installedInput: unknown,
): DependencyIssue[] {
  const declared = z.array(declarationSchema).max(2048).parse(declaredInput);
  const installed = z.array(librarySchema).max(2048).parse(installedInput);
  if (installed.reduce((sum, lib) => sum + lib.dependencies.length, 0) > 16384)
    throw new PlatformIOError(
      "Dependency graph exceeds 16384 edges.",
      "DEPENDENCY_LIMIT",
    );
  const issues: DependencyIssue[] = [];
  const groups = new Map<string, DependencyLibrary[]>();
  for (const lib of installed) {
    const key = lib.name.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), lib]);
  }
  for (const libs of groups.values())
    if (libs.length > 1)
      issues.push({
        severity: "warning",
        kind: "name_collision",
        evidence: "manifest",
        libraries: [libs[0].name],
        paths: libs.map((lib) => lib.path),
        message:
          "Multiple installed manifests declare the same name. Lookup may shadow a copy; actual selection requires build evidence.",
      });
  const matches = (spec: DependencyDeclaration, lib: DependencyLibrary) =>
    spec.name !== null &&
    [lib.name.toLowerCase(), lib.directoryName.toLowerCase()].includes(
      spec.name.toLowerCase(),
    );
  for (const spec of declared) {
    if (spec.kind === "registry" && !spec.constrained)
      issues.push({
        severity: "warning",
        kind: "unpinned",
        evidence: "manifest",
        libraries: spec.name ? [spec.name] : [],
        paths: [],
        message:
          "Registry declaration has no version constraint; fresh resolution can change.",
      });
    if (spec.name && !installed.some((lib) => matches(spec, lib)))
      issues.push({
        severity: "warning",
        kind: "not_installed",
        evidence: "heuristic",
        libraries: [spec.name],
        paths: [],
        message:
          "No observed installed name or directory matches this declaration; aliases and external sources can require build evidence.",
      });
  }
  const dependedOn = new Set(
    installed.flatMap((lib) =>
      lib.dependencies.map((dep) => dep.toLowerCase()),
    ),
  );
  for (const lib of installed)
    if (
      lib.source === "libdeps" &&
      !["unity", "googletest", "doctest", "catch2"].includes(
        lib.name.toLowerCase(),
      ) &&
      !declared.some((spec) => matches(spec, lib)) &&
      !dependedOn.has(lib.name.toLowerCase()) &&
      !dependedOn.has(lib.directoryName.toLowerCase())
    )
      issues.push({
        severity: "info",
        kind: "undeclared",
        evidence: "heuristic",
        libraries: [lib.name],
        paths: [lib.path],
        message:
          "No declaration or observed manifest dependency references this installed library; it may be left over or selected by source discovery.",
      });
  // Ambiguous duplicate identities cannot establish an exact manifest graph edge.
  const unique = new Map(
    [...groups]
      .filter(([, libs]) => libs.length === 1)
      .map(([key, libs]) => [key, libs[0]]),
  );
  const graph = new Map(
    [...unique].map(([key, lib]) => [
      key,
      [
        ...new Set(
          lib.dependencies
            .map((dep) => dep.toLowerCase())
            .filter((dep) => unique.has(dep)),
        ),
      ],
    ]),
  );
  const state = new Map<string, number>();
  const emitted = new Set<string>();
  for (const root of graph.keys()) {
    if (state.has(root)) continue;
    const stack = [{ node: root, next: 0 }];
    state.set(root, 1);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const next = graph.get(frame.node)![frame.next++];
      if (next === undefined) {
        state.set(frame.node, 2);
        stack.pop();
        continue;
      }
      if (state.get(next) === 1) {
        const cycle = stack
          .slice(stack.findIndex((item) => item.node === next))
          .map((item) => item.node);
        const key = [...cycle].sort().join("\0");
        if (!emitted.has(key)) {
          emitted.add(key);
          issues.push({
            severity: "error",
            kind: "circular",
            evidence: "manifest",
            libraries: cycle.map((node) => unique.get(node)!.name),
            paths: cycle.map((node) => unique.get(node)!.path),
            message:
              "Observed manifests form a dependency cycle. Whether the build traverses it depends on dependency-finder settings and source includes.",
          });
        }
      } else if (!state.has(next)) {
        state.set(next, 1);
        stack.push({ node: next, next: 0 });
      }
    }
  }
  const rank = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
