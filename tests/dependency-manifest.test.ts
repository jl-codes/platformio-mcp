/** Manifest evidence parsing across PlatformIO and Arduino formats. */
import { expect, it } from "vitest";
import {
  parseDependencyDeclaration as spec,
  parseDependencyManifest as manifest,
} from "../src/core/dependency-manifest.js";
it("distinguishes constrained registry names from opaque URL/local sources", () => {
  expect(spec("owner/Library Name@^1.2")).toMatchObject({
    name: "Library Name",
    kind: "registry",
    constrained: true,
  });
  expect(spec("Library Name")).toMatchObject({
    name: "Library Name",
    constrained: false,
  });
  expect(spec("git+https://example.test/repo.git#main")).toMatchObject({
    name: null,
    kind: "vcs",
  });
  expect(spec("file://../local")).toMatchObject({ name: null, kind: "local" });
  expect(spec("https://example.test/archive.zip")).toMatchObject({
    name: null,
    kind: "unknown",
  });
});
it("reads both JSON dependency forms and Arduino constraints", () => {
  expect(
    manifest(
      JSON.stringify({
        name: "A",
        version: 1,
        dependencies: { "owner/B": "^2", C: { version: "1" } },
      }),
      "json",
    ),
  ).toEqual({ name: "A", version: "1", dependencies: ["B", "C"] });
  expect(
    manifest('{"dependencies":[{"name":"B","version":"1"},"C"]}', "json")
      .dependencies,
  ).toEqual(["B", "C"]);
  expect(
    manifest(
      "name=A\nversion=1.0\ndepends=B (>=1.0 && <2.0), C\n",
      "properties",
    ),
  ).toEqual({ name: "A", version: "1.0", dependencies: ["B", "C"] });
});
it.each(["{", '{"dependencies":42}', '{"dependencies":[{}]}'])(
  "rejects malformed JSON evidence: %s",
  (input) => {
    expect(() => manifest(input, "json")).toThrow("evidence is incomplete");
  },
);
it("rejects duplicate fields and bounded input excess", () => {
  expect(() => manifest("name=A\nname=B", "properties")).toThrow(
    "evidence is incomplete",
  );
  expect(() => manifest("x".repeat(1024 * 1024 + 1), "json")).toThrow("1 MiB");
  expect(() => spec("name\nother")).toThrow("Invalid dependency declaration");
});
