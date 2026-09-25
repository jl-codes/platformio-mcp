import { describe, it, expect } from "vitest";
import { matchBoundedLines } from "../src/core/bounded-pattern.js";
describe("bounded patterns", () => {
  it("keeps literal metacharacters literal by default", async () =>
    expect(await matchBoundedLines(["boot.*", "boot ok"], "boot.*")).toEqual([
      0,
    ]));
  it("supports explicit case-insensitive regex", async () =>
    expect(
      await matchBoundedLines(
        ["BOOT ok", "noise", "boot bad"],
        "^boot (ok|bad)$",
        { mode: "regex", ignoreCase: true },
      ),
    ).toEqual([0, 2]));
  it("translates Python named groups and references", async () =>
    expect(
      await matchBoundedLines(
        ["abc-abc", "abc-def"],
        "(?P<word>[a-z]+)-(?P=word)",
        { mode: "regex", pythonNamedGroups: true },
      ),
    ).toEqual([0]));
  it.each(["[", "(?i)test"])(
    "rejects invalid or unsupported pattern %s",
    async (pattern) =>
      await expect(
        matchBoundedLines(["test"], pattern, { mode: "regex" }),
      ).rejects.toMatchObject({ code: "PATTERN_INVALID" }),
  );
  it("rejects Python-only escape semantics", async () =>
    await expect(
      matchBoundedLines(["test"], "\\Atest", {
        mode: "regex",
        pythonNamedGroups: true,
      }),
    ).rejects.toMatchObject({ code: "PATTERN_UNSUPPORTED" }));
  it("terminates catastrophic backtracking without blocking the main event loop", async () => {
    let responsive = false;
    setTimeout(() => {
      responsive = true;
    }, 10);
    await expect(
      matchBoundedLines(["a".repeat(50000) + "!"], "^(a+)+$", {
        mode: "regex",
        timeoutMs: 200,
      }),
    ).rejects.toMatchObject({ code: "PATTERN_TIMEOUT" });
    expect(responsive).toBe(true);
    expect(await matchBoundedLines(["ok"], "ok", { mode: "regex" })).toEqual([
      0,
    ]);
  });
  it("bounds concurrent worker allocation and recovers capacity", async () => {
    const pending = Array.from({ length: 4 }, () =>
      matchBoundedLines(["a".repeat(50000) + "!"], "^(a+)+$", {
        mode: "regex",
        timeoutMs: 200,
      }).catch((error) => error.code),
    );
    await expect(
      matchBoundedLines(["ok"], "ok", { mode: "regex" }),
    ).rejects.toMatchObject({ code: "PATTERN_BUSY" });
    expect(await Promise.all(pending)).toEqual(
      Array(4).fill("PATTERN_TIMEOUT"),
    );
    expect(await matchBoundedLines(["ok"], "ok", { mode: "regex" })).toEqual([
      0,
    ]);
  });
  it("rejects oversized input before worker execution", async () =>
    await expect(
      matchBoundedLines(["x".repeat(1024 * 1024 + 1)], "x", { mode: "regex" }),
    ).rejects.toMatchObject({ code: "PATTERN_INPUT_LIMIT" }));
});
