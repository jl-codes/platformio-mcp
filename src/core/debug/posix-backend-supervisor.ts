/** Fixed POSIX backend supervisor: a live group leader pins identity until owned descendants are terminated. */

/** Internal Python bridge using the same control protocol as the Windows Job Object supervisor. */
export const POSIX_BACKEND_SUPERVISOR = String.raw`
import base64, json, os, select, signal, subprocess, sys, threading, time

def emit(event, **fields):
    print(json.dumps(dict(event=event, **fields)), flush=True)

guardian = None
group = None
confirmed = False
read_fd = None
owner_write = None
input_read = input_write = None
phase = "request"
try:
    line = b""
    while len(line) <= 262144 and not line.endswith(b"\n"):
        byte = os.read(sys.stdin.fileno(), 1)
        if not byte: break
        line += byte
    if len(line) > 262144 or not line.endswith(b"\n"): raise ValueError("invalid request")
    request = json.loads(line)
    executable, cwd, args = request["executable"], request["cwd"], request["arguments"]
    if not isinstance(executable, str) or not os.path.isabs(executable) or not isinstance(cwd, str) or not os.path.isabs(cwd): raise ValueError("invalid paths")
    if not isinstance(args, list) or len(args) > 256 or any(not isinstance(arg, str) or "\0" in arg for arg in args): raise ValueError("invalid arguments")
    interactive = request.get("interactive", False)
    if not isinstance(interactive, bool): raise ValueError("invalid interactive mode")
    if interactive:
        input_read, input_write = os.pipe()
        os.set_blocking(input_write, False)
    if sys.platform.startswith("linux"):
        # Adopt/reap orphaned grandchildren rather than relying on a container's PID 1.
        import ctypes
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.prctl(36, 1, 0, 0, 0) != 0: raise OSError("subreaper unavailable")
    read_fd, write_fd = os.pipe()
    owner_read, owner_write = os.pipe()
    phase = "fork"
    guardian = os.fork()
    if guardian == 0:
        os.close(read_fd)
        os.close(owner_write)
        if input_write is not None: os.close(input_write)
        notify_lock = threading.Lock()
        def notify(**fields):
            data = json.dumps(fields).encode("ascii") + b"\n"
            with notify_lock:
                while data: data = data[os.write(write_fd, data):]
        try:
            os.setsid()
            def watch_supervisor():
                # A supervisor crash closes this private pipe; terminate the pinned group.
                try: os.read(owner_read, 1)
                finally: os.killpg(os.getpid(), signal.SIGKILL)
            threading.Thread(target=watch_supervisor, daemon=True).start()
            notify(event="group")
            # The backend cannot inherit either supervisor control channel.
            child = subprocess.Popen([executable] + args, cwd=cwd, stdin=input_read if interactive else subprocess.DEVNULL,
                                     stdout=subprocess.PIPE if interactive else sys.stderr, stderr=sys.stderr, close_fds=True)
            if input_read is not None: os.close(input_read)
            notify(event="started", pid=child.pid)
            output_thread = None
            if interactive:
                def forward_output():
                    try:
                        while True:
                            data = os.read(child.stdout.fileno(), 1024)
                            if not data: break
                            notify(event="stdout", data=base64.b64encode(data).decode("ascii"))
                    except BaseException: notify(event="failed")
                output_thread = threading.Thread(target=forward_output, daemon=True)
                output_thread.start()
            code = child.wait()
            if output_thread: output_thread.join(0.2)
            notify(event="exited", exitCode=code)
            # Remain group leader until killed, preventing PGID reuse after backend exit.
            while True: signal.pause()
        except BaseException:
            notify(event="failed")
        finally:
            os._exit(1)
    os.close(write_fd)
    os.close(owner_read)
    if input_read is not None:
        os.close(input_read); input_read = None
    pending = b""
    owner_pending = b""
    input_pending = b""
    started = False
    stop = False
    exit_code = None
    startup_deadline = time.monotonic() + 10
    phase = "startup"
    while True:
        if not started and time.monotonic() >= startup_deadline: raise TimeoutError("backend startup")
        ready, writable, _ = select.select([read_fd, sys.stdin.fileno()], [input_write] if interactive and input_pending and started else [], [], 0.1)
        if sys.stdin.fileno() in ready:
            data = os.read(sys.stdin.fileno(), 4096 if interactive else 1)
            if not interactive or not data: stop = True
            else:
                owner_pending += data
                if len(owner_pending) > 100000: raise ValueError("stdin message limit")
                while b"\n" in owner_pending:
                    row, owner_pending = owner_pending.split(b"\n", 1)
                    message = json.loads(row)
                    if message.get("event") != "stdin": raise ValueError("invalid stdin message")
                    decoded = base64.b64decode(message["data"], validate=True)
                    if not decoded or len(decoded) > 65536: raise ValueError("stdin byte limit")
                    input_pending += decoded
                    if len(input_pending) > 262144: raise ValueError("stdin queue limit")
        if interactive and input_write in writable and not stop:
            try: input_pending = input_pending[os.write(input_write, input_pending[:4096]):]
            except BlockingIOError: pass
            except BrokenPipeError: stop = True
        if read_fd in ready:
            data = os.read(read_fd, 4096)
            if not data: raise RuntimeError("guardian exited")
            pending += data
            if len(pending) > 8192: raise ValueError("guardian protocol limit")
            while b"\n" in pending:
                row, pending = pending.split(b"\n", 1)
                event = json.loads(row)
                if event["event"] == "group": group = guardian
                elif event["event"] == "started":
                    started = True
                    emit("started", pid=event["pid"])
                elif event["event"] == "stdout" and interactive and started:
                    emit("stdout", data=event["data"])
                elif event["event"] == "exited":
                    exit_code = event["exitCode"]
                    stop = True
                else: raise RuntimeError("backend startup failed")
        if stop and started: break
    phase = "terminate_group"
    os.killpg(group, signal.SIGKILL)
    phase = "confirm_group_exit"
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        while True:
            try:
                pid, _ = os.waitpid(-1, os.WNOHANG)
                if pid == 0: break
            except ChildProcessError: break
        try: os.killpg(group, 0)
        except ProcessLookupError:
            confirmed = True
            break
        except PermissionError:
            # macOS can briefly deny signaling orphan/zombie members during launchd reaping.
            # This is NOT cleanup proof: continue waiting for ESRCH within the same deadline.
            pass
        time.sleep(0.02)
    emit("stopped", cleanupConfirmed=confirmed, exitCode=exit_code)
except BaseException as error:
    emit("failed", cleanupConfirmed=guardian is None, errorType=type(error).__name__, phase=phase, errno=getattr(error, "errno", None))
finally:
    if guardian and not confirmed:
        try:
            # Never signal the supervisor's group if setsid failed or has not completed.
            if os.getpgid(guardian) == guardian: os.killpg(guardian, signal.SIGKILL)
            else: os.kill(guardian, signal.SIGKILL)
        except ProcessLookupError: pass
    if read_fd is not None: os.close(read_fd)
    if owner_write is not None: os.close(owner_write)
    for fd in (input_read, input_write):
        if fd is not None: os.close(fd)
sys.stdout.flush()
os._exit(0 if confirmed else 1)
`;
