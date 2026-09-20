"""Publish validated native images under seven GHCR aliases with identical immutable version indexes."""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
import subprocess
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
INDEX = "application/vnd.docker.distribution.manifest.list.v2+json"
ACCEPT = ", ".join([INDEX, "application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.v2+json", "application/vnd.oci.image.manifest.v1+json"])


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Registry redirect refused")


def request(url, headers=None, data=None, method=None, missing=False):
    """Bound registry responses and refuse redirects, authentication failures and ambiguous absence."""
    try:
        with urllib.request.build_opener(NoRedirect()).open(urllib.request.Request(url, data=data, headers=headers or {}, method=method), timeout=30) as response:
            body = response.read(2 * 1024 * 1024 + 1)
            if len(body) > 2 * 1024 * 1024:
                raise ValueError("Registry response exceeds limit")
            return body
    except urllib.error.HTTPError as error:
        if missing and error.code == 404:
            return None
        raise ValueError(f"Registry request failed (HTTP {error.code})") from None


class Registry:
    """Use narrowly scoped GHCR bearer tokens without logging credentials."""
    def __init__(self, repository, anonymous=False):
        self.repository = repository.removeprefix("ghcr.io/")
        headers = {}
        access = "pull"
        if not anonymous:
            credentials = os.environ["GHCR_ACTOR"] + ":" + os.environ["GHCR_TOKEN"]
            headers["Authorization"] = "Basic " + base64.b64encode(credentials.encode()).decode()
            access = "pull,push"
        query = urllib.parse.urlencode({"service": "ghcr.io", "scope": f"repository:{self.repository}:{access}"})
        response = json.loads(request("https://ghcr.io/token?" + query, headers))
        self.token = response["token"]

    def get(self, reference, missing=False):
        return request(f"https://ghcr.io/v2/{self.repository}/manifests/{reference}", {"Authorization": "Bearer " + self.token, "Accept": ACCEPT}, missing=missing)

    def put(self, reference, body):
        request(f"https://ghcr.io/v2/{self.repository}/manifests/{reference}", {"Authorization": "Bearer " + self.token, "Content-Type": json.loads(body)["mediaType"]}, body, "PUT")


def digest(body):
    return "sha256:" + hashlib.sha256(body).hexdigest()


def validate_leaf(body, image_id):
    """Compare the registry manifest's configuration digest to the validated loaded image."""
    manifest = json.loads(body)
    if manifest.get("schemaVersion") != 2 or manifest.get("config", {}).get("digest") != image_id:
        raise ValueError("Registry image differs from the validated native archive")
    if manifest.get("mediaType") not in ("application/vnd.docker.distribution.manifest.v2+json", "application/vnd.oci.image.manifest.v1+json"):
        raise ValueError("Expected a native image manifest")
    return {"mediaType": manifest["mediaType"], "size": len(body), "digest": digest(body)}


def validate_index(body, registry, images):
    """Require exactly the two supported native images and verify each child by digest."""
    index = json.loads(body)
    rows = index.get("manifests", [])
    if index.get("schemaVersion") != 2 or index.get("mediaType") not in (INDEX, "application/vnd.oci.image.index.v1+json") or len(rows) != 2:
        raise ValueError("Conflicting version index")
    seen = set()
    for row in rows:
        platform = row.get("platform", {})
        arch = platform.get("architecture")
        if platform.get("os") != "linux" or arch not in images or arch in seen:
            raise ValueError("Conflicting version architectures")
        seen.add(arch)
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", row.get("digest", "")):
            raise ValueError("Invalid child manifest digest")
        child = registry.get(row["digest"])
        descriptor = validate_leaf(child, images[arch])
        if any(row.get(key) != value for key, value in descriptor.items()):
            raise ValueError("Child manifest identity mismatch")
    return rows


def publish(directory, output):
    """Preflight every alias before writes, retain identical indexes, then require anonymous reads."""
    spec = importlib.util.spec_from_file_location("container_release", ROOT / "scripts/validate-container-release.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    identity = module.validate(directory, loaded=True)
    if os.environ.get("GITHUB_REPOSITORY") != "jl-codes/platformio-mcp" or os.environ.get("GITHUB_REF") != "refs/tags/v" + identity["version"]:
        raise ValueError("Container publication requires the canonical repository release tag")
    if os.environ.get("GHCR_PUBLISHERS_VERIFIED") != ",".join(identity["targets"]):
        raise ValueError("Verify authority and configure all seven GHCR targets first")
    inventory = json.loads((ROOT / "distribution/namespaces.json").read_text())
    for entry in inventory["entries"]:
        if entry["registry"] == "ghcr" and not (entry.get("publishIntent") and entry.get("publicationControlVerified") and entry.get("namingEligibilityVerified")):
            raise ValueError("GHCR candidates must be promoted with verified authority and naming eligibility")
    images = {item["architecture"]: item["imageId"] for item in identity["artifacts"]}
    registries = {target: Registry(target) for target in identity["targets"]}
    version = identity["version"]
    existing_index = None
    # No external writes occur until all existing version and architecture tags have passed.
    for target, registry in registries.items():
        body = registry.get(version, missing=True)
        if body is not None:
            validate_index(body, registry, images)
            if existing_index is not None and body != existing_index:
                raise ValueError("Existing aliases have different index digests")
            existing_index = body
        for arch, image_id in images.items():
            body = registry.get(f"{version}-{arch}", missing=True)
            if body is not None:
                validate_leaf(body, image_id)
    expected_index = existing_index
    evidence = {**identity, "publication": "in_progress", "aliases": []}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(evidence, indent=2) + "\n")
    for target, registry in registries.items():
        descriptors = []
        for arch, image_id in images.items():
            tag = f"{version}-{arch}"
            body = registry.get(tag, missing=True)
            if body is None:
                subprocess.run(["docker", "tag", image_id, f"{target}:{tag}"], check=True, timeout=30)
                subprocess.run(["docker", "push", f"{target}:{tag}"], check=True, timeout=900)
                body = registry.get(tag)
            descriptor = validate_leaf(body, image_id)
            descriptors.append({**descriptor, "platform": {"architecture": arch, "os": "linux"}})
        if expected_index is None:
            expected_index = json.dumps({"schemaVersion": 2, "mediaType": INDEX, "manifests": descriptors}, separators=(",", ":")).encode()
        # Every alias repository must contain the exact children referenced by the shared index.
        validate_index(expected_index, registry, images)
        current = registry.get(version, missing=True)
        if current is not None and current != expected_index:
            raise ValueError("Refusing to replace a conflicting version tag")
        if current is None:
            registry.put(version, expected_index)
        if registry.get(version) != expected_index:
            raise ValueError("Published version digest mismatch")
        evidence["aliases"].append({"name": target, "version": version, "digest": digest(expected_index), "anonymousAccess": False})
        output.write_text(json.dumps(evidence, indent=2) + "\n")
    for row in evidence["aliases"]:
        anonymous = Registry(row["name"], anonymous=True)
        body = anonymous.get(version)
        if body != expected_index:
            raise ValueError("Public alias differs from the published release")
        validate_index(body, anonymous, images)
        row["anonymousAccess"] = True
        output.write_text(json.dumps(evidence, indent=2) + "\n")
    evidence["publication"] = "verified_public_manifests"
    evidence["remainingAcceptance"] = "Registry-pulled native execution and hardware acceptance are recorded separately."
    output.write_text(json.dumps(evidence, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    publish(args.directory, args.output)
