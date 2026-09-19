/** Dependency evidence must not claim a selected library or a runtime recursion failure without a build. */
import { expect, it } from "vitest";
import {
  auditDependencies,
  type DependencyLibrary,
} from "../src/core/dependency-audit.js";
const lib = (name: string, dependencies: string[] = []): DependencyLibrary => ({
  name,
  directoryName: name,
  path: `lib/${name}`,
  source: "lib",
  version: "1.0",
  dependencies,
});
it("finds cycles including self edges without recursive traversal", () => {
  const issues = auditDependencies(
    [],
    [lib("A", ["B"]), lib("B", ["A"]), lib("Self", ["Self"])],
  );
  expect(
    issues
      .filter((issue) => issue.kind === "circular")
      .map((issue) => issue.libraries),
  ).toEqual([["A", "B"], ["Self"]]);
  expect(
    auditDependencies(
      [],
      Array.from({ length: 2000 }, (_, n) =>
        lib(`L${n}`, n < 1999 ? [`L${n + 1}`] : []),
      ),
    ),
  ).toEqual([]);
});
it("reports duplicate identities without asserting which copy wins or inventing a cycle", () => {
  const issues = auditDependencies(
    [],
    [
      lib("A", ["B"]),
      { ...lib("a"), source: "libdeps", path: ".pio/libdeps/a" },
      lib("B", ["A"]),
    ],
  );
  expect(issues).toContainEqual(
    expect.objectContaining({
      kind: "name_collision",
      severity: "warning",
      evidence: "manifest",
    }),
  );
  expect(issues.some((issue) => issue.kind === "circular")).toBe(false);
});
it("distinguishes missing and leftover heuristics from unconstrained declarations", () => {
  const issues = auditDependencies(
    [
      {
        name: "Missing",
        spec: "owner/Missing",
        kind: "registry",
        constrained: false,
      },
    ],
    [
      { ...lib("Unused"), source: "libdeps" },
      { ...lib("Unity"), source: "libdeps" },
    ],
  );
  expect(issues.map((issue) => issue.kind)).toEqual([
    "unpinned",
    "not_installed",
    "undeclared",
  ]);
  expect(issues[1].evidence).toBe("heuristic");
});
it("rejects oversized graphs before traversal", () => {
  expect(() =>
    auditDependencies(
      [],
      Array.from({ length: 40 }, (_, n) =>
        lib(
          `L${n}`,
          Array.from({ length: 500 }, (_, i) => `D${i}`),
        ),
      ),
    ),
  ).toThrow("16384 edges");
});
