"""Check installed launcher Ctrl-C delivery inside an isolated Windows console."""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import time


def controller(executable, version, output):
    """Own a private console and a kill-on-close job before starting the launcher."""
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    class Basic(ctypes.Structure):
        _fields_ = [("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64),
                    ("flags", wintypes.DWORD), ("minimum", ctypes.c_size_t),
                    ("maximum", ctypes.c_size_t), ("active", wintypes.DWORD),
                    ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD),
                    ("scheduling", wintypes.DWORD)]
    class Io(ctypes.Structure):
        _fields_ = [(name, ctypes.c_uint64) for name in ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]
    class Extended(ctypes.Structure):
        _fields_ = [("basic", Basic), ("io", Io), ("process_memory", ctypes.c_size_t),
                    ("job_memory", ctypes.c_size_t), ("peak_process", ctypes.c_size_t),
                    ("peak_job", ctypes.c_size_t)]
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.SetConsoleCtrlHandler.argtypes = [ctypes.c_void_p, wintypes.BOOL]
    kernel.GenerateConsoleCtrlEvent.argtypes = [wintypes.DWORD, wintypes.DWORD]
    job = kernel.CreateJobObjectW(None, None)
    limits = Extended()
    limits.basic.flags = 0x2000
    if not job or not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
        raise ctypes.WinError(ctypes.get_last_error())
    if not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess()):
        raise ctypes.WinError(ctypes.get_last_error())
    # Keep the job handle until process exit: every descendant is then terminated,
    # including a child left behind if initialization or the shutdown deadline fails.
    if not kernel.SetConsoleCtrlHandler(None, False):
        raise ctypes.WinError(ctypes.get_last_error())
    environment = os.environ.copy()
    environment.update(PATH=str(executable.parent), PIO_MCP_NO_BROWSER="true",
                       PIO_MCP_DISABLE_DASHBOARD="true", PIO_MCP_DATA_DIR=str(output.parent / "state"))
    with (output.parent / "server-stderr.log").open("w") as errors:
        process = subprocess.Popen([str(executable), "--disable-dashboard"], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=errors, text=True, env=environment, cwd=output.parent)
        # Applied only after child creation so the child does not inherit ignored Ctrl-C.
        if not kernel.SetConsoleCtrlHandler(None, True):
            raise ctypes.WinError(ctypes.get_last_error())
        replies = queue.Queue()
        threading.Thread(target=lambda: replies.put(process.stdout.readline(1024 * 1024)), daemon=True).start()
        process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2024-11-05", "capabilities": {},
            "clientInfo": {"name": "windows-console-acceptance", "version": "1"}}}) + "\n")
        process.stdin.flush()
        response = json.loads(replies.get(timeout=30))
        if response.get("id") != 1 or response.get("result", {}).get("serverInfo", {}).get("version") != version:
            raise AssertionError("Installed server did not initialize with the expected version")
        process.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
        process.stdin.flush()
        started = time.monotonic()
        if not kernel.GenerateConsoleCtrlEvent(0, 0):
            raise ctypes.WinError(ctypes.get_last_error())
        code = process.wait(timeout=15)
        if code != 0:
            raise AssertionError(f"Installed launcher Ctrl-C exit code: {code}")
        output.write_text(json.dumps({"outcome": "pass", "results": [{"signal": "CTRL_C_EVENT",
            "exitCode": code, "shutdownSeconds": time.monotonic() - started,
            "initializedVersion": version, "stdinOpenAtSignal": True}],
            "scope": "Windows private-console Ctrl-C delivery through installed launcher and initialized idle server; no active hardware/session cleanup or minimum-OS acceptance"}))
        process.stdin.close()
        process.stdout.close()


def check(executable, version):
    """Run the controller in a hidden private console, bounded to sixty seconds."""
    with tempfile.TemporaryDirectory(prefix="pio-console-") as temporary:
        root = Path(temporary)
        output = root / "result.json"
        startup = subprocess.STARTUPINFO()
        startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow = 0
        with (root / "controller.log").open("w+") as diagnostics:
            process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()),
                str(Path(executable).resolve()), version, str(output)],
                creationflags=subprocess.CREATE_NEW_CONSOLE, startupinfo=startup,
                stdout=diagnostics, stderr=diagnostics)
            try:
                code = process.wait(timeout=60)
                if code != 0 or not output.is_file():
                    diagnostics.seek(0)
                    raise AssertionError(f"Windows console acceptance failed ({code}): {diagnostics.read(8192)}")
                return json.loads(output.read_text())
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=10)


if __name__ == "__main__":
    controller(Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3]))
