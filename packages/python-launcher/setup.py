"""Build only staged platform wheels; never mislabel a bundled executable as pure Python."""
import json
from pathlib import Path
from setuptools import setup, Distribution
from setuptools.command.bdist_wheel import bdist_wheel

root = Path(__file__).parent
package = root / "src/pio_agent_launcher"
payload = package / "payload"
manifest = json.loads((payload / "payload.json").read_text())


class BinaryDistribution(Distribution):
    def has_ext_modules(self):
        return True


class PlatformWheel(bdist_wheel):
    def finalize_options(self):
        super().finalize_options()
        self.root_is_pure = False

    def get_tag(self):
        return "py3", "none", manifest["wheelTag"]


setup(distclass=BinaryDistribution, cmdclass={"bdist_wheel": PlatformWheel}, package_data={
    "pio_agent_launcher": [item.relative_to(package).as_posix() for item in payload.rglob("*") if item.is_file()]
})
