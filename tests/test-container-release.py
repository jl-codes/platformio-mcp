"""Focused rejection checks for container publication identity; no Docker or hardware execution."""
import copy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("container_identity", ROOT / "scripts/validate-container-release.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ContainerIdentityTests(unittest.TestCase):
    def setUp(self):
        self.commit = "a" * 40
        self.image = {"Os": "linux", "Architecture": "amd64", "Id": "sha256:" + "b" * 64,
            "Config": {"User": "10001:10001", "Entrypoint": ["/opt/pio/bin/pio-agent"], "Cmd": ["--disable-dashboard"], "WorkingDir": "/workspace",
                "Labels": {"org.opencontainers.image.source": "https://github.com/jl-codes/platformio-mcp", "org.opencontainers.image.version": "3.0.0", "org.opencontainers.image.revision": self.commit, "org.opencontainers.image.licenses": "MIT"}}}

    def test_expected_native_identity(self):
        self.assertEqual(module.validate_image(self.image, "amd64", "3.0.0", self.commit), self.image["Id"])

    def test_wrong_architecture(self):
        with self.assertRaisesRegex(ValueError, "architecture"):
            module.validate_image(self.image, "arm64", "3.0.0", self.commit)

    def test_stale_or_relabelled_image(self):
        for label in ("source", "version", "revision", "licenses"):
            image = copy.deepcopy(self.image)
            image["Config"]["Labels"]["org.opencontainers.image." + label] = "different"
            with self.subTest(label=label), self.assertRaisesRegex(ValueError, "identity"):
                module.validate_image(image, "amd64", "3.0.0", self.commit)

    def test_changed_runtime_contract(self):
        for key, value in (("User", "root"), ("Entrypoint", ["sh"]), ("Cmd", []), ("WorkingDir", "/")):
            image = copy.deepcopy(self.image)
            image["Config"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                module.validate_image(image, "amd64", "3.0.0", self.commit)


if __name__ == "__main__":
    unittest.main()
