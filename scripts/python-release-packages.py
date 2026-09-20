"""Resolve buildable Python aliases and publication-eligible projects from the namespace inventory."""
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
EXISTING = {"pio-agent", "pio-mcp"}
CANONICAL = "pio-agent-platformio"


def aliases(root=ROOT):
    """Keep existing aliases and reject normalized collisions or paths outside the alias tree."""
    root = Path(root).resolve()
    inventory = json.loads((root / "distribution/namespaces.json").read_text())
    selected = []
    seen = set()
    for entry in inventory["entries"]:
        if entry["registry"] != "pypi" or entry.get("role") not in ("candidate_alias", "functional_alias"):
            continue
        if not entry.get("packagePath"):
            if entry.get("publishIntent"):
                raise ValueError("Publishing alias lacks functional package source")
            continue
        name = entry["name"]
        normalized = re.sub(r"[-_.]+", "-", name).lower()
        if not re.fullmatch(r"[a-z][a-z0-9-]*", name) or normalized in seen or normalized == CANONICAL:
            raise ValueError("Invalid or normalized duplicate Python alias")
        seen.add(normalized)
        directory = (root / entry["packagePath"]).resolve()
        expected = (root / "packages/python-aliases" / name).resolve()
        if directory != expected or not directory.is_relative_to(root / "packages/python-aliases") or not directory.is_dir():
            raise ValueError("Python alias source path differs from its identity")
        if entry.get("source") != inventory["canonicalSource"]:
            raise ValueError("Python alias source repository differs")
        if entry.get("publishIntent") and name not in EXISTING and not (entry.get("publicationControlVerified") is True and entry.get("namingEligibilityVerified") is True):
            raise ValueError("New Python publishers require verified authority and eligibility")
        selected.append({**entry, "directory": directory, "module": name.replace("-", "_") + "_alias", "ownsCommand": name not in EXISTING})
    if not EXISTING.issubset({item["name"] for item in selected if item.get("publishIntent")}):
        raise ValueError("Existing Python aliases cannot be removed from publication")
    return sorted(selected, key=lambda item: item["name"])


def publishers(root=ROOT):
    """Candidates can be built and validated without silently enabling publication."""
    return [CANONICAL, *[item["name"] for item in aliases(root) if item.get("publishIntent")]]


if __name__ == "__main__":
    print(",".join(publishers()))
