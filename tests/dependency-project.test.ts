/** Resolved configuration selection and custom inventory paths. */
import path from "node:path";
import { expect, it } from "vitest";
import { parseProjectEnvironments } from "../src/core/project-inspection.js";
import { dependencyProjectInputs } from "../src/core/dependency-project.js";
it("uses configured defaults and custom library directories rather than assuming .pio", () => {
  const report = parseProjectEnvironments(
    JSON.stringify([
      [
        "platformio",
        [
          ["default_envs", ["second"]],
          ["lib_dir", "local-libs"],
          ["libdeps_dir", "cache/libs"],
        ],
      ],
      ["env:first", []],
      [
        "env:second",
        [
          ["lib_deps", ["owner/Library@1"]],
          ["lib_extra_dirs", ["extra,with-comma"]],
          ["lib_ldf_mode", "chain"],
          ["lib_compat_mode", "strict"],
        ],
      ],
    ]),
  );
  const root = path.resolve("fixture");
  expect(dependencyProjectInputs(root, report)).toMatchObject({
    environment: "second",
    declared: [{ name: "Library", constrained: true }],
    roots: [
      { directory: path.join(root, "local-libs"), source: "lib" },
      { directory: path.join(root, "extra,with-comma"), source: "extra" },
      { directory: path.join(root, "cache/libs/second"), source: "libdeps" },
    ],
    ldfMode: "chain",
    compatibilityMode: "strict",
  });
  expect(dependencyProjectInputs(root, report, "first").environment).toBe(
    "first",
  );
  expect(() => dependencyProjectInputs(root, report, "missing")).toThrow(
    "selected environment",
  );
});
it("rejects traversal-like environment names and malformed resolved options", () => {
  const report = parseProjectEnvironments(
    JSON.stringify([["env:../escape", []]]),
  );
  expect(() => dependencyProjectInputs("fixture", report)).toThrow(
    "selected environment",
  );
  const malformed = parseProjectEnvironments(
    JSON.stringify([["env:a", [["lib_extra_dirs", true]]]]),
  );
  expect(() => dependencyProjectInputs("fixture", malformed)).toThrow(
    "configuration",
  );
});
