/** An existing npm version is a success only when its exact artifact identity matches. */
import {test} from "node:test";
import assert from "node:assert/strict";
import {assessPublishedArtifact} from "../scripts/npm-release-identity.mjs";
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
