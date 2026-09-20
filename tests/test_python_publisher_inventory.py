"""Publication selection must honor the canonical inventory entry."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("python_release_packages", Path(__file__).resolve().parents[1] / "scripts/python-release-packages.py")
packages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packages)


class PublisherInventoryTests(unittest.TestCase):
    def resolve(self, entries):
        with patch.object(Path, "read_text", return_value=json.dumps({"entries": entries})), patch.object(packages, "aliases", return_value=[]):
            return packages.publishers()

    def test_enabled_canonical_is_selected(self):
        self.assertEqual(self.resolve([self.canonical()]), [packages.CANONICAL])

    def canonical(self, **changes):
        return {"registry": "pypi", "name": packages.CANONICAL, "role": "candidate_canonical", "publishIntent": True, **changes}

    def test_invalid_canonical_inventory_prevents_publication(self):
        cases = [[], [self.canonical(publishIntent=False)],
                 [self.canonical(publishIntent="true")],
                 [self.canonical(role="excluded_third_party")],
                 [self.canonical(), self.canonical(name="pio_agent_platformio")],
                 [self.canonical(name="pio_agent_platformio")]]
        for entries in cases:
            with self.subTest(entries=entries), self.assertRaises(ValueError):
                self.resolve(entries)


if __name__ == "__main__":
    unittest.main()
