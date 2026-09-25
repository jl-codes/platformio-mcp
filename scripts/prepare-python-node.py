"""Stage only the pinned official Node executable and license from a verified archive."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import tarfile
import urllib.request
import zipfile

MAX_ARCHIVE = 128 * 1024 * 1024


def prepare_node(host, destination, archive_bytes=None):
    """Fetch at build time only; verify the complete archive before reading payload members."""
    manifest = json.loads((Path(__file__).resolve().parents[1] / "distribution/python-runtime.json").read_text())
    target = manifest["targets"][host]
    destination = Path(destination)
    if destination.exists():
        raise ValueError("Node destination must be new")
    if archive_bytes is None:
        url = f"https://nodejs.org/dist/v{manifest['nodeVersion']}/{target['archive']}"
        with urllib.request.urlopen(url, timeout=60) as response:
            if response.url != url:
                raise ValueError("Unexpected Node download redirect")
            archive_bytes = response.read(MAX_ARCHIVE + 1)
    if len(archive_bytes) > MAX_ARCHIVE or hashlib.sha256(archive_bytes).hexdigest() != target["sha256"]:
        raise ValueError("Node archive size or checksum mismatch")
    windows = host.startswith("win32-")
    suffix = ".zip" if windows else (".tar.gz" if host.startswith("darwin-") else ".tar.xz")
    prefix = target["archive"][:-len(suffix)]
    executable = "node.exe" if windows else "bin/node"
    members = {}
    if windows:
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            for name in [executable, "LICENSE"]:
                info = archive.getinfo(prefix + "/" + name)
                if info.file_size > MAX_ARCHIVE or info.is_dir():
                    raise ValueError("Invalid Node archive member")
                members[name] = archive.read(info)
    else:
        with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode="r:*") as archive:
            for name in [executable, "LICENSE"]:
                info = archive.getmember(prefix + "/" + name)
                if not info.isfile() or info.size > MAX_ARCHIVE:
                    raise ValueError("Invalid Node archive member")
                members[name] = archive.extractfile(info).read()
    destination.mkdir(parents=True)
    for name, contents in members.items():
        output = destination / name
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(contents)
    (destination / executable).chmod(0o755)
    (destination / "source.json").write_text(json.dumps({"version":manifest["nodeVersion"],"host":host,**target},indent=2)+"\n")


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("host")
    parser.add_argument("destination")
    args=parser.parse_args()
    prepare_node(args.host,args.destination)
