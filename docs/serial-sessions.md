# Owned direct serial sessions

`SerialSessionManager` joins the direct transport, bounded serial buffer and physical-resource lease store. This is currently an internal service; no new public MCP/CLI/dashboard serial tool is registered yet.

## Ownership and authorization

Trusted adapters create an owner object for each authenticated client/session. Only that exact object can read, write, list, stop or forget its sessions. A session ID, copied owner ID or object issued by another manager is insufficient. Public requests must never construct owner objects or supply unverified physical-resource identities.

The manager requires an authorization hook; there is no permissive default. Start authorization binds the canonical project directory, port, baud, resolved resource and buffer/deadline settings. It excludes the newly generated session ID so an approval challenge can be retried against the same normalized request. Read/write authorization includes the existing session ID. Writes copy the payload before authorization and bind its SHA-256 and length, without placing raw commands in authorization metadata.

The hook returns a synchronous policy revision guard. Startup checks it before acquiring the lease, after asynchronous backend loading and after opening. Writes check it immediately before transport effects; reads check it before waiting and before returning data. PolicySerialSessionService now connects this hook to the existing dispatcher, effective permission sources and one-use approvals. Its request-local context isolates caller metadata and approval IDs. It captures the policy revision before asynchronous authorization, so a policy change cannot become an implicitly authorized new baseline. Public tool wiring remains pending.

The internal operation names are `serial_session_start` (mapped to `start_monitor`), `serial_session_read` (mapped to `query_logs`) and `serial_session_write` (mapped to `upload_firmware`). Category restrictions and concrete-operation restrictions both apply. Serial writes can send arbitrary device commands, so default flash-level approval is intentional; a firmware-upload approval cannot authorize them. These internal names are known to policy configuration but are not advertised MCP tools.

## Lifecycle and cleanup

A session acquires its physical lease before opening a port. Stopping during authorization/backend loading prevents a later open. Transport termination closes the read buffer promptly, including when actual physical cleanup remains unconfirmed.

The lease is released only after `confirmedClosed`. Failed native closure or lease-file release remains visible as `cleanupPending` and `cleanupError`; the session is kept for owned retry. An active session also has `cleanupPending=true` because it still owns its lease. Cleanup status is independent from logical transport state. Stop and bounded owner-only status remain available when policy denies new actions or becomes invalid.

One-shot capture always attempts owned cleanup after reading, cancellation or pattern failure. Its result includes cleanup status; a failed read preserves the original error plus its session ID and cleanup status. Client disconnect cleanup stops only that client's sessions.

The manager admits at most eight starting/live/cleanup-pending sessions. It retains at most sixteen completed buffers for ten minutes, evicting oldest completed data without evicting a live lease. Forgetting is allowed only after cleanup finishes. Buffer cursors, truncation and matching rules are documented in [serial-patterns.md](serial-patterns.md).

## Verification and outstanding adapters

Software tests use the maintained SerialPort mock stream and real temporary lease files. They cover owner isolation, UTF-8 echo, exclusive leases, policy changes, payload mutation, retained reads, cancelled startup, one-shot failure cleanup, delayed native closure, failed lease release and bounded retention. Real-policy tests additionally exercise read-only/build-only/monitor-only profiles, exact byte/baud approval binding, one-use consumption, concrete denies, source changes and invalid-policy cleanup. No physical device was opened.

Physical alias/re-enumeration resolution, legacy monitor/upload migration, public dispatcher wiring, canonical and reference tool adapters, output redaction, plugin/wheel native packaging and real-device acceptance remain required before exposing this service. Existing PlatformIO monitor filters continue through the legacy monitor path; they are not silently interpreted by direct mode.

## Endpoint-aware startup

The internal `startEndpoint` entry point resolves OS aliases, supplies the canonical path and lease key, and retains a revalidation callback for the original selection. Startup checks endpoint metadata before acquiring its lease, immediately before opening after asynchronous backend loading, and after opening. A detected replacement takes the ordinary confirmed-close cleanup path. Endpoint metadata is not physical-board identity and cannot eliminate the race inside the operating system's native open operation; trusted discovery and device-specific identity verification remain required.

The lower-level `start` entry point remains an internal adapter interface for verified physical resource identities. Its optional revalidation callback is executable trusted code, never a public tool parameter. Read access to retained buffers and owned cleanup do not depend on the endpoint still being present.

## Multiple identity scopes

Trusted adapters may supply up to two additional distinct serial resource identities alongside the primary endpoint identity. The manager snapshots these scopes before authorization, includes them in authorization arguments and the policy target digest, and acquires them in sorted order before constructing a transport. Acquisition never waits: contention triggers rollback through the normal cleanup path, with no port opened. This is coordinated acquisition, not a filesystem-wide atomic transaction.

After confirmed closure, each acquired lease is released independently. Only failed releases remain for owner cleanup retry; successful capabilities are not replayed. Capacity and cleanup status account for every retained lease. The discovery adapter must still supply verified USB scopes, and legacy monitor/upload paths still require migration to this shared domain.

## Discovery-aware startup

The internal `startDiscovered` entry point accepts a trusted enumeration provider, resolves the explicit endpoint, binds its structured USB descriptors when available, and supplies both endpoint and USB lease scopes to the session manager. Enumeration must be separately authorized by the adapter; no native enumeration is performed implicitly by the constructor. Each startup identity check refreshes discovery, with the configured operation deadline, before continuing. Stop and policy guards are checked again after every asynchronous metadata boundary. A late enumeration result cannot resume a timed-out startup. The deadline does not terminate the underlying enumeration provider; providers must also bound their own work.

This entry point has fixture coverage for USB replacement during backend loading, stalled metadata and policy revocation during discovery. Native discovery, legacy monitor/upload migration, public adapters and physical verification remain pending.

Initial discovery also reserves one of the eight startup/live slots. Its deadline releases that reservation, while owner-wide cleanup invalidates every discovery started before cleanup. A late result cannot create a new session after that cleanup. Startup snapshots the request and trusted discovery callbacks before waiting, so caller mutation cannot replace them during enumeration. Future explicitly requested sessions for the same owner remain possible.

`PolicySerialSessionService.listSerialDevices` now supplies a shared native provider with actual `list_devices` policy authorization under the canonical project directory. It requires request-local trusted context, and does not forward an opening/writing approval ID as a discovery grant. Public adapters still need to connect discovery and session startup, including their separate approval challenges where inspection itself requires approval.
