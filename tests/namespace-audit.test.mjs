/** Registry normalization and lookup failures must never imply name ownership. */
import {test} from "node:test";
import assert from "node:assert/strict";
import {audit, normalizeName, classify, namespaceChanges} from "../scripts/audit-namespaces.mjs";
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

test("lookup budget is enforced and fresh cached results issue no request", async () => {
 const inventory={entries:[{registry:"npm",name:"one"},{registry:"npm",name:"two"}],maxLookups:1,canonicalSource:"https://github.com/jl-codes/platformio-mcp"};
 let calls=0;
 const fetcher=async()=>{calls++;return new Response("",{status:404});};
 const first=await audit(inventory,fetcher);
 assert.equal(calls,1);
 assert.match(first.entries[1].reason,/budget exhausted/);
 const second=await audit({...inventory,entries:[inventory.entries[0]]},fetcher,first);
 assert.equal(calls,1);
 assert.equal(second.entries[0].cached,true);
 assert.equal(second.entries[0].publicationControlVerified,false);
 for (const limit of [0,-1,1.5,NaN,undefined,101]) await assert.rejects(audit({...inventory,maxLookups:limit},fetcher));
});
test("rate limited responses retain backoff and changes ignore observation timestamps", async () => {
 const inventory={entries:[{registry:"npm",name:"one"}],maxLookups:1,canonicalSource:"https://github.com/jl-codes/platformio-mcp"};
 const first=await audit(inventory,async()=>new Response("",{status:429,headers:{"Retry-After":"864000"}}));
 assert.equal(first.entries[0].status,"registry_blocked");
 assert.ok(Date.parse(first.entries[0].nextLookupAtUtc)-Date.now()<=86400000);
 const second=await audit(inventory,async()=>{throw new Error("Should use backoff cache");},first);
 assert.equal(second.lookups,0);
 assert.deepEqual(namespaceChanges(first,second),[]);
 const changed=structuredClone(second);changed.entries[0].status="third_party";
 assert.deepEqual(namespaceChanges(first,changed)[0].changed,["status"]);
});


test("coverage reports verified authority without implying new-release deployment", async () => {
 const {namespaceCoverage}=await import("../scripts/namespace-coverage.mjs");
 const inventory={requestedAliases:["fixture"],canonicalSource:"https://github.com/example/project",entries:[
  {registry:"npm",name:"fixture",role:"canonical",publishIntent:true,publicationControlVerified:true},
  {registry:"npm",name:"@owner/fixture",role:"candidate_alias",publishIntent:false,publicationControlVerified:true}
 ]};
 const observations={entries:[{registry:"npm",name:"fixture",status:"observed_project_link",version:"old"}]};
 const row=namespaceCoverage(inventory,observations).rows.find(row=>row.channel==="npm");
 assert.equal(row.disposition,"published_metadata_observed_authority_verified");
 assert.equal(row.entries[0].observedVersion,"old");
 assert.equal(row.scopedAlternatives[0].authorityVerified,true);
 assert.equal(row.scopedAlternatives[0].namingEligibilityVerified,false);
 assert.equal(row.scopedAlternatives[0].publishIntent,false);
 inventory.entries[0].publicationControlVerified=false;
 assert.equal(namespaceCoverage(inventory,observations).rows.find(row=>row.channel==="npm").disposition,"published_metadata_observed_authority_unproven");
});
