"""Reject invalid archive inputs before writing or executing downloaded content."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location("prepare_node",Path(__file__).resolve().parents[3] / "scripts/prepare-python-node.py")
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NodeArchiveTests(unittest.TestCase):
    def test_bad_hash_writes_nothing(self):
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/"node"
            with self.assertRaisesRegex(ValueError,"checksum"):
                module.prepare_node("win32-x64",target,b"untrusted bytes")
            self.assertFalse(target.exists())

    def test_existing_destination_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            marker=Path(directory)/"marker"
            marker.write_text("keep")
            with self.assertRaisesRegex(ValueError,"must be new"):
                module.prepare_node("win32-x64",directory,b"unused")
            self.assertEqual(marker.read_text(),"keep")

    def test_unsupported_host_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(KeyError):
                module.prepare_node("linux-musl-x64",Path(directory)/"node",b"unused")


if __name__ == "__main__":
    unittest.main()
