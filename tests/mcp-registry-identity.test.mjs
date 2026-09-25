/** Registry metadata cannot point at a lookalike package, stale version, or different owner. */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateRegistryIdentity} from "../scripts/validate-mcp-registry.mjs";
const read = name => JSON.parse(readFileSync(new URL("../"+name,import.meta.url),"utf8"));
const server=read("server.json"), pkg=read("package.json"), inventory=read("distribution/namespaces.json");
test("validates the canonical stdio distribution against the official schema",()=>assert.equal(validateRegistryIdentity(server,pkg,inventory),true));
test("rejects namespace, source, version and package substitution",()=>{
 const changes=[{...server,name:"io.github.other/platformio-mcp"},{...server,version:"0.0.0"},{...server,repository:{...server.repository,id:"0"}},{...server,packages:[{...server.packages[0],identifier:"platformio.mcp"}]},{...server,packages:[{...server.packages[0],version:"latest"}]}];
 for(const changed of changes) assert.throws(()=>validateRegistryIdentity(changed,pkg,inventory));
 assert.throws(()=>validateRegistryIdentity(server,{...pkg,mcpName:undefined},inventory));
});
