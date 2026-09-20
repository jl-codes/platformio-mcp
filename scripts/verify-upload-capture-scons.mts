/** Verify the current capture hook against real SCons actions with synthetic files and no hardware. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { createUploadCaptureScript } from "../src/core/analysis/upload-capture-script.js";

const [python, sconsRoot, output] = process.argv.slice(2);
if (
  !python ||
  !sconsRoot ||
  !output ||
  !path.isAbsolute(python) ||
  !path.isAbsolute(sconsRoot)
)
  throw new Error(
    "Supply absolute Python executable, installed scons-local-4.8.1 directory, and evidence output path",
  );
const root = fs.mkdtempSync(
  path.join(fs.realpathSync(os.tmpdir()), "pio-real-scons-"),
);
const implementation = path.resolve(
  "src/core/analysis/upload-capture-script.ts",
);
const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
try {
  const hook = createUploadCaptureScript(path.join(root, "selection.json"));
  const program = String.raw`
import sys, json, os, hashlib
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.path.insert(0, sys.argv[1])
import SCons, SCons.Action, SCons.Environment
assert SCons.__version__ == "4.8.1", "Unexpected SCons version"
root = Path(sys.argv[2]).resolve()
app = root / "application space \u03bb.bin"
elf = root / "firmware.elf"
app.write_bytes(b"application")
elf.write_bytes(b"ELF fixture")
marker = root / "uploader-executed"
uploader = root / "must-not-run.py"
uploader.write_text("from pathlib import Path\nPath(" + repr(str(marker)) + ").write_text('ran')\n")
results = []
for offset in [0, 65536]:
    env = SCons.Environment.Environment(tools=[])
    env.Replace(UPLOAD_PROTOCOL="esptool", PROJECT_DIR=str(root), PIOENV="fixture", CC=sys.executable, PROG_PATH=str(elf))
    env.AddMethod(lambda self: {"board": "fixture"}, "GetProjectOptions")
    env.Replace(UPLOADCMD='"' + sys.executable + '" "' + str(uploader) + '" write_flash ' + str(offset) + ' "' + str(app) + '"')
    later = []
    def after(target, source, env):
        later.append("unexpected-later-action")
        return 0
    # Construct before replacing UPLOADCMD, as PlatformIO does with its lazy action list.
    action = SCons.Action.Action(["$UPLOADCMD", after])
    scope = {"env": env, "Import": lambda name: None}
    exec(HOOK, scope)
    status = action([], [env.File(str(app))], env)
    assert isinstance(status, SCons.Errors.BuildError) and status.status == 86, status
    assert status.exitstatus == 2, status.exitstatus
    assert not later and not marker.exists(), "Capture continued into uploader or post-action"
    record_path = root / "selection.json"
    record = json.loads(record_path.read_text())
    assert record["captureOnly"] is True
    assert record["argv"] == [sys.executable, str(uploader), "write_flash", str(offset), str(app)]
    assert Path(record["compiler"]).resolve() == Path(sys.executable).resolve()
    assert record["images"][0]["offset"] == offset
    assert record["images"][0]["sha256"] == hashlib.sha256(app.read_bytes()).hexdigest()
    assert record["elf"]["sha256"] == hashlib.sha256(elf.read_bytes()).hexdigest()
    results.append({"offset": offset, "actionStatus": status.status, "sconsExitStatus": status.exitstatus, "exactArgv": True, "resolvedCompiler": True, "capturedHashes": True, "originalUploaderExecuted": False, "laterActionsExecuted": later})
    record_path.unlink()
print("EVIDENCE:" + json.dumps({"sconsVersion": SCons.__version__, "pythonVersion": sys.version.split()[0], "cases": results}))
`;
  const result = spawnSync(
    python,
    [
      "-I",
      "-S",
      "-c",
      "HOOK = " + JSON.stringify(hook) + "\n" + program,
      sconsRoot,
      root,
    ],
    {
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(
      result.error?.message ?? result.stderr ?? "SCons acceptance failed",
    );
  const line = result.stdout
    .split(/\r?\n/)
    .find((value) => value.startsWith("EVIDENCE:"));
  if (!line) throw new Error("SCons returned no evidence");
  const evidence = {
    ...JSON.parse(line.slice(9)),
    observedAt: new Date().toISOString(),
    host: `${process.platform}-${process.arch}`,
    sourceBase: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    implementationSha256: sha(fs.readFileSync(implementation)),
    verifierSha256: sha(fs.readFileSync(new URL(import.meta.url))),
    hookSha256: sha(hook),
    scope:
      "Real SCons 4.8.1 lazy/list actions with synthetic inputs; current command parsing, resolved compiler, both application offsets and stop-before-upload verified.",
    hardwareExecuted: false,
    limits: [
      "No PlatformIO build or native uploader executed",
      "Physical device and full retained-upload acceptance remain required",
    ],
  };
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(JSON.stringify(evidence));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
