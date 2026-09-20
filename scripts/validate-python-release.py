"""Validate the complete wheel set and write its release identity without executing wheel code."""
import argparse
import configparser
import importlib.util
from email.parser import BytesParser
import hashlib
import json
from pathlib import Path
import subprocess
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]

_packages_spec = importlib.util.spec_from_file_location("python_release_packages", ROOT / "scripts/python-release-packages.py")
_packages_module = importlib.util.module_from_spec(_packages_spec)
_packages_spec.loader.exec_module(_packages_module)


def validate(directory):
    """Reject missing hosts, wrong package identities, alias drift and altered payload files."""
    directory = Path(directory)
    version = json.loads((ROOT / "package.json").read_text())["version"]
    support = json.loads((ROOT / "distribution/python-runtime.json").read_text())
    commit = subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip()
    expected = {f"pio_agent_platformio-{version}-py3-none-{target['wheelTag']}.whl":host for host,target in support["targets"].items()}
    alias_specs = {item["name"]:item for item in _packages_module.aliases()}
    expected.update({f"{name.replace('-', '_')}-{version}-py3-none-any.whl":name for name in alias_specs})
    actual = {item.name:item for item in directory.glob("*.whl")}
    if set(actual) != set(expected):
        raise ValueError(f"Wheel set differs: missing={set(expected)-set(actual)}, unexpected={set(actual)-set(expected)}")
    identities=[]
    for filename, host in expected.items():
        wheel=actual[filename]
        with ZipFile(wheel) as archive:
            names=archive.namelist()
            if len(names)!=len(set(names)):
                raise ValueError("Duplicate wheel members")
            metadata_files=[name for name in names if name.endswith('.dist-info/METADATA')]
            if len(metadata_files)!=1:
                raise ValueError("Ambiguous wheel metadata")
            metadata=BytesParser().parsebytes(archive.read(metadata_files[0]))
            canonical=host in support["targets"]
            identity="pio-agent-platformio" if canonical else host
            if metadata["Name"]!=identity or metadata["Version"]!=version or metadata["Requires-Python"]!=">=3.11":
                raise ValueError("Wheel metadata identity mismatch")
            if canonical:
                prefix="pio_agent_launcher/payload/"
                payload=json.loads(archive.read(prefix+"payload.json"))
                if (payload["host"],payload["version"],payload["sourceCommit"],payload["nodeVersion"],payload["wheelTag"])!=(host,version,commit,support["nodeVersion"],support["targets"][host]["wheelTag"]):
                    raise ValueError("Wheel payload source/runtime identity mismatch")
                if payload.get("minimums") != support["minimums"]:
                    raise ValueError("Wheel OS requirements differ from the support manifest")
                if payload.get("sourceDirty") is not False:
                    raise ValueError("Development wheel cannot be released")
                inventory=payload["files"]
                paths={item["path"] for item in inventory}
                packed={name[len(prefix):] for name in names if name.startswith(prefix) and name!=prefix+"payload.json"}
                if len(paths)!=len(inventory) or paths!=packed:
                    raise ValueError("Wheel payload inventory differs from packed files")
                for item in inventory:
                    data=archive.read(prefix+item["path"])
                    if len(data)!=item["bytes"] or hashlib.sha256(data).hexdigest()!=item["sha256"]:
                        raise ValueError("Wheel payload checksum mismatch")
                if not {"node/LICENSE", "runtime/cli.mjs", "licenses/javascript-inventory.json"}.issubset(paths):
                    raise ValueError("Required license inventory, Node license or CLI missing")
            else:
                if f"pio-agent-platformio=={version}" not in metadata.get_all("Requires-Dist",[]):
                    raise ValueError("Alias does not pin exact canonical release")
                entry_files = [name for name in names if name.endswith('/entry_points.txt')]
                if alias_specs[identity]["ownsCommand"]:
                    if len(entry_files) != 1:
                        raise ValueError("Alias command entrypoint missing")
                    config = configparser.ConfigParser()
                    config.read_string(archive.read(entry_files[0]).decode())
                    if config.sections() != ["console_scripts"] or dict(config["console_scripts"]) != {identity: alias_specs[identity]["module"] + ".__main__:main"}:
                        raise ValueError("Alias may only install its own command")
                elif entry_files:
                    raise ValueError("Alias must not overwrite canonical command files")
                module=identity.replace('-','_')+'_alias/__main__.py'
                source=json.loads(archive.read(identity.replace("-", "_")+"_alias/source.json"))
                if source.get("sourceCommit") != commit or source.get("sourceDirty") is not False:
                    raise ValueError("Alias source identity is not the clean release commit")
                if module not in names:
                    raise ValueError("Functional alias module missing")
        identities.append({"name":identity,"version":version,"file":filename,"host":host if canonical else "any","sha256":hashlib.sha256(wheel.read_bytes()).hexdigest()})
    result={"schemaVersion":1,"sourceCommit":commit,"artifacts":identities,"hostExecutionAcceptance":"separate gate; not established by artifact validation"}
    (directory/"python-release-identity.json").write_text(json.dumps(result,indent=2)+"\n")
    return result


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory")
    print(f"Validated {len(validate(parser.parse_args().directory)['artifacts'])} Python release artifacts")
