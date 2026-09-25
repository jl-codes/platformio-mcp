/** Resolve eligible npm packages from the namespace inventory with exact runtime and path bindings. */
import {readFileSync,realpathSync} from "node:fs";
import path from "node:path";
const existing=new Set(["platformio-mcp","pio-agent","pio-mcp"]);

/** Candidates are packageable but cannot join publication merely because their metadata exists. */
export function npmReleasePackages(root, {includeCandidates=false}={}) {
 root=realpathSync(root);
 const read=file=>JSON.parse(readFileSync(file,"utf8"));
 const canonical=read(path.join(root,"package.json"));
 const inventory=read(path.join(root,"distribution/namespaces.json"));
 const selected=inventory.entries.filter(entry=>entry.registry==="npm" && (entry.publishIntent===true || (includeCandidates && entry.role==="candidate_alias" && entry.packagePath)));
 const names=new Set();
 const result=selected.map(entry=>{
  if(names.has(entry.name) || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(entry.name)) throw new Error("Invalid or duplicated npm release name");
  names.add(entry.name);
  if(entry.publishIntent && !existing.has(entry.name) && (entry.publicationControlVerified!==true || entry.namingEligibilityVerified!==true)) throw new Error("New aliases require verified scope authority and naming eligibility before publication");
  if(!["canonical","functional_alias","candidate_alias"].includes(entry.role) || entry.source!==inventory.canonicalSource || typeof entry.packagePath!=="string" || path.isAbsolute(entry.packagePath)) throw new Error("Unapproved npm alias identity or path");
  const directory=realpathSync(path.resolve(root,entry.packagePath));
  const relative=path.relative(root,directory);
  if(relative===".." || relative.startsWith(".."+path.sep) || path.isAbsolute(relative)) throw new Error("Npm alias path escapes checkout");
  const manifest=read(path.join(directory,"package.json"));
  if(manifest.name!==entry.name || manifest.version!==canonical.version) throw new Error("Npm alias name/version differs from inventory or canonical release");
  if(entry.name!==canonical.name) {
   if(manifest.dependencies?.[canonical.name]!==canonical.version || Object.keys(manifest.dependencies).length!==1 || manifest.scripts || !Object.keys(manifest.bin??{}).length || Object.values(manifest.bin).some(file=>file!=="bin.js")) throw new Error("Aliases must delegate to the exact canonical release without lifecycle scripts");
   if(!readFileSync(path.join(directory,"bin.js"),"utf8").includes('import("platformio-mcp/build/cli.js");')) throw new Error("Alias does not delegate to canonical CLI");
  }
  return {name:entry.name,version:manifest.version,directory,packagePath:entry.packagePath,publishIntent:entry.publishIntent===true,filename:`${entry.name.replace(/^@/,"").replace("/","-")}-${manifest.version}.tgz`};
 });
 for(const name of existing) if(!result.some(item=>item.name===name && item.publishIntent)) throw new Error("Release inventory removed an existing npm distribution");
 return result.sort((a,b)=>a.name===canonical.name?-1:b.name===canonical.name?1:a.name.localeCompare(b.name));
}
