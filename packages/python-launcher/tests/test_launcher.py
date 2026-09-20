"""Launcher contract tests; these do not replace installed-wheel acceptance."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from pio_agent_launcher.__main__ import launch_spec, MINIMUMS


class LauncherTests(unittest.TestCase):
    def setUp(self):
        # Payload tests model Windows independently of the machine running the tests.
        windows = patch("pio_agent_launcher.__main__.sys.getwindowsversion", create=True)
        windows.start().return_value.major = 10
        self.addCleanup(windows.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest = {"schemaVersion":1, "host":"win32-x64", "minimums":MINIMUMS, "files":[]}
        for name in ["node/node.exe", "runtime/cli.mjs"]:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"fixture")
            self.manifest["files"].append({"path":name,"bytes":7,"sha256":hashlib.sha256(b"fixture").hexdigest()})
        self.save()

    def save(self):
        (self.root / "payload.json").write_text(json.dumps(self.manifest))

    def test_exact_local_runtime_arguments_and_stdio_environment(self):
        command, env = launch_spec(self.root, ["--compat", "platformio-mcp-python", "a b"], "win32-x64")
        self.assertEqual(command, [str(self.root / "node/node.exe"), str(self.root / "runtime/cli.mjs"), "--compat", "platformio-mcp-python", "a b"])
        self.assertEqual(env["PIO_MCP_WEB_DIST"], str(self.root / "runtime/web"))

    def test_wrong_host(self):
        with self.assertRaisesRegex(ValueError, "Unsupported"):
            launch_spec(self.root, [], "linux-arm64")

    def test_tampered_payload(self):
        (self.root / "runtime/cli.mjs").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "checksum"):
            launch_spec(self.root, [], "win32-x64")

    def test_escape_and_duplicate(self):
        for name in ["../escape", "/absolute", "C:/escape", "runtime\\escape", "node/node.exe"]:
            self.manifest["files"][1]["path"] = name
            self.save()
            with self.assertRaises(ValueError):
                launch_spec(self.root, [], "win32-x64")

    def test_missing_entry(self):
        self.manifest["files"].pop()
        self.save()
        with self.assertRaisesRegex(ValueError, "entry point"):
            launch_spec(self.root, [], "win32-x64")


if __name__ == "__main__":
    unittest.main()
