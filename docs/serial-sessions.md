# Owned direct serial sessions

`SerialSessionManager` joins the direct transport, bounded serial buffer and physical-resource lease store. This is currently an internal service; no new public MCP/CLI/dashboard serial tool is registered yet.

## Ownership and authorization

Trusted adapters create an owner object for each authenticated client/session. Only that exact object can read, write, list, stop or forget its sessions. A session ID, copied owner ID or object issued by another manager is insufficient. Public requests must never construct owner objects or supply unverified physical-resource identities.

The manager requires an authorization hook; there is no permissive default. Start authorization binds the canonical project directory, port, baud, resolved resource and buffer/deadline settings. It excludes the newly generated session ID so an approval challenge can be retried against the same normalized request. Read/write authorization includes the existing session ID. Writes copy the payload before authorization and bind its SHA-256 and length, without placing raw commands in authorization metadata.

The hook returns a synchronous policy revision guard. Startup checks it before acquiring the lease, after asynchronous backend loading and after opening. Writes check it immediately before transport effects; reads check it before waiting and before returning data. Adapters still need to connect this hook to the actual policy dispatcher and preserve scoped approval semantics. The injected-authorizer tests establish the service boundary, not full public policy acceptance.

## Lifecycle and cleanup

A session acquires its physical lease before opening a port. Stopping during authorization/backend loading prevents a later open. Transport termination closes the read buffer promptly, including when actual physical cleanup remains unconfirmed.

The lease is released only after `confirmedClosed`. Failed native closure or lease-file release remains visible as `cleanupPending` and `cleanupError`; the session is kept for owned retry. An active session also has `cleanupPending=true` because it still owns its lease. Cleanup status is independent from logical transport state. Stop and bounded owner-only status remain available when policy denies new actions or becomes invalid.

One-shot capture always attempts owned cleanup after reading, cancellation or pattern failure. Its result includes cleanup status; a failed read preserves the original error plus its session ID and cleanup status. Client disconnect cleanup stops only that client's sessions.

The manager admits at most eight starting/live/cleanup-pending sessions. It retains at most sixteen completed buffers for ten minutes, evicting oldest completed data without evicting a live lease. Forgetting is allowed only after cleanup finishes. Buffer cursors, truncation and matching rules are documented in [serial-patterns.md](serial-patterns.md).

## Verification and outstanding adapters

Software tests use the maintained SerialPort mock stream and real temporary lease files. They cover owner isolation, UTF-8 echo, exclusive leases, policy changes, payload mutation, retained reads, cancelled startup, one-shot failure cleanup, delayed native closure, failed lease release and bounded retention. No physical device was opened.

Physical alias/re-enumeration resolution, legacy monitor/upload migration, real dispatcher hookup, canonical and reference tool adapters, output redaction, plugin/wheel native packaging and real-device acceptance remain required before exposing this service. Existing PlatformIO monitor filters continue through the legacy monitor path; they are not silently interpreted by direct mode.
