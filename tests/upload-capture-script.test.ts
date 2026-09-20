/** Execute the fixed capture hook without SCons, project scripts, an uploader, or hardware. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { createUploadCaptureScript } from "../src/core/analysis/upload-capture-script.js";
it("records final inputs and returns a stop status without overwriting an earlier capture", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pio-capture-hook-"));
  try {
    const script = createUploadCaptureScript(path.join(root, "capture.json"));
    const python = process.env.pythonLocation
      ? path.join(
          process.env.pythonLocation,
          process.platform === "win32" ? "python.exe" : "bin/python3",
        )
      : process.platform === "win32"
        ? "python"
        : "python3";
    const harness = String.raw`
import json, sys, hashlib
from pathlib import Path
root = Path(sys.argv[1]).resolve()
app = root / "app image.bin"
elf = root / "firmware.elf"
boot = root / "boot.bin"
app.write_bytes(b"app")
elf.write_bytes(b"elf")
boot.write_bytes(b"boot")
class Node:
    def get_abspath(self): return str(app)
class Env(dict):
    def subst(self, value, **kwargs):
        if value == self.original: return 'python esptool.py write_flash 0x1000 "' + str(boot) + '" 0x10000 "' + str(app) + '"'
        return self.get(value.lstrip("$"), value)
    def Replace(self, **values): self.update(values)
    def GetProjectOptions(self): return {"board": "fixture", "secret": "never serialized"}
env = Env(UPLOADCMD="original command", UPLOAD_PROTOCOL="esptool", PROJECT_DIR=str(root), PIOENV="fixture", CC="compiler", PROG_PATH=str(elf), ESP32_APP_OFFSET="0x10000", FLASH_EXTRA_IMAGES=[("0x1000", str(boot))])
env.original = env["UPLOADCMD"]
exec(PROGRAM, {"env": env, "Import": lambda name: None})
assert callable(env["UPLOADCMD"])
assert env["UPLOADCMD"]([], [Node()], env) == 86
record_path = root / "capture.json"
encoded = record_path.read_text()
record = json.loads(encoded)
assert record["captureOnly"] is True
assert record["images"][0]["offset"] == 0x1000
assert record["images"][1]["sha256"] == hashlib.sha256(b"app").hexdigest()
assert record["elf"]["sha256"] == hashlib.sha256(b"elf").hexdigest()
assert "never serialized" not in encoded
try:
    env["UPLOADCMD"]([], [Node()], env)
    raise AssertionError("existing capture was overwritten")
except FileExistsError:
    pass
assert record_path.read_text() == encoded
print(json.dumps({"captured": True, "stopped": True}))
`;
    const result = spawnSync(
      python,
      [
        "-I",
        "-S",
        "-c",
        "PROGRAM = " + JSON.stringify(script) + "\n" + harness,
        root,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      captured: true,
      stopped: true,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 15000);
