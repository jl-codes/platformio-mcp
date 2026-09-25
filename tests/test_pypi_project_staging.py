"""Per-publisher isolation retains cross-project collision checks."""
import hashlib
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("identity", Path(__file__).resolve().parents[1] / "scripts/pypi-release-identity.py")
identity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(identity)

class ProjectStagingTests(unittest.TestCase):
    def run_release(self, project, collision=False):
        with TemporaryDirectory() as temp:
            directory = Path(temp)
            artifacts = []
            for name in identity.PROJECTS:
                filename = name + ".whl"
                data = name.encode()
                (directory / filename).write_bytes(data)
                artifacts.append({"name": name, "version": "3.1.0", "file": filename, "sha256": hashlib.sha256(data).hexdigest()})
            validator = SimpleNamespace(validate=lambda _: {"sourceCommit": "a" * 40, "artifacts": artifacts})
            loader = SimpleNamespace(loader=SimpleNamespace(exec_module=lambda _: None))
            def registry(name, version):
                if collision and name != project:
                    return {"info": {"name": name, "version": version}, "urls": [{"filename": name + ".whl", "digests": {"sha256": "0" * 64}}]}
                return None
            with patch.object(identity.importlib.util, "spec_from_file_location", return_value=loader), patch.object(identity.importlib.util, "module_from_spec", return_value=validator), patch.object(identity, "registry_version", side_effect=registry):
                identity.release(directory, directory / "stage", project=project)
            return sorted(p.name for p in (directory / "stage").rglob("*.whl"))

    def test_each_publisher_receives_only_its_own_distribution(self):
        for project in identity.PROJECTS:
            with self.subTest(project=project):
                self.assertEqual(self.run_release(project), [project + ".whl"])

    def test_other_project_collision_still_blocks_publication(self):
        with self.assertRaisesRegex(ValueError, "differs"):
            self.run_release("pio-agent", collision=True)

    def test_unknown_project_fails_before_staging(self):
        with self.assertRaisesRegex(ValueError, "Unknown"):
            identity.release(Path("unused"), project="unapproved")

if __name__ == "__main__":
    unittest.main()
