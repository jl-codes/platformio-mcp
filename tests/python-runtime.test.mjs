/** Exercise the Python wheel's shared CLI staging payload outside the repository. */
import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {buildPythonRuntime} from "../scripts/build-python-runtime.mjs";

test("isolated wheel CLI payload retains version, help and plugin validation", async () => {
  const parent=mkdtempSync(path.join(tmpdir(),"pio-wheel-contract-"));
  const target=path.join(parent,"payload");
  try {
    await buildPythonRuntime(target);
    const cli=path.join(target,"runtime/cli.mjs");
    const invoke=args=>execFileSync(process.execPath,[cli,...args],{cwd:parent,encoding:"utf8",timeout:30000,env:{...process.env,NODE_PATH:"",PIO_MCP_NO_BROWSER:"true"}});
    const pkg=JSON.parse(readFileSync(new URL("../package.json",import.meta.url),"utf8"));
    assert.equal(invoke(["--version"]).trim(),pkg.version);
    assert.match(invoke(["--help"]),/platformio-mcp/);
    const validation=JSON.parse(invoke(["plugin","validate","--require-runtime"]));
    assert.equal(validation.success,true);
    assert.equal(validation.runtimePresent,true);
    await assert.rejects(()=>buildPythonRuntime(target),/must be new/);
  } finally {
    const resolved=path.resolve(parent);
    if (path.dirname(resolved)!==path.resolve(tmpdir()) || !path.basename(resolved).startsWith("pio-wheel-contract-")) throw new Error("Unsafe fixture cleanup");
    rmSync(resolved,{recursive:true,force:true});
  }
});
