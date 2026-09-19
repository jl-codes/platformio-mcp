# Physical device ownership

The new internal `DeviceLeaseStore` is the shared lease foundation for serial interfaces and debugger probes. It is not yet wired into monitor/upload/debug operations. Existing semaphores remain in use until their lifecycle and child-process ownership can be migrated together.

## Storage and acquisition

The default root is the operating-system account home plus `.platformio-mcp/device-leases-v1`. It does not follow `PIO_MCP_DATA_DIR`, project directories, plugin caches or temporary-directory fallback. An unwritable or symlinked root is an error. Unix roots must be owned by the current user and not writable by other users. Internal tests can inject an isolated root; public tool arguments must never expose that option.

Resource kind and resolved physical identity are hashed into a filename. Adapters must first establish the same identity for every alias; this store does not infer identity from a port string or description. A new acquisition is exclusive even within the same process. Different resource keys can proceed independently.

A short atomic directory gate serializes record updates. Records are written privately, flushed and atomically renamed while that gate is held. Each contains the owner PID, OS process-start identity and a random nonce. Release requires the original process-local capability and a matching persisted owner/nonce. Session IDs and copied metadata are not release capabilities or permission grants.

## Stale ownership

Acquisition recovers a record only when the previous process is proven absent or its observed start identity differs. Access errors, unavailable process metadata, malformed records and platform mismatches do not establish stale ownership. No process is terminated by these checks.

Windows uses the process's UTC start time through [System.Diagnostics.Process.StartTime](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.starttime). Linux combines the boot ID with [the process stat starttime field](https://www.man7.org/linux/man-pages/man5/proc_pid_stat.5.html). macOS uses the C-locale, UTC `ps lstart` value; Apple's [implementation formats the process start time to seconds](https://github.com/apple-oss-distributions/adv_cmds/blob/main/ps/print.c). Equal tokens conservatively retain ownership, including PID reuse within the same timestamp resolution. External metadata commands have a three-second timeout and bounded output. Actual host verification currently covers Windows only; Linux parsing tests do not establish Linux host acceptance.

An interrupted gate fails closed with `DEVICE_LEASE_GATE_BUSY`; it is never stolen merely because it is old. Persistent gates need operator inspection after confirming no update is in flight. There is not yet an automatic gate-repair command. A crashed process's completed lease record can be recovered normally once no interrupted gate remains.

## Atomic process handoff

An owner can transfer a lease to an already-started child's exact observed process identity. The child must wait behind an IPC barrier without accessing hardware. Transfer rechecks that identity under the update gate, changes the persisted owner, rotates the nonce and invalidates the parent's release handle. The returned ticket is internal IPC data; it is not a public tool input or permission grant.

Only the target OS process can adopt the ticket. Adoption rotates the nonce again, so a second adoption cannot replay the ticket. Hardware access may start only after adoption succeeds. If the parent exits after transfer, the child's live identity continues blocking competitors. If the child exits before adoption, ordinary stale-owner recovery can reclaim the record. If ticket delivery fails while the child remains alive, ownership stays with the child until it exits or completes adoption; the parent must not release its old handle.

Windows integration tests exercise real child adoption, rejected parent release/adoption, one-use tickets, and a detached holder that keeps its lease after the coordinator exits. The holder explicitly releases before the test competitor can acquire. These fixtures do not open hardware or establish ownership of grandchildren spawned by a hardware command.

## Integration still required

Before replacing legacy semaphores, resolve COM/path aliases and USB re-enumeration identities, bind operation ownership, and handle monitor/uploader child processes that can outlive the server. A lease owned only by the parent must not be treated as free while such a child still accesses hardware. The handoff primitive is implemented, but actual monitor/uploader spawn barriers, descendant lifetime handling, policy checks and owned cleanup still belong in that integration. Direct serial sessions, legacy PlatformIO filter monitors, uploads and probe operations must all use the same domain before global hardware exclusion is claimed.

These leases coordinate cooperating processes under one account. They do not block unrelated serial software, prevent arbitrary project scripts from opening hardware, or protect against hostile code with unrestricted access to the same user's files. Hardware acceptance, cross-platform contention and permission validation remain separate gates.

## Serial endpoint aliases

The internal `resolveSerialEndpoint` helper establishes a lease key without opening a port. Windows COM names and their local device-path spellings share a key. Linux symlinks and duplicate character-device nodes share the device number reported by filesystem metadata. Darwin callout and dial-in paths with the same suffix conservatively share a key, while keeping the selected path. Unix paths must resolve inside `/dev` and identify a character device. Metadata failures never fall back to a weaker key.

Revalidation detects changed Unix canonical paths or device numbers. This identifies an endpoint, not a physical board: COM name reuse and USB re-enumeration require trusted discovery and physical metadata before public adapters can claim board identity. The helper is not yet connected to legacy monitor/upload paths. Fourteen injected-metadata tests verify alias handling, rejected names, device type checks and replacement detection without opening hardware.

## Trusted discovery binding

`bindSerialDiscovery` binds an explicitly resolved endpoint to a bounded structured enumeration snapshot. It hashes USB vendor ID, product ID and serial number when all are present; descriptions and inferred board names never establish identity. Vendor/product hexadecimal case is normalized, while serial-number case is preserved. Missing USB descriptors are labeled endpoint-only. Conflicting alias metadata or duplicate descriptors across different endpoints fail as ambiguous, including multi-interface devices that need a later explicit interface model.

Revalidation requires the selected endpoint to remain present with unchanged descriptors. It never follows a matching serial number to a new port or grants automatic reconnect. USB descriptors are not cryptographic authentication and can be duplicated or spoofed. Endpoint and USB exclusion are separate scopes: this helper does not replace the endpoint lease or implement acquisition of both scopes. Trusted native enumeration, adapter wiring, shared legacy coordination and hardware evidence remain outstanding. Tests use injected discovery snapshots only.

## Native enumeration provider

`NativeSerialDiscovery` lazily loads the optional pinned SerialPort backend after an explicit trusted authorization hook returns a revision guard. It rechecks the guard after loading and enumeration, strips unrelated OS metadata, validates at most 1,024 bounded identity records and freezes the returned snapshot. Missing optional metadata remains missing. Loading, enumeration, invalid metadata and timeout errors are distinguishable; failure is never represented as an empty device list.

Each provider permits only one outstanding request. Its 1–30,000 ms deadline bounds the caller wait, but cannot terminate an OS enumeration. After timeout the provider remains busy until the underlying operation settles. A late authorization/backend-load result does not launch enumeration after the deadline. Public adapters must share the provider and connect its inspection authorization to the existing policy dispatcher. Tests inject providers and do not enumerate hardware.
