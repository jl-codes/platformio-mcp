/** Embedded headless PlatformIO monitor bridge, included in npm and bundled runtimes. */
export const PIO_MONITOR_BRIDGE = String.raw`
import os
import sys
import subprocess

def main():
    if len(sys.argv) < 2:
        print("Usage: python mcp_pio_proxy.py [COMMAND...]", file=sys.stderr)
        sys.exit(1)

    if os.name == "nt":
        # Keep PlatformIO's reader and configured filters, but do not start a
        # Windows keyboard console in a detached process with no console handle.
        import runpy
        import threading
        from serial.tools import miniterm

        def headless_writer(terminal):
            # Reader failures set alive=False; let PlatformIO reconnect normally.
            while terminal.alive:
                threading.Event().wait(0.1)

        miniterm.Console = miniterm.ConsoleBase
        miniterm.Miniterm.writer = headless_writer
        sys.argv = ["platformio", *sys.argv[2:]]
        runpy.run_module("platformio", run_name="__main__")
        return

    import pty
    cmd = sys.argv[1:]
    
    # Create a pseudo-terminal pair
    master_fd, slave_fd = pty.openpty()

    # Spawn the target command, attaching its I/O directly to the slave PTY
    proc = subprocess.Popen(
        cmd,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        close_fds=True,
        start_new_session=True
    )
    
    # We close the slave in the parent so the master gets an EOF when the child exits
    os.close(slave_fd)

    import signal
    import time

    def cleanup_and_exit(signum, frame):
        # Gracefully tell miniterm to exit by sending Ctrl+] (ASCII 29)
        try:
            os.write(master_fd, b'\x1d')
            # Give it a fraction of a second to gracefully close the serial port
            time.sleep(0.2) 
        except Exception:
            pass
        finally:
            proc.terminate()
            time.sleep(0.1)
            if proc.poll() is None:
                proc.kill()
            sys.exit(0)

    signal.signal(signal.SIGTERM, cleanup_and_exit)
    signal.signal(signal.SIGINT, cleanup_and_exit)

    try:
        # Loop forever reading from the child process's stdout (the master PTY)
        while True:
            data = os.read(master_fd, 1024)
            if not data:
                break
            
            # Write raw bytes out to our actual standard output
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
            
    except OSError:
        # An OSError (often errno 5: Input/output error) is standard when the child 
        # process closes the PTY connection from its end (e.g. process termination)
        pass
    finally:
        try:
            os.close(master_fd)
        except Exception:
            pass

    # Wait for the child process to definitively end
    proc.wait()
    sys.exit(proc.returncode)

if __name__ == "__main__":
    main()
`;
