"""Bind native container archives and all seven alias targets to the exact release source."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ALIASES = ("platformio-mcp", "platformio.mcp", "pio-mcp", "pio-agent", "platformiomcp", "pioagent", "flashagent")


def digest_file(filename):
    """Hash large Docker archives without loading them into memory."""
    with filename.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def validate_image(image, arch, version, commit):
    """Check native architecture, immutable source labels and the supported non-root entrypoint."""
    if image.get("Os") != "linux" or image.get("Architecture") != arch:
        raise ValueError("Native container architecture mismatch")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", image.get("Id", "")):
        raise ValueError("Invalid image configuration digest")
    config = image.get("Config", {})
    labels = config.get("Labels", {})
    expected = {
        "org.opencontainers.image.source": "https://github.com/jl-codes/platformio-mcp",
        "org.opencontainers.image.version": version,
        "org.opencontainers.image.revision": commit,
        "org.opencontainers.image.licenses": "MIT",
    }
    if any(labels.get(key) != value for key, value in expected.items()):
        raise ValueError("Container source/version/license identity mismatch")
    if config.get("User") != "10001:10001" or config.get("Entrypoint") != ["/opt/pio/bin/pio-agent"] or config.get("Cmd") != ["--disable-dashboard"]:
        raise ValueError("Container runtime contract mismatch")
    if config.get("WorkingDir") != "/workspace":
        raise ValueError("Container workspace mismatch")
    return image["Id"]


def validate(directory, loaded=False):
    """Require both native archives and their same-commit metadata before any publication."""
    directory = Path(directory).resolve()
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    version = json.loads((ROOT / "package.json").read_text())["version"]
    inventory = json.loads((ROOT / "distribution/namespaces.json").read_text())
    names = [entry["name"] for entry in inventory["entries"] if entry["registry"] == "ghcr"]
    expected_names = [f"ghcr.io/jl-codes/{alias}" for alias in ALIASES]
    if len(names) != len(expected_names) or set(names) != set(expected_names):
        raise ValueError("All seven requested container aliases must be accounted for")
    artifacts = []
    for arch in ("amd64", "arm64"):
        archive = directory / f"pio-agent-{arch}.tar"
        checksum = (directory / f"pio-agent-{arch}.sha256").read_text().split()
        actual = digest_file(archive)
        if len(checksum) != 2 or checksum[0] != actual or Path(checksum[1]).name != archive.name:
            raise ValueError("Container archive checksum mismatch")
        source = json.loads((directory / f"source-{arch}.json").read_text())
        if source.get("sourceCommit") != commit:
            raise ValueError("Stale container source identity")
        wheels = source.get("artifacts", [])
        if len(wheels) != 2 or {item.get("host") for item in wheels} != {"linux-x64", "linux-arm64"}:
            raise ValueError("Container context must contain both native wheel identities")
        if any(item.get("name") != "pio-agent-platformio" for item in wheels):
            raise ValueError("Unexpected container wheel identity")
        images = json.loads((directory / f"image-{arch}.json").read_text())
        if not isinstance(images, list) or len(images) != 1:
            raise ValueError("Expected exactly one native image")
        image_id = validate_image(images[0], arch, version, commit)
        if loaded:
            # Loading occurs only after checksum/source checks. Inspect by immutable ID,
            # since both saved archives may carry the same local convenience tag.
            subprocess.run(["docker", "load", "--input", str(archive)], check=True, timeout=600)
            inspected = json.loads(subprocess.check_output(["docker", "image", "inspect", image_id], timeout=30))
            if len(inspected) != 1 or validate_image(inspected[0], arch, version, commit) != image_id:
                raise ValueError("Loaded archive differs from declared native image")
        artifacts.append({"architecture": arch, "archive": archive.name, "sha256": actual, "imageId": image_id})
    return {"schemaVersion": 1, "sourceCommit": commit, "version": version, "targets": expected_names, "artifacts": artifacts, "loadedImagesVerified": loaded, "publication": "not performed"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--load", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = validate(args.directory, args.load)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
