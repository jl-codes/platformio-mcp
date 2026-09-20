/** LDF hierarchy, missing evidence and bounded parsing checks. */
import { expect, it } from "vitest";
import { parseDependencyGraph } from "../src/core/dependency-graph.js";
it("preserves nesting, versions and repeated library names", () => {
  expect(
    parseDependencyGraph(
      "Dependency Graph\n|-- A @ 1.2\n|   |-- B @ 2\n|-- B @ 3\nBuilding in release mode",
    ),
  ).toMatchObject({
    status: "complete",
    graph: [
      {
        name: "A",
        version: "1.2",
        dependencies: [{ name: "B", version: "2" }],
      },
      { name: "B", version: "3", dependencies: [] },
    ],
  });
});
it("distinguishes missing and malformed graphs from observed empty graphs", () => {
  expect(parseDependencyGraph("build failed").status).toBe("unavailable");
  expect(parseDependencyGraph("Dependency Graph").status).toBe("unavailable");
  expect(
    parseDependencyGraph("Dependency Graph\nNo dependencies"),
  ).toMatchObject({ status: "complete", graph: [] });
  expect(
    parseDependencyGraph("Dependency Graph\n|   |-- orphan @ 1").status,
  ).toBe("partial");
  expect(
    parseDependencyGraph("RecursionError: maximum recursion depth exceeded")
      .recursionErrorObserved,
  ).toBe(true);
});
it("rejects oversized lines before parsing", () => {
  expect(() => parseDependencyGraph("x".repeat(16385))).toThrow("line limits");
});

it("accepts observed Core no-dependencies output without a graph heading", () => {
  expect(
    parseDependencyGraph(
      "LDF Modes: Finder ~ chain, Compatibility ~ soft\nFound 33 compatible libraries\nScanning dependencies...\nNo dependencies\nBuilding in debug mode",
    ),
  ).toMatchObject({ status: "complete", graph: [] });
  expect(parseDependencyGraph("compiler message: No dependencies").status).toBe(
    "unavailable",
  );
});
