"""Explicitly install and verify the optional PPK2 dependency in a new isolated environment.

This operator command never enumerates or opens hardware and never overwrites an
existing environment. Runtime measurement requests must not invoke this script.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

REQUIREMENTS = """ppk2-api==0.9.2 --hash=sha256:b7fb02156f87d8430bbce0006876d38c8309ada671fbcd15848173b431198803
pyserial==3.5 --hash=sha256:c4451db6ba391ca6ca299fb3ec7bae67a5c55dde170964c7a14ceefec02f2cf0
"""
PROBE = r'''
import importlib.metadata, inspect, json, pathlib, sys
from ppk2_api.ppk2_api import PPK2_API
import serial
expected = {"ppk2-api": "0.9.2", "pyserial": "3.5"}
for name, version in expected.items():
    if importlib.metadata.version(name) != version:
        raise RuntimeError("Unexpected dependency version: " + name)
for name in ("get_modifiers", "use_ampere_meter", "use_source_meter", "set_source_voltage", "toggle_DUT_power", "start_measuring", "stop_measuring", "get_data", "get_samples"):
    if not callable(getattr(PPK2_API, name, None)):
        raise RuntimeError("Missing PPK2 API method: " + name)
root = pathlib.Path(sys.prefix).resolve()
for module_path in (inspect.getfile(PPK2_API), serial.__file__):
    pathlib.Path(module_path).resolve().relative_to(root)
print(json.dumps({"dependencies": expected, "python": sys.version.split()[0], "pythonExecutable": sys.executable, "hardwareContacted": False, "apiImportVerified": True}))
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("environment", type=Path, help="New dedicated virtual-environment directory; must not exist")
    args = parser.parse_args()
    target = args.environment.absolute()
    # Atomic exclusive directory creation prevents accidentally modifying an existing installation.
    target.mkdir(mode=0o700, parents=False, exist_ok=False)
    requirements = target / "ppk2-requirements.txt"
    requirements.write_text(REQUIREMENTS, encoding="utf-8")
    subprocess.run([sys.executable, "-I", "-m", "venv", str(target)], check=True, timeout=120)
    python = target / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    subprocess.run([str(python), "-I", "-m", "pip", "--isolated", "install", "--disable-pip-version-check",
                    "--index-url", "https://pypi.org/simple", "--only-binary=:all:", "--require-hashes", "--no-deps",
                    "-r", str(requirements)], check=True, timeout=180)
    checked = subprocess.run([str(python), "-I", "-c", PROBE], check=True, timeout=30, capture_output=True, text=True)
    evidence = json.loads(checked.stdout)
    # Presence of this record means import/API validation completed, not hardware acceptance.
    (target / "ppk2-setup.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence))


if __name__ == "__main__":
    main()
