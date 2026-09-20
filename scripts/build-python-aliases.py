"""Build functional Python aliases with exact canonical pins and no overlapping command files."""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]

_packages_spec = importlib.util.spec_from_file_location("python_release_packages", ROOT / "scripts/python-release-packages.py")
_packages_module = importlib.util.module_from_spec(_packages_spec)
_packages_spec.loader.exec_module(_packages_module)

_source_spec = importlib.util.spec_from_file_location("python_release_source", ROOT / "scripts/python-release-source.py")
_source_module = importlib.util.module_from_spec(_source_spec)
_source_spec.loader.exec_module(_source_module)
source_identity = _source_module.source_identity


def build_aliases(destination, allow_dirty=False):
    """Generate all buildable aliases from the canonical release version and namespace inventory."""
    identity = source_identity(ROOT, allow_dirty)
    destination = Path(destination).resolve()
    if destination.exists():
        raise ValueError("Alias staging destination must be new")
    package = json.loads((ROOT / "package.json").read_text())
    version = package["version"]
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        raise ValueError("Python release version mapping must be reviewed for prereleases")
    for alias in _packages_module.aliases():
        name = alias["name"]
        module = alias["module"]
        project = destination / name
        shutil.copytree(alias["directory"], project, ignore=shutil.ignore_patterns("__pycache__"))
        shutil.copyfile(ROOT / "LICENSE", project / "LICENSE")
        (project / module / "source.json").write_text(json.dumps(identity,indent=2)+"\n")
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

[tool.setuptools.package-data]
"{module}" = ["source.json"]
'''
        if alias["ownsCommand"]:
            metadata += f'\n[project.scripts]\n"{name}" = "{module}.__main__:main"\n'
        (project / "pyproject.toml").write_text(metadata)
        subprocess.run([sys.executable, "-m", "build", "--wheel", "--no-isolation", str(project), "--outdir", str(destination / "dist")], check=True)
    if source_identity(ROOT, allow_dirty) != identity:
        raise ValueError("Source changed during alias build")
    return destination / "dist"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination")
    parser.add_argument("--allow-dirty", action="store_true")
    args=parser.parse_args()
    print(build_aliases(args.destination,args.allow_dirty))
