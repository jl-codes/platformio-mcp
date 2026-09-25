#!/usr/bin/env node
/** Build the shared CLI engine and ancillary assets for a Python wheel staging directory. */
import {build} from "esbuild";
import {collectBundleLicenses} from "./bundle-license-inventory.mjs";
import {cpSync, existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";

/** Create a fresh staging tree. Node binaries and the final checksum inventory are added by the wheel builder. */
export async function buildPythonRuntime(destination) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const output = path.resolve(destination);
  if (existsSync(output)) throw new Error("Python runtime staging directory must be new");
  const plugin = path.join(root, "plugins/platformio-mcp");
  if (!existsSync(path.join(plugin, "runtime/inventory.json"))) throw new Error("Build and validate the plugin runtime first");
  mkdirSync(output, {recursive:true});
  cpSync(path.join(plugin, "runtime"), path.join(output, "runtime"), {recursive:true});
  const common = {
    absWorkingDir:root, metafile:true, bundle:true, platform:"node", format:"esm", target:"node20", sourcemap:false,
    legalComments:"inline", logLevel:"warning",
    banner:{js:'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'},
  };
  const cliBuild = await build({...common, entryPoints:[path.join(root,"src/cli.ts")], outfile:path.join(output,"runtime/cli.mjs"), external:["serialport"]});
  // Preserve dynamic installer/validator paths used by the original CLI.
  const installerBuild = await build({...common, entryPoints:[path.join(root,"scripts/installers/index.js")], outfile:path.join(output,"scripts/installers/index.js"), external:["../validate-codex-plugin.mjs"]});
  for (const name of ["validate-codex-plugin.mjs", "serial-runtime-contract.mjs", "setup-ppk2.py"])
    cpSync(path.join(root,"scripts",name),path.join(output,"scripts",name));
  cpSync(plugin,path.join(output,"plugins/platformio-mcp"),{recursive:true});
  mkdirSync(path.join(output,".agents/plugins"),{recursive:true});
  cpSync(path.join(root,".agents/plugins/marketplace.json"),path.join(output,".agents/plugins/marketplace.json"));
  for (const name of ["LICENSE", "THIRD-PARTY-NOTICES.md"])
    cpSync(path.join(root,name),path.join(output,name));
  const pkg=JSON.parse(readFileSync(path.join(root,"package.json"),"utf8"));
  writeFileSync(path.join(output,"package.json"),JSON.stringify({name:pkg.name,version:pkg.version,type:"module",license:pkg.license},null,2)+"\n");
  collectBundleLicenses(root, output, [cliBuild.metafile, installerBuild.metafile]);
  return output;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error("Usage: node scripts/build-python-runtime.mjs <new staging directory>");
  await buildPythonRuntime(process.argv[2]);
}
