#!/usr/bin/env node
/** Verify exact npm artifacts through installation, upgrade, alias execution and removal. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {npmReleasePackages} from "./npm-release-packages.mjs";
const root = process.cwd();
const directory = path.resolve(process.argv[2] ?? "release-artifacts");
const npm = process.env.npm_execpath;
assert(npm, "Run through npm run accept:npm");
const packages = npmReleasePackages(root);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "pio-npm-acceptance-"));
const env = {...process.env, PIO_MCP_NO_BROWSER:"true", PIO_MCP_DISABLE_DASHBOARD:"true", PIO_MCP_DATA_DIR:path.join(temporary,"state")};
const runNpm = args => execFileSync(process.execPath,[npm,"--prefix",temporary,...args,"--no-audit","--no-fund"],{cwd:temporary,env,encoding:"utf8",timeout:240000,windowsHide:true,maxBuffer:4*1024*1024});
const version = packages[0].version;
const observed=[];
try {
  fs.writeFileSync(path.join(temporary,"package.json"), JSON.stringify({name:"pio-release-installation",version:"1.0.0",private:true}));
  runNpm(["install","--ignore-scripts","platformio-mcp@3.0.0","pio-mcp@3.0.0","pio-agent@3.0.0"]);
  const cli=path.join(temporary,"node_modules/platformio-mcp/build/cli.js");
  assert.equal(execFileSync(process.execPath,[cli,"--version"],{env,encoding:"utf8",timeout:30000}).trim(),"3.0.0");
  runNpm(["install","--ignore-scripts",...packages.map(p=>path.join(directory,p.filename))]);
  for (const item of packages) {
    const installed=path.join(temporary,"node_modules",item.name);
    const manifest=JSON.parse(fs.readFileSync(path.join(installed,"package.json"),"utf8"));
    assert.equal(manifest.version,version);
    const launcher=path.join(installed,item.name==="platformio-mcp"?"build/cli.js":"bin.js");
    assert.equal(execFileSync(process.execPath,[launcher,"--version"],{cwd:temporary,env,encoding:"utf8",timeout:30000}).trim(),version);
    observed.push({name:item.name,version,filename:item.filename,sha256:createHash("sha256").update(fs.readFileSync(path.join(directory,item.filename))).digest("hex")});
  }
  runNpm(["uninstall",...packages.filter(p=>p.name!=="platformio-mcp").map(p=>p.name)]);
  assert.equal(execFileSync(process.execPath,[cli,"--version"],{env,encoding:"utf8",timeout:30000}).trim(),version);
  runNpm(["uninstall","platformio-mcp"]);
  assert(!fs.existsSync(cli));
  fs.writeFileSync(path.join(directory,"npm-installation.json"),JSON.stringify({schemaVersion:1,sourceCommit:execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),timestamp:new Date().toISOString(),outcome:"pass",host:{platform:process.platform,arch:process.arch},upgradedFrom:"3.0.0",version,artifacts:observed,aliasUninstallPreservesCanonical:true,canonicalUninstalled:true,scope:"Exact packed artifacts, not public-registry installation"},null,2)+"\n");
  console.log(`Verified ${observed.length} installed npm distributions at ${version}, upgrade from 3.0.0 and clean uninstall.`);
} finally { fs.rmSync(temporary,{recursive:true,force:true}); }
