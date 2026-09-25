#!/usr/bin/env node
/** Bind official MCP publication to the exact published npm artifact and reject conflicting registry versions. */
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { planNpmRelease } from "./npm-release-identity.mjs";
import { validateRegistryIdentity } from "./validate-mcp-registry.mjs";

/** Existing versions are immutable for this release workflow, even if the service supports replacement. */
export function assessMcpVersion(status, response, expected) {
  if (status === 404) return "unpublished";
  if (status !== 200) throw new Error(`MCP registry lookup failed: ${status}`);
  if (!isDeepStrictEqual(response.server, expected)) throw new Error("Existing MCP version differs; choose a new release version");
  const state = response._meta?.["io.modelcontextprotocol.registry/official"]?.status;
  if (state !== "active") throw new Error("Existing MCP version is not active");
  return "identical";
}

/** Read only a bounded JSON response from the fixed registry authority. */
async function readRegistry(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "error" });
  if (response.status !== 200) return { status: response.status, data: undefined };
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new Error("MCP registry response exceeds size limit");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return { status: response.status, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const read = name => JSON.parse(readFileSync(path.join(root, name), "utf8"));
  const expected = read("server.json");
  validateRegistryIdentity(expected, read("package.json"), read("distribution/namespaces.json"));
  if (!isDeepStrictEqual(read("release-artifacts/server.json"), expected)) throw new Error("Release descriptor differs from checked-out descriptor");
  const npm = await planNpmRelease(root, path.join(root, "release-artifacts"));
  if (npm.entries.some(item => item.state !== "identical")) throw new Error("Publish the exact validated npm packages before the MCP descriptor");
  const url = `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(expected.name)}/versions/${encodeURIComponent(expected.version)}`;
  const response = await readRegistry(url);
  const state = assessMcpVersion(response.status, response.data, expected);
  if (process.argv.includes("--verify") && state !== "identical") throw new Error("MCP descriptor has not been published");
  const evidence = { schemaVersion: 1, sourceCommit: npm.sourceCommit, name: expected.name, version: expected.version, state, npm: npm.entries, observedAt: new Date().toISOString() };
  writeFileSync(path.join(root, "release-artifacts", process.argv.includes("--verify") ? "mcp-publication-verified.json" : "mcp-publication-preflight.json"), JSON.stringify(evidence, null, 2) + "\n");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publish=${state === "unpublished"}\n`);
}
