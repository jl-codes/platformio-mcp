"""Reject changed child manifests and alias architecture drift before publication."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("publisher", ROOT / "scripts/publish-container-release.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RegistryFixture:
    def __init__(self, children):
        self.children = children

    def get(self, reference):
        return self.children[reference]


class PublicationIdentityTests(unittest.TestCase):
    def setUp(self):
        self.images = {"amd64": "sha256:" + "a" * 64, "arm64": "sha256:" + "b" * 64}
        self.children = {}
        self.rows = []
        for arch, image in self.images.items():
            body = json.dumps({"schemaVersion": 2, "mediaType": "application/vnd.docker.distribution.manifest.v2+json", "config": {"digest": image}}).encode()
            descriptor = module.validate_leaf(body, image)
            self.children[descriptor["digest"]] = body
            self.rows.append({**descriptor, "platform": {"os": "linux", "architecture": arch}})
        self.registry = RegistryFixture(self.children)

    def body(self):
        return json.dumps({"schemaVersion": 2, "mediaType": module.INDEX, "manifests": self.rows}).encode()

    def test_exact_native_index(self):
        self.assertEqual(module.validate_index(self.body(), self.registry, self.images), self.rows)

    def test_changed_child_content(self):
        self.children[self.rows[0]["digest"]] += b" "
        with self.assertRaisesRegex(ValueError, "identity mismatch"):
            module.validate_index(self.body(), self.registry, self.images)

    def test_duplicate_architecture(self):
        self.rows[1]["platform"]["architecture"] = "amd64"
        with self.assertRaisesRegex(ValueError, "architectures"):
            module.validate_index(self.body(), self.registry, self.images)

    def test_wrong_image_configuration(self):
        with self.assertRaisesRegex(ValueError, "differs"):
            module.validate_leaf(next(iter(self.children.values())), "sha256:" + "c" * 64)

    def test_reference_cannot_redirect_registry_lookup(self):
        self.rows[0]["digest"] = "../../elsewhere?tag=latest"
        with self.assertRaisesRegex(ValueError, "Invalid child"):
            module.validate_index(self.body(), self.registry, self.images)


if __name__ == "__main__":
    unittest.main()
