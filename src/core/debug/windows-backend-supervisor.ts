/** Fixed Windows debug-backend supervisor: atomic Job Object assignment, bounded shutdown and cleanup proof. */

/** Internal Python bridge; callers must authorize and validate executable/cwd/argv before sending one JSON line. */
export const WINDOWS_BACKEND_SUPERVISOR = String.raw`
import ctypes as c, ctypes.wintypes as w
import base64, json, msvcrt, os, queue, subprocess, sys, threading, time

k = c.WinDLL("kernel32", use_last_error=True)
SIZE = c.c_size_t
class BasicLimits(c.Structure):
    _fields_ = [("process_time", c.c_int64), ("job_time", c.c_int64), ("flags", w.DWORD),
                ("min_working_set", SIZE), ("max_working_set", SIZE), ("active_limit", w.DWORD),
                ("affinity", SIZE), ("priority", w.DWORD), ("scheduling", w.DWORD)]
class IoCounters(c.Structure):
    _fields_ = [(name, c.c_uint64) for name in ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]
class ExtendedLimits(c.Structure):
    _fields_ = [("basic", BasicLimits), ("io", IoCounters), ("process_memory", SIZE),
                ("job_memory", SIZE), ("peak_process", SIZE), ("peak_job", SIZE)]
class Accounting(c.Structure):
    _fields_ = [(name, c.c_int64) for name in ("user", "kernel", "period_user", "period_kernel")] + [
                (name, w.DWORD) for name in ("faults", "total", "active", "terminated")]
class Startup(c.Structure):
    _fields_ = [("cb", w.DWORD), ("reserved", w.LPWSTR), ("desktop", w.LPWSTR), ("title", w.LPWSTR)] + [
                (name, w.DWORD) for name in ("x", "y", "xsize", "ysize", "xchars", "ychars", "fill", "flags")] + [
                ("show", w.WORD), ("reserved_size", w.WORD), ("reserved_bytes", c.c_void_p),
                ("stdin", w.HANDLE), ("stdout", w.HANDLE), ("stderr", w.HANDLE)]
class StartupEx(c.Structure):
    _fields_ = [("startup", Startup), ("attributes", c.c_void_p)]
class ProcessInfo(c.Structure):
    _fields_ = [("process", w.HANDLE), ("thread", w.HANDLE), ("pid", w.DWORD), ("tid", w.DWORD)]

def api(name, restype, args):
    fn = getattr(k, name); fn.restype = restype; fn.argtypes = args; return fn
create_job = api("CreateJobObjectW", w.HANDLE, [c.c_void_p, w.LPCWSTR])
set_job = api("SetInformationJobObject", w.BOOL, [w.HANDLE, c.c_int, c.c_void_p, w.DWORD])
query_job = api("QueryInformationJobObject", w.BOOL, [w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.c_void_p])
terminate_job = api("TerminateJobObject", w.BOOL, [w.HANDLE, w.UINT])
close_handle = api("CloseHandle", w.BOOL, [w.HANDLE])
init_attributes = api("InitializeProcThreadAttributeList", w.BOOL, [c.c_void_p, w.DWORD, w.DWORD, c.POINTER(SIZE)])
update_attribute = api("UpdateProcThreadAttribute", w.BOOL, [c.c_void_p, w.DWORD, SIZE, c.c_void_p, SIZE, c.c_void_p, c.c_void_p])
delete_attributes = api("DeleteProcThreadAttributeList", None, [c.c_void_p])
create_process = api("CreateProcessW", w.BOOL, [w.LPCWSTR, w.LPWSTR, c.c_void_p, c.c_void_p, w.BOOL, w.DWORD, c.c_void_p, w.LPCWSTR, c.c_void_p, c.POINTER(ProcessInfo)])
wait_process = api("WaitForSingleObject", w.DWORD, [w.HANDLE, w.DWORD])
get_exit = api("GetExitCodeProcess", w.BOOL, [w.HANDLE, c.POINTER(w.DWORD)])

def check(ok):
    if not ok: raise c.WinError(c.get_last_error())
emit_lock = threading.Lock()
def emit(event, **fields):
    with emit_lock: print(json.dumps(dict(event=event, **fields)), flush=True)

job = None
attributes = None
attributes_initialized = False
process = ProcessInfo()
launched = False
confirmed = False
input_write = output_read = output_write = None
output_thread = None
try:
    line = sys.stdin.buffer.readline(262145)
    if len(line) > 262144 or not line.endswith(b"\n"): raise ValueError("invalid request")
    request = json.loads(line)
    executable, cwd, args = request["executable"], request["cwd"], request["arguments"]
    if not isinstance(executable, str) or not os.path.isabs(executable) or not isinstance(cwd, str) or not os.path.isabs(cwd): raise ValueError("invalid paths")
    if os.path.splitext(executable)[1].lower() != ".exe": raise ValueError("native executable required")
    if not isinstance(args, list) or len(args) > 256 or any(not isinstance(arg, str) or "\0" in arg for arg in args): raise ValueError("invalid arguments")
    interactive = request.get("interactive", False)
    if not isinstance(interactive, bool): raise ValueError("invalid interactive mode")
    if interactive:
        input_read, input_write = os.pipe()
        output_read, output_write = os.pipe()
        for fd in (input_read, input_write, output_read, output_write): msvcrt.setmode(fd, os.O_BINARY)
    command = subprocess.list2cmdline([executable] + args)
    if len(command) > 32766: raise ValueError("command too long")
    job = create_job(None, None); check(job)
    limits = ExtendedLimits(); limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    check(set_job(job, 9, c.byref(limits), c.sizeof(limits)))
    size = SIZE()
    init_attributes(None, 2, 0, c.byref(size))
    attributes = c.create_string_buffer(size.value)
    check(init_attributes(attributes, 2, 0, c.byref(size)))
    attributes_initialized = True
    jobs = (w.HANDLE * 1)(job)
    # PROC_THREAD_ATTRIBUTE_JOB_LIST makes assignment atomic with process creation.
    check(update_attribute(attributes, 0, 0x2000D, jobs, c.sizeof(jobs), None, None))
    with (os.fdopen(input_read, "rb") if interactive else open(os.devnull, "rb")) as null_input:
        input_handle = msvcrt.get_osfhandle(null_input.fileno())
        diagnostic_handle = msvcrt.get_osfhandle(sys.stderr.fileno())
        output_handle = msvcrt.get_osfhandle(output_write) if interactive else diagnostic_handle
        handles = list(dict.fromkeys([input_handle, output_handle, diagnostic_handle]))
        for handle in handles: os.set_handle_inheritable(handle, True)
        inherited = (w.HANDLE * len(handles))(*handles)
        check(update_attribute(attributes, 0, 0x20002, inherited, c.sizeof(inherited), None, None))
        startup = StartupEx(); startup.startup.cb = c.sizeof(startup)
        startup.startup.flags = 0x100  # STARTF_USESTDHANDLES
        startup.startup.stdin = input_handle
        startup.startup.stdout = output_handle
        startup.startup.stderr = diagnostic_handle
        startup.attributes = c.cast(attributes, c.c_void_p)
        try:
            check(create_process(executable, c.create_unicode_buffer(command), None, None, True,
                                 0x08080000, None, cwd, c.byref(startup), c.byref(process)))
            launched = True
        finally:
            for handle in handles: os.set_handle_inheritable(handle, False)
            if output_write is not None:
                os.close(output_write); output_write = None
    close_handle(process.thread); process.thread = None
    emit("started", pid=process.pid)
    stop = threading.Event()
    pending_input = queue.Queue(maxsize=32)
    def write_child():
        try:
            while True:
                data = pending_input.get()
                while data:
                    written = os.write(input_write, data)
                    if written < 1: raise RuntimeError("stdin closed")
                    data = data[written:]
        except BaseException: stop.set()
    def read_child():
        try:
            while True:
                data = os.read(output_read, 1024)
                if not data: break
                emit("stdout", data=base64.b64encode(data).decode("ascii"))
        except BaseException: stop.set()
    def watch_owner():
        try:
            if not interactive:
                sys.stdin.buffer.read(1)
                return
            while True:
                line = sys.stdin.buffer.readline(100000)
                if not line: break
                if not line.endswith(b"\n"): raise ValueError("stdin message limit")
                message = json.loads(line)
                if message.get("event") != "stdin": raise ValueError("invalid stdin message")
                data = base64.b64decode(message["data"], validate=True)
                if not data or len(data) > 65536: raise ValueError("stdin byte limit")
                pending_input.put_nowait(data)
        except BaseException: pass
        finally: stop.set()
    if interactive:
        threading.Thread(target=write_child, daemon=True).start()
        output_thread = threading.Thread(target=read_child, daemon=True)
        output_thread.start()
    threading.Thread(target=watch_owner, daemon=True).start()
    while not stop.is_set():
        status = wait_process(process.process, 50)
        if status == 0: break
        if status != 258: raise RuntimeError("process wait failed")
    exit_code = w.DWORD()
    check(get_exit(process.process, c.byref(exit_code)))
    check(terminate_job(job, 1))
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        accounting = Accounting()
        check(query_job(job, 1, c.byref(accounting), c.sizeof(accounting), None))
        if accounting.active == 0:
            confirmed = True
            break
        time.sleep(0.02)
    if output_thread:
        output_thread.join(1)
        if output_thread.is_alive(): confirmed = False
    emit("stopped", cleanupConfirmed=confirmed, exitCode=None if exit_code.value == 259 else exit_code.value)
except BaseException as error:
    # No command paths, arguments, environment or backend logs enter the control protocol.
    emit("failed", cleanupConfirmed=not launched, errorType=type(error).__name__)
finally:
    if process.thread: close_handle(process.thread)
    if process.process: close_handle(process.process)
    if attributes_initialized: delete_attributes(attributes)
    if job: close_handle(job)
    for fd in (input_write, output_read, output_write):
        if fd is not None:
            try: os.close(fd)
            except OSError: pass
# A daemon stdin reader must not retain Python's buffered-IO lock during interpreter finalization.
sys.stdout.flush()
os._exit(0 if confirmed else 1)
`;
