"""Stage immutable PyPI release artifacts and verify published filenames/digests without exposing credentials."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
from urllib.error import HTTPError
from urllib.request import build_opener, HTTPRedirectHandler, Request

ROOT = Path(__file__).resolve().parents[1]
PROJECTS = ("pio-agent-platformio", "pio-agent", "pio-mcp")


class NoRedirect(HTTPRedirectHandler):
    """Do not follow registry requests to another authority."""
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return None


def registry_version(name, version):
    """Return bounded public version metadata; only a genuine 404 means unpublished."""
    request = Request(f"https://pypi.org/pypi/{name}/{version}/json", headers={"User-Agent": "platformio-mcp-release"})
    try:
        with build_opener(NoRedirect()).open(request, timeout=15) as response:
            body = response.read(2 * 1024 * 1024 + 1)
            if len(body) > 2 * 1024 * 1024:
                raise ValueError("PyPI version metadata exceeds the release lookup bound")
            return json.loads(body)
    except HTTPError as error:
        if error.code == 404:
            return None
        raise


def assess(metadata, name, version, expected):
    """Reject foreign identities, extra files and any immutable filename with different bytes."""
    if metadata is None:
        return {item["file"]: "unpublished" for item in expected}
    info = metadata.get("info", {})
    if info.get("name") != name or info.get("version") != version:
        raise ValueError("Published PyPI project/version differs from the release identity")
    rows = metadata.get("urls")
    if not isinstance(rows, list):
        raise ValueError("Invalid PyPI release file inventory")
    published = {item["filename"]: item for item in rows}
    wanted = {item["file"]: item for item in expected}
    if len(published) != len(rows) or set(published) - set(wanted):
        raise ValueError("PyPI release contains unexpected or duplicate files; use a new release version")
    for filename, item in published.items():
        if item.get("digests", {}).get("sha256") != wanted[filename]["sha256"] or item.get("yanked"):
            raise ValueError("Published PyPI artifact differs or is yanked; use a new release version")
    return {filename: "identical" if filename in published else "unpublished" for filename in wanted}


def release(directory, stage=None, verify=None):
    """Validate local wheels, compare public registry identity and stage only absent files."""
    spec = importlib.util.spec_from_file_location("validate_python_release", ROOT / "scripts/validate-python-release.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    identity = module.validate(directory)
    observations = []
    if stage:
        if stage.exists():
            raise ValueError("Publication staging directory must be new")
        stage.mkdir(parents=True)
    for name in PROJECTS:
        expected = [item for item in identity["artifacts"] if item["name"] == name]
        if not expected:
            raise ValueError("Missing required Python distribution")
        states = assess(registry_version(name, expected[0]["version"]), name, expected[0]["version"], expected)
        if verify in ("all", name) and any(value != "identical" for value in states.values()):
            raise ValueError(f"Published files for {name} are incomplete")
        for item in expected:
            state = states[item["file"]]
            observations.append({**item, "state": state})
            if stage and state == "unpublished":
                group = "canonical" if name == PROJECTS[0] else "aliases"
                destination = stage / group / item["file"]
                destination.parent.mkdir(exist_ok=True)
                shutil.copyfile(directory / item["file"], destination)
                if hashlib.sha256(destination.read_bytes()).hexdigest() != item["sha256"]:
                    raise ValueError("Artifact changed while staging")
    result = {"schemaVersion": 1, "sourceCommit": identity["sourceCommit"], "artifacts": observations}
    if stage:
        (stage / "preflight.json").write_text(json.dumps(result, indent=2) + "\n")
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a") as output:
                for group in ("canonical", "aliases"):
                    output.write(f"{group}={'true' if (stage / group).exists() else 'false'}\n")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--stage", type=Path)
    parser.add_argument("--verify", choices=["all", *PROJECTS])
    args = parser.parse_args()
    release(args.directory, args.stage, args.verify)
