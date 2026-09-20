"""Build functional Python aliases with exact canonical pins and no overlapping command files."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def build_aliases(destination):
    """Generate both aliases from the canonical release version and namespace inventory."""
    destination = Path(destination).resolve()
    if destination.exists():
        raise ValueError("Alias staging destination must be new")
    package = json.loads((ROOT / "package.json").read_text())
    version = package["version"]
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("Python release version mapping must be reviewed for prereleases")
    inventory = json.loads((ROOT / "distribution/namespaces.json").read_text())
    allowed = {entry["name"] for entry in inventory["entries"] if entry["registry"] == "pypi" and entry["publishIntent"]}
    if not {"pio-agent-platformio", "pio-agent", "pio-mcp"}.issubset(allowed):
        raise ValueError("Python release identities differ from the namespace inventory")
    for name in ["pio-agent", "pio-mcp"]:
        module = name.replace("-", "_") + "_alias"
        project = destination / name
        shutil.copytree(ROOT / "packages/python-aliases" / name, project, ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copyfile(ROOT / "LICENSE", project / "LICENSE")
        metadata = f'''[build-system]
requires = ["setuptools==84.0.0", "wheel==0.48.0"]
build-backend = "setuptools.build_meta"

[project]
name = "{name}"
version = "{version}"
description = "Compatibility launcher for the canonical PlatformIO MCP engine"
requires-python = ">=3.11"
license = "MIT"
dependencies = ["pio-agent-platformio=={version}"]

[project.urls]
Repository = "https://github.com/jl-codes/platformio-mcp"

[project.optional-dependencies]
platformio = ["pio-agent-platformio[platformio]=={version}"]

[tool.setuptools]
packages = ["{module}"]
'''
        (project / "pyproject.toml").write_text(metadata)
        subprocess.run([sys.executable, "-m", "build", "--wheel", "--no-isolation", str(project), "--outdir", str(destination / "dist")], check=True)
    return destination / "dist"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination")
    print(build_aliases(parser.parse_args().destination))
