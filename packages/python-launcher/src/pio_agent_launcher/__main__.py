"""Launch only the verified local wheel payload; never download a fallback runtime."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import signal
import subprocess
import sys


def launch_spec(root, arguments, host=None):
    """Verify the host and every inventoried payload file before returning argv/env."""
    root = Path(root).resolve()
    manifest = json.loads((root / "payload.json").read_text(encoding="utf-8"))
    machine = platform.machine().lower()
    architecture = {"amd64": "x64", "x86_64": "x64", "aarch64": "arm64", "arm64": "arm64"}.get(machine, machine)
    actual = host or f"{sys.platform}-{architecture}"
    supported = {"win32-x64", "darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64"}
    if actual not in supported or manifest.get("schemaVersion") != 1 or manifest.get("host") != actual:
        raise ValueError("Unsupported wheel/host combination; install platformio-mcp through npm instead.")
    files = manifest.get("files")
    if not isinstance(files, list) or not files or len(files) > 10000:
        raise ValueError("Invalid wheel payload inventory")
    verified = set()
    for item in files:
        name = item["path"]
        relative = PurePosixPath(name)
        if not name or relative.is_absolute() or ".." in relative.parts or "\\" in name or ":" in name or name in verified:
            raise ValueError("Unsafe or duplicate wheel payload path")
        target = root.joinpath(*relative.parts)
        if not target.resolve().is_relative_to(root) or not target.is_file():
            raise ValueError("Missing or escaping wheel payload")
        if target.stat().st_size != item["bytes"]:
            raise ValueError("Wheel payload size mismatch")
        with target.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest != item["sha256"]:
            raise ValueError("Wheel payload checksum mismatch")
        verified.add(name)
    node = "node/node.exe" if actual.startswith("win32-") else "node/bin/node"
    entry = "runtime/cli.mjs"
    if node not in verified or entry not in verified:
        raise ValueError("Wheel is missing its verified Node runtime or CLI entry point")
    environment = os.environ.copy()
    environment.setdefault("PIO_MCP_NO_BROWSER", "true")
    environment["PIO_MCP_WEB_DIST"] = str(root / "runtime" / "web")
    return [str(root / node), str(root / entry), *arguments], environment


def run_windows(command, environment):
    """Inherit stdio and console signals, keeping the parent until the child exits."""
    child = subprocess.Popen(command, env=environment, shell=False)
    previous = signal.getsignal(signal.SIGTERM)
    signal.signal(signal.SIGTERM, lambda *_: child.terminate())
    try:
        while True:
            try:
                return child.wait()
            except KeyboardInterrupt:
                # Windows delivers Ctrl-C to both processes in the inherited console.
                continue
    finally:
        signal.signal(signal.SIGTERM, previous)


def main():
    """Preserve caller cwd, arguments and stdio; POSIX replaces the Python process."""
    try:
        command, environment = launch_spec(Path(__file__).parent / "payload", sys.argv[1:])
        if os.name == "nt":
            return run_windows(command, environment)
        os.execve(command[0], command, environment)
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"pio-agent: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
