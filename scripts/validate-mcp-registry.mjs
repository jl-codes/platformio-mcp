#!/usr/bin/env node
/** Validate the pinned official registry schema and this project's exact package/source binding. */
import Ajv from "ajv";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import path from "node:path";
const read = name => JSON.parse(readFileSync(new URL("../" + name, import.meta.url), "utf8"));
const schemaBytes = readFileSync(new URL("../distribution/mcp-server.schema.json", import.meta.url));
const source = read("distribution/mcp-schema-source.json");
if (createHash("sha256").update(schemaBytes).digest("hex") !== source.sha256) throw new Error("Pinned registry schema hash mismatch");
const ajv = new Ajv({strict:false, allErrors:true});
ajv.addFormat("uri", value => {try {return !!new URL(value).protocol;} catch {return false;}});
const validate = ajv.compile(JSON.parse(schemaBytes));
/** Reject schema violations and any drift from the canonical repository, namespace and npm runtime. */
export function validateRegistryIdentity(server, pkg, inventory) {
  if (!validate(server)) throw new Error("MCP registry schema: " + ajv.errorsText(validate.errors));
  const identity = inventory.entries.find(entry => entry.registry === "mcp" && entry.publishIntent)?.name;
  if (server.name !== identity || pkg.mcpName !== identity) throw new Error("MCP namespace and npm mcpName must match the inventory");
  if (server.version !== pkg.version || server.repository?.url !== inventory.canonicalSource || server.repository?.id !== "1131896566") throw new Error("Registry version or canonical repository identity mismatch");
  if (server.packages?.length !== 1) throw new Error("Only the validated canonical npm runtime is currently supported");
  const runtime = server.packages[0];
  if (runtime.registryType !== "npm" || runtime.registryBaseUrl !== "https://registry.npmjs.org" || runtime.identifier !== pkg.name || pkg.name !== "platformio-mcp" || runtime.version !== pkg.version || runtime.transport.type !== "stdio") throw new Error("Registry runtime must use the exact canonical npm package and version");
  if (server.remotes?.length || runtime.packageArguments?.length || runtime.runtimeArguments?.length || runtime.environmentVariables?.length) throw new Error("Unexpected runtime routing or configuration override");
  return true;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateRegistryIdentity(read("server.json"),read("package.json"),read("distribution/namespaces.json"));
  console.log("MCP registry schema and canonical package identity validated; publication authority remains a separate gate.");
}
