#!/usr/bin/env node
/** Package useful namespace candidates without enabling or attempting publication. */
import {mkdirSync} from "node:fs";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {npmReleasePackages} from "./npm-release-packages.mjs";
const root=fileURLToPath(new URL("..",import.meta.url));
const destination=path.resolve(process.argv[2]??path.join(root,"release-artifacts"));
const npmCli=process.env.npm_execpath;
if(!npmCli) throw new Error("Run via npm run package:aliases");
const candidates=npmReleasePackages(root,{includeCandidates:true}).filter(item=>!item.publishIntent);
mkdirSync(destination,{recursive:true});
for(const item of candidates) execFileSync(process.execPath,[npmCli,"pack",item.directory,"--ignore-scripts","--pack-destination",destination],{cwd:root,stdio:"inherit"});
console.log("Candidate aliases packaged; no publishing authority asserted and no packages published.");
