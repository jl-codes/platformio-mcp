/** Synthetic report checks verify rejection only; these fixtures are not acceptance evidence. */
import test from "node:test";
import assert from "node:assert/strict";
import { validateConfigReport } from "../scripts/produce-config-acceptance.mjs";
const titles = ["supports valid alternate representations:", "preserves permissions, comments, multiline values and separated environment tables", "preserves custom launchers and their permission selectors", "retains runtime policy and compatibility selectors", "leaves invalid files byte-for-byte unchanged:", "leaves the original intact and cleans temporary files if replacement fails", "does not overwrite a remote server with a conflicting local transport", "uses CODEX_HOME and rejects explicitly empty paths"];
function fixture() {
  const assertionResults = [...titles, ...Array(9).fill("supports valid alternate representations: fixture")].map(title => ({ title, status: "passed" }));
  return { success: true, numPassedTests: 17, numTotalTests: 17, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, testResults: [{ name: "/checkout/tests/codex-config-installer.test.ts", assertionResults }] };
}
test("accepts complete report shape and rejects wrong suite, omissions, skips and inconsistent counts", () => {
  assert.equal(validateConfigReport(fixture()), 17);
  for (const mutate of [report => { report.success = false; }, report => { report.testResults[0].name = "/other.test.ts"; }, report => { report.testResults[0].assertionResults[5].title = "unrelated"; }, report => { report.testResults[0].assertionResults[0].status = "pending"; }, report => { report.numPassedTests = 16; }, report => { report.numTodoTests = 1; }]) {
    const report = fixture(); mutate(report); assert.throws(() => validateConfigReport(report));
  }
});
