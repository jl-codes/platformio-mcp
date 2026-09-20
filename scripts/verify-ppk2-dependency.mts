/** Verify installed dependency imports and rejection of version drift without constructing a meter. */
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PPK2_BRIDGE } from "../src/core/power/ppk2-bridge.js";
const python = process.argv[2];
assert(python && path.isAbsolute(python), "Pass the absolute isolated environment interpreter");
const program = `
import importlib.metadata, json, sys
namespace = {"__name__": "fixture"}
exec(compile(sys.stdin.read(), "<ppk2-bridge>", "exec"), namespace)
api = namespace["load_api"]()
assert callable(api.get_samples)
original = importlib.metadata.version
for changed in ("ppk2-api", "pyserial"):
    importlib.metadata.version = lambda name: "unexpected" if name == changed else original(name)
    try:
        namespace["load_api"]()
    except RuntimeError as error:
        assert str(error) == "PPK2_API_INCOMPATIBLE"
    else:
        raise AssertionError("Version drift accepted")
importlib.metadata.version = original
print(json.dumps({"passed": True, "hardwareContacted": False, "installedVersions": {name: original(name) for name in ("ppk2-api", "pyserial")}, "rejectedVersionChanges": 2}))
`;
const result = spawnSync(python, ["-I", "-c", program], { input: PPK2_BRIDGE, encoding: "utf8", timeout: 30000, maxBuffer: 65536, windowsHide: true });
assert.equal(result.status, 0, result.stderr || result.error?.message);
const evidence = JSON.parse(result.stdout);
assert.equal(evidence.passed, true);
console.log(JSON.stringify(evidence));
