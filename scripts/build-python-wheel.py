"""Assemble a platform wheel from the canonical CLI and pinned redistributable Node."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def build_wheel(host, destination):
    """Use a fresh staging directory and produce one platform-specific wheel without publishing."""
    destination = Path(destination).resolve()
    if destination.exists():
        raise ValueError("Wheel staging destination must be new")
    support = json.loads((ROOT / "distribution/python-runtime.json").read_text())
    target = support["targets"][host]
    package = json.loads((ROOT / "package.json").read_text())
    source = ROOT / "packages/python-launcher"
    destination.mkdir(parents=True)
    shutil.copytree(source / "src", destination / "src", ignore=shutil.ignore_patterns("__pycache__", "payload"))
    for name in ["pyproject.toml", "setup.py"]:
        shutil.copyfile(source / name, destination / name)
    shutil.copyfile(ROOT / "LICENSE", destination / "LICENSE")
    (destination / "VERSION").write_text(package["version"] + "\n")
    payload = destination / "src/pio_agent_launcher/payload"
    subprocess.run(["node", str(ROOT / "scripts/build-python-runtime.mjs"), str(payload)], check=True)
    spec = importlib.util.spec_from_file_location("prepare_node", ROOT / "scripts/prepare-python-node.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.prepare_node(host, payload / "node")
    inventory = []
    for item in sorted(payload.rglob("*")):
        if item.is_file():
            with item.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            inventory.append({"path":item.relative_to(payload).as_posix(),"bytes":item.stat().st_size,"sha256":digest})
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    (payload / "payload.json").write_text(json.dumps({"schemaVersion":1,"host":host,"wheelTag":target["wheelTag"],"version":package["version"],"sourceCommit":commit,"nodeVersion":support["nodeVersion"],"minimums":support["minimums"],"files":inventory},indent=2)+"\n")
    subprocess.run([sys.executable,"-m","build","--wheel","--no-isolation",str(destination)],check=True)
    return destination / "dist"


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("host")
    parser.add_argument("destination")
    args=parser.parse_args()
    print(build_wheel(args.host,args.destination))
