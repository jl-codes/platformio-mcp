/** Registry normalization and lookup failures must never imply name ownership. */
import {test} from "node:test";
import assert from "node:assert/strict";
import {audit, normalizeName, classify} from "../scripts/audit-namespaces.mjs";
test("Python separators collapse while npm identities remain distinct", () => {
  for (const name of ["platformio.mcp", "PlatformIO_MCP", "platformio--mcp"]) assert.equal(normalizeName("pypi", name), "platformio-mcp");
  assert.equal(normalizeName("npm", "platformio.mcp"), "platformio.mcp");
});
test("missing, blocked, and failed lookups never prove availability or control", async () => {
  for (const [status, expected] of [[404,"lookup_missing"],[403,"registry_blocked"],[429,"registry_blocked"],[503,"unknown"]]) {
    const result = await audit({entries:[{registry:"npm",name:"fixture"}], maxLookups:100, canonicalSource:"https://github.com/jl-codes/platformio-mcp"}, async () => new Response("",{status}));
    assert.equal(result.entries[0].status, expected); assert.equal(result.entries[0].publicationControlVerified, false);
  }
});
test("metadata project links do not confer publication control", async () => {
  const source = "https://github.com/jl-codes/platformio-mcp";
  assert.equal(classify({registry:"npm"},200,{repository:{url:"git+"+source+".git"}},source),"observed_project_link");
  assert.equal(classify({registry:"npm"},200,{repository:{url:source+"-fake"}},source),"third_party");
  await assert.rejects(audit({entries:Array(101).fill({}),maxLookups:100}));
});
