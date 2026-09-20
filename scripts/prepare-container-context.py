"""Stage a minimal Docker context from an identity-validated release wheel set; never include workspace secrets."""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]


def prepare(wheels, destination):
    """Require a new context and copy only Linux canonical wheels plus reviewed container sources."""
    if destination.exists():
        raise ValueError("Container staging directory must be new")
    spec = importlib.util.spec_from_file_location("validate_python_release", ROOT / "scripts/validate-python-release.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    identity = module.validate(wheels)
    selected = [item for item in identity["artifacts"] if item["name"] == "pio-agent-platformio" and item["host"] in ("linux-x64", "linux-arm64")]
    if len(selected) != 2:
        raise ValueError("Both native Linux wheel identities are required")
    (destination / "wheels").mkdir(parents=True)
    for item in selected:
        shutil.copyfile(wheels / item["file"], destination / "wheels" / item["file"])
    for name in ("Dockerfile", ".dockerignore"):
        shutil.copyfile(ROOT / "distribution/container" / name, destination / name)
    (destination / "identity.json").write_text(json.dumps({"schemaVersion":1,"sourceCommit":identity["sourceCommit"],"artifacts":selected,"acceptance":"not established by context preparation"},indent=2)+"\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wheels", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    prepare(args.wheels.resolve(), args.destination.resolve())
