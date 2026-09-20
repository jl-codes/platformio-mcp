/** An existing npm version is a success only when its exact artifact identity matches. */
import {test} from "node:test";
import assert from "node:assert/strict";
import {assessPublishedArtifact, verifyReleasePlan} from "../scripts/npm-release-identity.mjs";
const expected = {name:"platformio-mcp",version:"4.0.0",integrity:"sha512-fixture"};
test("distinguishes absence from registry failure",()=>{
 assert.equal(assessPublishedArtifact(404,{},expected),"unpublished");
 for(const code of [401,403,429,500]) assert.throws(()=>assessPublishedArtifact(code,{},expected));
});
test("rejects a different package, version, or tampered artifact",()=>{
 const metadata={name:expected.name,version:expected.version,dist:{integrity:expected.integrity}};
 assert.equal(assessPublishedArtifact(200,metadata,expected),"identical");
 for(const changed of [{...metadata,name:"platformio.mcp"},{...metadata,version:"3.0.0"},{...metadata,dist:{integrity:"sha512-tampered"}}]) assert.throws(()=>assessPublishedArtifact(200,changed,expected));
});

test("publication preserves preflight source and exact artifact identity", () => {
 const original = {schemaVersion:1, sourceCommit:"commit-a", entries:[{...expected,file:"/release/package.tgz",state:"unpublished"}]};
 const current = structuredClone(original);
 current.entries[0].state = "identical";
 assert.doesNotThrow(() => verifyReleasePlan(original, current));
 for (const field of ["name", "version", "integrity", "file"]) {
   const changed = structuredClone(current);
   changed.entries[0][field] += "changed";
   assert.throws(() => verifyReleasePlan(original, changed));
 }
 assert.throws(() => verifyReleasePlan(original, {...current, sourceCommit:"commit-b"}));
 assert.throws(() => verifyReleasePlan(original, {...current, entries:[]}));
 assert.throws(() => verifyReleasePlan(current, original));
});


test("namespace inventory preserves existing names and keeps unverified candidates out of publication", async () => {
 const {npmReleasePackages}=await import("../scripts/npm-release-packages.mjs");
 const {fileURLToPath}=await import("node:url");
 const root=fileURLToPath(new URL("..",import.meta.url));
 const released=npmReleasePackages(root);
 assert.deepEqual(released.map(item=>item.name).sort(),["pio-agent","pio-mcp","platformio-mcp"]);
 const candidates=npmReleasePackages(root,{includeCandidates:true}).filter(item=>!item.publishIntent);
 assert.equal(candidates.length,8);
 for (const name of ["@forkbomb/platformiomcp", "@forkbomb/pioagent"]) assert.ok(candidates.some(item=>item.name===name));
 assert.ok(candidates.some(item=>item.name==="@forkbomb/platformio.mcp"));
 assert.ok(candidates.every(item=>(item.filename.startsWith("forkbomb-") || item.name==="flashagent") && item.version===released[0].version));
});
