/** Execute the fixed Python bridge with an isolated fake converter, without optional installs. */
import { execFileSync, spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { ESP_COREDUMP_CONVERTER } from "../src/core/analysis/esp-coredump-converter.js";
const python = process.platform === "win32" ? "python" : "python3";
it("returns a typed error for an installed but unapproved converter version", () => {
  const result = spawnSync(
    python,
    [
      "-I",
      "-c",
      'import importlib.metadata\nimportlib.metadata.version = lambda name: "0.0.0"\n' +
        ESP_COREDUMP_CONVERTER,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(2);
  expect(JSON.parse(result.stdout)).toEqual({
    error: "COREDUMP_TOOL_VERSION_MISMATCH",
  });
}, 15000);
it("converts only file inputs and confines intermediate outputs to the supplied staging directory", () => {
  const harness = String.raw`
import importlib.metadata, sys, types, tempfile
from pathlib import Path
importlib.metadata.version = lambda name: "1.10.0"
module = types.ModuleType("esp_coredump.corefile.loader")
class FakeLoader:
    def __init__(self, raw, is_b64):
        assert is_b64 is False
        self.temp_files = []
    def create_corefile(self, exe_name, e_machine):
        assert e_machine == 94
        self._create_temp_file()
        self.core_elf_file = self._create_temp_file()
        Path(self.core_elf_file).write_bytes(bytes.fromhex("7f454c46010101"))
module.ESPCoreDumpFileLoader = FakeLoader
sys.modules["esp_coredump.corefile.loader"] = module
with tempfile.TemporaryDirectory() as directory:
    staging = Path(directory).resolve()
    raw = staging / "dump.raw"
    elf = staging / "firmware.elf"
    raw.write_bytes(b"raw")
    elf.write_bytes(b"elf")
    sys.argv = ["converter", str(raw), str(elf), str(staging), "94"]
    exec(PROGRAM)
    assert len(list(staging.glob("converted-*"))) == 1
`;
  const output = execFileSync(
    python,
    [
      "-I",
      "-c",
      "PROGRAM = " + JSON.stringify(ESP_COREDUMP_CONVERTER) + "\n" + harness,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  expect(JSON.parse(output)).toMatchObject({ converter_version: "1.10.0" });
}, 15000);
