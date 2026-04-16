"""
PlatformIO MCP Proxy Bridge

This utility wrapper is strictly necessary to run `pio device monitor` as a background daemon
within a headless Node.js environment (like the Model Context Protocol server).

Why is this needed?
1. The 'miniterm.py' library used by PlatformIO natively assumes it is attached to an interactive 
   terminal. It leverages low-level POSIX functions ('tcsetattr') to manipulate the keyboard. 
   When spawned in the background via Node.js 'child_process.spawn', it receives standard Unix
   pipes rather than a Pseudo-Terminal (PTY), causing it to crash immediately with:
   'termios.error: (22, Invalid argument)' or 'Operation not supported on socket'.

2. Hardware Lock Glitches: When terminating a serial monitor natively capturing an ESP32-S3 over 
   USB CDC-ACM (macOS specifically), sending a sudden SIGKILL causes the Apple kernel driver to 
   leave the port in a "Resource Busy" or "Device not configured" state. 

This proxy solves both issues by:
- Wrapping the requested 'pio' command inside a native Python Pseudo-Terminal ('pty.openpty').
- Bridging standard output back to Node.js transparently.
- Intercepting Node's SIGTERM/SIGINT shutdown signals and instead passing a graceful 'Ctrl+]'
  (ASCII 29 '\\x1d') into the virtual terminal. This allows 'miniterm' to cleanly release the
  underlying file descriptors, preventing macOS driver lockups prior to flashing firmware.
"""

import os
import pty
import sys
import subprocess

def main():
    if len(sys.argv) < 2:
        print("Usage: python mcp_pio_proxy.py [COMMAND...]", file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1:]
    
    # Create a pseudo-terminal pair
    master_fd, slave_fd = pty.openpty()

    # Spawn the target command, attaching its I/O directly to the slave PTY
    proc = subprocess.Popen(
        cmd,
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        close_fds=True
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
