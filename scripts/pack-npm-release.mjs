#!/usr/bin/env node
/** Pack the same eligible inventory later used by immutable publication checks. */
import {mkdirSync} from "node:fs";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {npmReleasePackages} from "./npm-release-packages.mjs";
const root=fileURLToPath(new URL("..",import.meta.url));
const destination=path.resolve(process.argv[2]??path.join(root,"release-artifacts"));
const npmCli=process.env.npm_execpath;
if(!npmCli) throw new Error("Run via npm run package:release");
const packages=npmReleasePackages(root);
mkdirSync(destination,{recursive:true});
for(const item of packages) execFileSync(process.execPath,[npmCli,"pack",item.directory,"--ignore-scripts","--pack-destination",destination],{cwd:root,stdio:"inherit"});
