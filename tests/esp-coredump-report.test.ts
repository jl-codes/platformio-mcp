/** Analyzer report extraction keeps current-thread scope and explicit output bounds. */
import { expect, it } from "vitest";
import { parseEspCoredumpReport } from "../src/core/analysis/esp-coredump-report.js";
it("extracts reference fields and excludes unrelated thread sections", () => {
  const result = parseEspCoredumpReport(
    "Crashed task handle: 0x123\nPanic reason: LoadProhibited\n==== CURRENT THREAD STACK ====\n#0 main ()\n==== CURRENT THREAD REGISTERS ====\npc 0x4000 main\n==== OTHER THREAD ====\n#1 unrelated ()",
  );
  expect(result).toMatchObject({
    crashed_task: "0x123",
    reason: "LoadProhibited",
    backtrace: ["#0 main ()"],
    registers: { pc: "0x4000 main" },
    truncated: false,
  });
});
it("limits frames and marks omissions", () => {
  const result = parseEspCoredumpReport(
    "==== CURRENT THREAD STACK ====\n" +
      Array.from({ length: 300 }, (_, index) => "#" + index + " frame ()").join(
        "\n",
      ),
  );
  expect(result.backtrace).toHaveLength(256);
  expect(result.truncated).toBe(true);
});
it("does not infer a crash identity from an empty analyzer report", () => {
  expect(parseEspCoredumpReport("")).toMatchObject({
    crashed_task: null,
    reason: null,
    backtrace: [],
    registers: {},
  });
});
