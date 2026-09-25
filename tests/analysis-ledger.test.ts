/** Ledger previews preserve useful evidence while bounding and excluding unrelated data. */
import { expect, it } from "vitest";
import { projectAnalysisLedger } from "../src/adapters/analysis-ledger.js";
it("bounds decoded rows and keeps unresolved frames without claiming device identity", () => {
  const data = {
    frames: Array.from({ length: 30 }, () => ({
      address: "0x12345678",
      function: "worker",
      file: "main.cpp",
      line: 12,
      resolved: false,
      raw: "private crash data",
    })),
    elf: { sha256: "a".repeat(64) },
    auth: "private",
  };
  const result = projectAnalysisLedger("decode_backtrace", data).analysis!;
  expect(result.rows).toHaveLength(20);
  expect(result).toMatchObject({
    total: 30,
    truncated: true,
    elfSha256: "a".repeat(64),
  });
  expect(result.rows[0]).toMatchObject({
    resolved: false,
    name: "worker",
    line: 12,
  });
  expect(result.note).toContain("does not verify");
  expect(JSON.stringify(result)).not.toContain("private");
});
it("supports both size vocabularies and refuses malformed numeric values", () => {
  for (const [name, field] of [
    ["size_report", "topSymbols"],
    ["pio_size_report", "top_symbols"],
  ]) {
    const result = projectAnalysisLedger(name, {
      [field]: [{ name: "x".repeat(1000), size: -1, line: Infinity }],
      elf_sha256: "invalid",
    }).analysis!;
    expect(result.rows[0].name).toHaveLength(384);
    expect(result.rows[0]).toMatchObject({ size: null, line: null });
    expect(result.elfSha256).toBeNull();
  }
});
it("does not turn unrelated results or missing arrays into analysis", () => {
  expect(projectAnalysisLedger("upload_ota", { frames: [] })).toEqual({});
  expect(projectAnalysisLedger("decode_backtrace", { frames: "bad" })).toEqual(
    {},
  );
});
