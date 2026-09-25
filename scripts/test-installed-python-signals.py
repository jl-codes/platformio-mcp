"""Verify native signal shutdown through the installed launcher without opening hardware."""
import importlib.util
import json
import os
from pathlib import Path
import queue
import signal
import subprocess
import tempfile
import threading
import time


def check(executable, version):
    """Initialize the installed server before signaling its PID, with bounded cleanup."""
    if os.name == "nt":
        spec = importlib.util.spec_from_file_location("windows_console_acceptance",
            Path(__file__).with_name("test-installed-windows-console.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.check(executable, version)
    results = []
    for selected in (signal.SIGINT, signal.SIGTERM):
        with tempfile.TemporaryDirectory(prefix="pio-wheel-signal-") as working:
            environment = os.environ.copy()
            environment.update(PATH=str(executable.parent), PIO_MCP_NO_BROWSER="true",
                               PIO_MCP_DISABLE_DASHBOARD="true", PIO_MCP_DATA_DIR=working)
            stderr_path = Path(working) / "stderr.log"
            with stderr_path.open("w+") as diagnostics:
                process = subprocess.Popen([str(executable), "--disable-dashboard"],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=diagnostics,
                    text=True, env=environment, cwd=working, start_new_session=True)
                try:
                    replies = queue.Queue()
                    def read_reply():
                        try:
                            replies.put(process.stdout.readline(1024 * 1024))
                        except Exception as error:
                            replies.put(error)
                    reader = threading.Thread(target=read_reply, daemon=True)
                    reader.start()
                    process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 1,
                        "method": "initialize", "params": {"protocolVersion": "2024-11-05",
                        "capabilities": {}, "clientInfo": {"name": "wheel-signal-acceptance", "version": "1"}}}) + "\n")
                    process.stdin.flush()
                    reply = replies.get(timeout=30)
                    if not isinstance(reply, str):
                        raise AssertionError("Installed server output read failed")
                    message = json.loads(reply)
                    if message.get("id") != 1 or message.get("result", {}).get("serverInfo", {}).get("version") != version:
                        raise AssertionError("Installed server did not initialize with the expected version")
                    process.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n")
                    process.stdin.flush()
                    started = time.monotonic()
                    # Signal the launcher PID, not its group: POSIX exec must preserve routing.
                    process.send_signal(selected)
                    exit_code = process.wait(timeout=15)
                    if exit_code != 0:
                        raise AssertionError(f"Installed server did not shut down gracefully for {selected.name}: {exit_code}")
                    results.append({"signal": selected.name, "exitCode": exit_code,
                                    "shutdownSeconds": time.monotonic() - started,
                                    "initializedVersion": version, "stdinOpenAtSignal": True})
                finally:
                    # Only our new process group is targeted; failure must not orphan a launcher child.
                    if process.poll() is None:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=10)
                    process.stdin.close()
                    process.stdout.close()
    return {"outcome": "pass", "results": results,
            "scope": "POSIX installed launcher PID signal routing and initialized idle-server graceful shutdown; no active hardware/session cleanup acceptance"}
