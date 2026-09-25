"""Install exact local release wheels on a native host and retain artifact-bound acceptance evidence."""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import venv

ROOT = Path(__file__).resolve().parents[1]


def load_script(name, filename):
    """Load checked-in validation helpers rather than copying their contracts."""
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def accept(directory, host, evidence):
    """Verify source/artifact identities before installation, then isolate command resolution from global Node."""
    machine = platform.machine().lower()
    architecture = {"amd64": "x64", "x86_64": "x64", "aarch64": "arm64", "arm64": "arm64"}.get(machine)
    actual = f"{sys.platform}-{architecture}"
    if actual != host:
        raise ValueError(f"Expected native host {host}; received {actual}")
    identity = load_script("validate_release", "validate-python-release.py").validate(directory)
    selected = [item for item in identity["artifacts"] if item["host"] in (host, "any")]
    aliases = load_script("python_release_packages", "python-release-packages.py").aliases()
    if len(selected) != 1 + len(aliases):
        raise ValueError("Expected one native canonical wheel and every functional alias wheel")
    canonical = next(item for item in selected if item["name"] == "pio-agent-platformio")
    version = canonical["version"]
    with tempfile.TemporaryDirectory(prefix="ph-") as temporary:
        root = Path(temporary)
        venv.EnvBuilder(with_pip=True).create(root / "venv")
        binary = root / "venv" / ("Scripts" if os.name == "nt" else "bin")
        python = binary / ("python.exe" if os.name == "nt" else "python")
        wheels = [str((directory / item["file"]).resolve()) for item in selected]
        subprocess.run([str(python), "-m", "pip", "install", "--no-index", "--no-deps", *wheels], check=True, timeout=180)
        # First Python release: exercise the upgrade/replacement path with the
        # same immutable wheel set; do not claim a previous published version.
        subprocess.run([str(python), "-m", "pip", "install", "--upgrade", "--force-reinstall", "--no-index", "--no-deps", *wheels], check=True, timeout=180)
        subprocess.run([str(python), "-m", "pip", "check"], check=True, timeout=30)
        environment = os.environ.copy()
        environment.update(PATH=str(binary), PIO_MCP_NO_BROWSER="true", PIO_MCP_DISABLE_DASHBOARD="true", PIO_MCP_DATA_DIR=str(root / "state"))
        commands = []
        for name in ["pio-agent", "platformio-mcp", "pio-mcp", *[item["name"] for item in aliases if item["ownsCommand"]]]:
            executable = binary / (name + (".exe" if os.name == "nt" else ""))
            result = subprocess.run([str(executable), "--version"], capture_output=True, text=True, env=environment, cwd=root, timeout=30, check=True)
            if result.stdout.strip() != version:
                raise ValueError(f"Wrong installed version from {name}")
            commands.append(name)
        for module in [item["module"] for item in aliases]:
            result = subprocess.run([str(python), "-m", module, "--version"], capture_output=True, text=True, env=environment, cwd=root, timeout=30, check=True)
            if result.stdout.strip() != version:
                raise ValueError(f"Wrong installed version from {module}")
        executable = binary / ("pio-agent.exe" if os.name == "nt" else "pio-agent")
        protocol = load_script("installed_mcp", "test-installed-python-mcp.py").check(executable, version)
        signals = load_script("installed_signals", "test-installed-python-signals.py").check(executable, version)
        subprocess.run([str(python), "-m", "pip", "uninstall", "-y", *[item["name"] for item in aliases]], check=True, timeout=30)
        result = subprocess.run([str(executable), "--version"], capture_output=True, text=True, env=environment, cwd=root, timeout=30, check=True)
        if result.stdout.strip() != version:
            raise ValueError("Uninstalling aliases damaged the canonical launcher")
    report = {"schemaVersion": 1, "outcome": "pass", "sourceCommit": identity["sourceCommit"], "host": host,
              "environment": {"os": platform.platform(), "python": platform.python_version(), "machine": platform.machine()},
              "timestamp": datetime.now(timezone.utc).isoformat(), "artifacts": selected, "commands": commands,
              "functionalAliases": [item["name"] for item in aliases], "aliasUninstallPreservesCanonical": True, "upgrade": "same-version immutable wheel replacement (first Python release)",
              "mcp": protocol, "signals": signals, "scope": "native installation, CLI aliases, MCP stdio, EOF and native idle-server signal shutdown (POSIX SIGINT/SIGTERM or Windows Ctrl-C); hardware, active-session cleanup, minimum-OS and public-registry acceptance remain separate"}
    evidence.parent.mkdir(parents=True, exist_ok=True)
    evidence.write_text(json.dumps(report, indent=2) + "\n")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("host")
    parser.add_argument("evidence", type=Path)
    args = parser.parse_args()
    accept(args.directory.resolve(), args.host, args.evidence)
