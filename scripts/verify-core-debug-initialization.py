"""Exercise the repository's inert generation fragment using installed Core, without building or touching hardware."""
import hashlib
import json
import os
from pathlib import Path
import sys
import subprocess
import tempfile
from types import SimpleNamespace
import platformio
from platformio.debug.config.base import DebugConfigBase
from platformio.debug.process.gdb import GDBClientProcess

source = (Path(__file__).resolve().parents[1] / "src/core/debug/debug-resolved-config.ts").read_text(encoding="utf-8")
bridge = source.split("const resolutionScript = String.raw`", 1)[1].split("`;", 1)[0]
bootstrap = bridge.split("with contextlib.redirect_stdout(sys.stderr):", 1)[0]
isolated = subprocess.run([sys.executable, "-I", "-c", bootstrap + "\nimport platformio; print(platformio.__version__)"], check=True, capture_output=True, text=True, timeout=15)
assert isolated.stdout.strip() == platformio.__version__
fragment = bridge[bridge.index("    markers ="):bridge.index("    result = dict(")]
fragment = "\n".join(line[4:] if line.startswith("    ") else line for line in fragment.splitlines())

class FixtureConfiguration(DebugConfigBase):
    GDB_INIT_SCRIPT = 'file "$PROG_PATH"\ndirectory "$PROG_DIR"\ntarget remote $DEBUG_PORT\n$LOAD_CMDS\n$INIT_BREAK'

results = []
with tempfile.TemporaryDirectory(prefix="pio-core-init-proof-") as root:
    for custom in (False, True):
        for load in (False, True):
            debug = FixtureConfiguration.__new__(FixtureConfiguration)
            debug.project_config = SimpleNamespace(get=lambda *args: root)
            debug.env_options = {"debug_extra_cmds": ["echo retained-extra"], "debug_init_break": "tbreak main", "upload_protocol": "fixture"}
            if custom:
                debug.env_options["debug_init_cmds"] = ['file "$PROG_PATH"', "target remote $DEBUG_PORT", "$LOAD_CMDS"]
            debug.build_data = {"prog_path": os.path.join(root, "original firmware.elf")}
            debug.tool_name = "fixture-probe"
            debug.tool_settings = {}
            debug.board_config = {}
            debug._port = ":3333"
            debug.load_cmds = ['load "$PROG_PATH"'] if load else []
            namespace = dict(debug=debug, SimpleNamespace=SimpleNamespace, GDBClientProcess=GDBClientProcess, tempfile=tempfile, os=os)
            exec(compile(fragment, "repository-generation-fragment", "exec"), namespace)
            script, template = namespace["generated_script"], namespace["generated_template"]
            assert "__PIO_MCP_INIT_ELF_PATH__" in template
            assert "__PIO_MCP_INIT_ENDPOINT__" in template
            assert "original firmware.elf" not in template
            assert template.count("echo retained-extra") == 1
            assert ('load "__PIO_MCP_INIT_ELF_PATH__"' in template) == load
            assert "define pio_restart_target" in template
            assert "original firmware.elf" in script
            results.append(dict(customInitialization=custom, load=load, templateSha256=hashlib.sha256(template.encode()).hexdigest()))
report = dict(isolatedCoreImport=True, coreVersion=platformio.__version__, pythonVersion=sys.version.split()[0], generationFragmentSha256=hashlib.sha256(fragment.encode()).hexdigest(), cases=results, scope="Installed Core generator and reveal_patterns with inert configuration fixtures; no resolver package hooks, backend, GDB process or hardware execution")
if len(sys.argv) > 1:
    Path(sys.argv[1]).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2))
