#!/usr/bin/env node
/** Package useful namespace candidates without enabling or attempting publication. */
import {readFileSync, realpathSync, mkdirSync} from "node:fs";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("..",import.meta.url));
const canonical=JSON.parse(readFileSync(path.join(root,"package.json"),"utf8"));
const inventory=JSON.parse(readFileSync(path.join(root,"distribution/namespaces.json"),"utf8"));
const destination=path.resolve(process.argv[2] ?? path.join(root,"release-artifacts"));
mkdirSync(destination,{recursive:true});
const npmCli=process.env.npm_execpath;
if(!npmCli) throw new Error("Run this packer through npm run package:aliases so the installed npm CLI is explicit");
for(const entry of inventory.entries.filter(item=>item.registry==="npm" && item.role==="candidate_alias" && item.packagePath)) {
 const directory=realpathSync(path.join(root,entry.packagePath));
 const relative=path.relative(root,directory);
 if(relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Alias package directory escapes checkout");
 const manifest=JSON.parse(readFileSync(path.join(directory,"package.json"),"utf8"));
 if(manifest.name!==entry.name || manifest.version!==canonical.version || manifest.dependencies?.[canonical.name]!==canonical.version || Object.keys(manifest.dependencies).length!==1 || manifest.scripts || Object.values(manifest.bin??{}).some(value=>value!=="bin.js") || !Object.keys(manifest.bin??{}).length) throw new Error("Alias must delegate to the exact canonical runtime without lifecycle scripts");
 const launcher=readFileSync(path.join(directory,"bin.js"),"utf8");
 if(!launcher.includes('import("platformio-mcp/build/cli.js");')) throw new Error("Alias launcher does not delegate to canonical CLI");
 execFileSync(process.execPath,[npmCli,"pack",directory,"--ignore-scripts","--pack-destination",destination],{cwd:root,stdio:"inherit"});
}
console.log("Candidate aliases packaged; no publishing authority asserted and no packages published.");
