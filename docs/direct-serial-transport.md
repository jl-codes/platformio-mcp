# Direct serial transport

The internal direct transport uses optional, exactly pinned `serialport@13.0.0`. It requires Node 20 or newer; existing Node 18 installations retain the PlatformIO monitor path. Missing/unsupported native bindings produce `SERIAL_BACKEND_UNAVAILABLE`. Nothing downloads or upgrades a backend at runtime.

Construction validates port, baud and deadline without opening or enumerating devices. Opening is explicit, uses exclusive binding ownership where the OS supports it, and can toggle device control lines. It therefore belongs behind hardware authorization and a shared physical-resource lease. Direct mode does not implement PlatformIO monitor filters.

Reads deliver bounded byte chunks to the session buffer. Writes accept at most 64 KiB, copy caller-owned data, reject concurrent writes, and await both write completion and OS drain. A drained write is not device-level acknowledgement. Timeout, disconnection and write failure can leave partially transmitted commands; no automatic retry occurs. These semantics follow the maintained [SerialPort stream API](https://serialport.io/docs/api-stream/).

Logical error/stopped state does not prove physical closure. Session code must retain its lease until `confirmedClosed` resolves. A late open after timeout or stop is closed immediately. Failed or stalled closes remain unconfirmed and return a bounded error; explicit cleanup can retry. Concurrent close requests share one native attempt. A confirmed close is terminal and cannot be reopened.

The default operation deadline is five seconds, configurable internally from one millisecond through 30 seconds. These are caller-observation deadlines, not a claim that a blocked native OS call can be forcibly cancelled. A failed operation retains its pending physical ownership until closure is established. This distinction must remain visible in session cleanup results.

## Current verification and remaining integration

Tests use the official SerialPort mock binding for split UTF-8 echo/write/drain and controlled callbacks for timeout/disconnect/cleanup races. The native backend was loaded on Windows x64 without opening a device. This is not physical serial acceptance.

No new public serial tool uses this module yet. The internal session manager now joins owner checks, mandatory authorization hooks, bounded buffers and physical leases. Actual policy-dispatcher hookup, canonical/reference adapters, shared physical alias resolution, legacy monitor/upload migration, native-module copying into plugin/wheel artifacts, and all required host/hardware acceptance remain open. Optional native dependencies must be packaged and tested on each supported distribution target before direct mode is advertised there.
