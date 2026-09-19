# CLI-First Adapter Design

**Date:** 2026-09-18
**Branch:** `feat/cli-first-adapter`
**Status:** Approved design, pending implementation plan

## Problem

Each agent session that connects over MCP spawns its own `platformio-mcp` server process.
Users running several concurrent sessions therefore pay for several resident Node processes,
and every session pays MCP server startup latency before its first tool call.

The cost is per-process, not per-token. The fix is to stop requiring a long-lived process
for ordinary work.

## What already exists

This repository is one engine with four adapters:

```
src/core/*  +  src/tools/*          <- engine
     |-- src/index.ts               MCP server, 42 tools
     |-- src/cli.ts                 CLI, 26 commands (already standalone)
     |-- src/api/server.ts          web dashboard (HTTP)
     |-- .skills/ + .agents/skills/ 8 skills (written against MCP tool names)
```

The CLI already works without any server: its handlers call the same `*Core` functions
the MCP tools call, and it emits structured JSON (`errorType`, `recommendedAction`,
`safeToAutoRetry`) with correct exit codes.

Persistent state is already file-backed and survives process exit:

| State | Location | Survives exit |
|---|---|---|
| Command/task history | `command_history.json` | yes |
| Task + monitor PIDs | `active_tasks.json`, `monitor-pids.json` | yes |
| Workspace registry | `workspaces.json` | yes |
| Per-port serial locks | `LOCKS_DIR` semaphores | yes |
| Build/serial logs | `LOGS_DIR` | yes |
| Global hardware lock | `HardwareLockManager` in-process singleton | **no** |

The in-process global lock is the single correctness blocker for a CLI-per-invocation model.

## Goals

1. The CLI is the default interface for agents and humans; no process is required.
2. Concurrent sessions are protected by a lock that actually works across processes.
3. Skills drive the CLI, not MCP tool names.
4. The web dashboard starts only on explicit human request.

## Non-goals

- Removing MCP. It stays fully working and supported.
- Rewriting the web UI.
- Changing the policy/approvals engine, diagnostics, or build/flash logic.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| MCP's fate | Demote, keep working | No capability loss, no breaking change |
| Cross-process exclusion | Fix the port semaphore; leave global lock in-process | Port-scoped is the real hole and is finer-grained |
| Skill shape | Gateway skill + task skills | Single place for CLI knowledge; keeps narrow triggers |
| Bare `pio-agent` | Keep serving, warn on stderr | Zero breakage now; flip in a later major |
| Dashboard | Explicit `pio-agent dashboard --serve` | Starts only when a human asks |
| `reset_server_state` | No CLI equivalent | Meaningless without a long-lived server |

## 1. CLI gap closure (19 commands)

21 of 42 MCP tools have no CLI equivalent. Three are deliberately not ported (below),
leaving 18, plus one new recovery command, giving 19. Every ported command already has an
exported core function, so this is wiring: parse args, call the function, print JSON.

| New CLI command | MCP tool |
|---|---|
| `lib search` | `search_libraries` |
| `lib install` | `install_library` |
| `lib uninstall` | `uninstall_library` |
| `lib update` | `update_library` |
| `lib list` | `list_installed_libraries` |
| `lock status` | `get_lock_status` (+ port claims) |
| `port release` | (new) stale-claim recovery |
| `project check` | `check_project` |
| `project config` | `get_project_config` |
| `project context` | `get_project_context` |
| `logs query` | `query_logs` |
| `logs capture` | `capture_serial_window` |
| `board-info` | `get_board_info` |
| `clean` | `clean_project` |
| `test` | `run_tests` |
| `system-info` | `system_info` |
| `monitor-stop` | `stop_monitor` |
| `task-cancel` | `cancel_task` |
| `upload-fs` | `upload_filesystem` |

### Deliberate omissions

Three MCP tools get no CLI equivalent, because a one-shot process cannot implement them
honestly:

- `reset_server_state` — meaningless without a long-lived server.
- `acquire_lock` / `release_lock` — the global lock is process-scoped (see section 2).
  A CLI process would acquire a lock and discard it on exit, which is worse than not
  offering the command.

`lock status` is still exposed, but is redefined to report both the process-scoped global
lock (clearly labelled `scope: "process"`, and always unlocked when invoked from the CLI)
and the **cross-process port claims**, which is the information an agent actually needs.

`port release --port <p>` is added as a recovery command for clearing a stale claim left by
a crashed process. It refuses to clear a claim whose owner PID is still alive unless
`--force` is passed.

That is **19 new commands**, not 20.

### Structural change

`src/cli.ts` is 904 lines; adding 19 commands inline would push it past 1400 and
reproduce the problem `src/index.ts` already has at 2207 lines.

Split into:

```
src/cli.ts                 arg parsing, dispatch, help, version  (thin)
src/cli/commands/          one module per command group
  devices.ts  boards.ts  project.ts  build.ts  flash.ts
  monitor.ts  logs.ts    lib.ts      lock.ts   task.ts
  agent.ts    policy.ts  dashboard.ts install.ts
src/cli/output.ts          shared JSON/human formatting, exit codes
```

Each module exports a handler taking parsed args and returning a result object.
`src/cli.ts` owns no business logic.

All existing command names and flags are preserved. This is a refactor, not a redesign.

## 2. Cross-process exclusion: fix the port semaphore

### The actual defect

`SemaphoreManager` is named a semaphore but does not provide mutual exclusion:

- `claimPort()` performs an unconditional `writeFileSync`. It never fails and silently
  overwrites an existing claim (`src/utils/semaphore.ts:54`).
- `isPortClaimed()` is consulted in exactly one place, `src/tools/monitor.ts:405`.
- Both flash paths, `src/tools/upload.ts:86` and `src/tools/upload.ts:233`, call
  `claimPort()` without ever checking whether the port is already claimed.

Consequently two concurrent `pio-agent flash` invocations against the same port both
"claim" it and both proceed. The in-process `HardwareLockManager` does not help, because
each CLI process constructs its own unlocked singleton.

**This hole exists today.** It is not introduced by the CLI-first change; that change only
removes the appearance of protection.

### The fix

`claimPort()` becomes a real acquisition. Two properties matter, and `wx` alone
provides neither.

**A partial claim file must never be visible.** `writeFileSync(path, data, { flag: "wx" })`
is `open(O_CREAT|O_EXCL)` then `write()` then `close()`. Between the open and the
write the file exists and is zero length. A second process reading it gets a JSON
parse error, concludes the file is unusable, deletes it and takes the port. Both
processes then flash. This was reproduced against the implementation.

So a claim is published by **link**, not by create-then-write:

1. Write the full JSON to `<path>.tmp.<pid>.<uuid>`.
2. `fs.linkSync(tmp, path)`. `link()` is atomic and fails `EEXIST` if the target
   exists, so the file appearing at `path` is always complete.
3. Unlink the temp file in a `finally`.

`link()` is also the portable idiom over NFS, where `O_EXCL` is not reliably
atomic. That matters because `PIO_MCP_DATA_DIR` may point at shared storage.

**Reclaiming a stale claim must be serialised.** `rmSync` has no unlink-if-inode,
so two processes that both judge one claim stale can both unlink and both create,
the second deleting the first's *fresh* claim. The reclaim therefore runs under a
breaker file, `<path>.reclaim`, acquired with the same atomic link, with staleness
re-confirmed under it:

- Fail to acquire the breaker → another process is already reclaiming → `PORT_BUSY`.
- A breaker older than `BREAKER_TTL_MS` (30 s) is itself stale and is removed once.
- The breaker is always released in a `finally`.

**Classifying the existing file.** "Unreadable" is not one thing, and treating them
alike destroys live claims. `claimPort` classifies before acting:

| State | Meaning | Action |
|---|---|---|
| absent | no claim | acquire |
| ok | parsed claim | owner / staleness rules below |
| unreadable, mtime < 5 s | very likely mid-write by a live process | `PORT_BUSY`, never reclaim |
| unreadable, mtime ≥ 5 s | genuinely corrupt | reclaim under the breaker |
| denied (`EACCES`/`EPERM`) | a foreign claim we may not read | error, never reclaim |

The `EACCES` case is the same hazard as the legacy-hostname rule below: an
unreadable live claim on shared storage must not be silently destroyed.

**Other rules.**

- **Re-entrancy** — same `owner_pid` *and* `hostname` re-claiming refreshes in
  place, written by temp-plus-`rename` so no reader sees a truncated file.
- **Record** — the existing payload plus `hostname` and the real `port`, keeping
  `owner_pid`, `owner_workspace`, `type` and `timestamp`. The port is recorded
  because claim filenames are sanitised and lossy (`/dev/cu.x` → `dev_cu_x`).
- **Release** — `releasePort()` only removes a claim owned by this process, unless
  it is stale or `force` is passed.
- **Filesystem errors** — anything other than `EEXIST` is wrapped in a
  `PlatformIOError` with code `CLAIM_IO_ERROR` carrying the errno, so the CLI's
  structured error contract still applies to `ENOSPC`, `EROFS` and friends.

### Staleness

A claim is stale under exactly one of two tests, chosen by whether liveness is
*provable*:

- **A monitor claim on this host** — `process.kill(monitor_pid, 0)`. A monitor is
  held by a detached child, not by whoever launched it, and under the CLI the
  launcher exits seconds later while that child keeps the UART. Probing the
  launcher was wrong in both directions: it freed a port a live monitor still
  held, and it wedged a port forever when an MCP server outlived its dead
  monitor. Claims written before `monitor_pid` existed fall back to the rule
  below.
- **Same host** — `process.kill(owner_pid, 0)`. This is authoritative in **both**
  directions: `ESRCH` means stale, and a live PID means **not** stale no matter how
  old the claim. A serial monitor is routinely held for hours, and reclaiming a
  provably-live holder because a timer expired is never correct.
- **Different host, or an empty hostname from a legacy claim file** — the PID
  cannot be probed, so the TTL is all there is.

**Two TTLs, by claim type.** A single 30-minute TTL was wrong in both
directions: it reclaimed live monitors out from under users (a monitor is
legitimately held for hours), yet no TTL at all let a recycled PID — routine on
Windows, which reuses PIDs from a small pool — wedge a port forever. So:

| Claim | TTL | Env override | Rationale |
|---|---|---|---|
| upload | 30 min | `PIO_PORT_CLAIM_TTL_MS` | a flash never legitimately takes longer |
| monitor | 24 h | `PIO_MONITOR_CLAIM_TTL_MS` | never reclaimed within a working day; PID reuse still capped |

The TTL applies to every claim, including a same-host one whose PID probes
alive: a live PID *usually* means the holder is running, but after the TTL it
is more likely a recycled PID than a day-long flash.

Because a live PID is never stale, a same-host claim **leaked** by a long-lived
process is now permanent rather than self-healing after 30 minutes. That is the
right trade — a monitor held for hours must not be reclaimed out from under
itself — but it raises the stakes on two things:

- `stopMonitor` must reliably release the monitor's claim (see "Caller changes"),
  otherwise a killed monitor leaves a claim owned by the still-alive MCP server
  and the port never recovers on its own.
- `pio-agent port release` becomes the only recovery path for a leaked claim,
  so it must be documented in the gateway skill rather than treated as an
  obscure maintenance command.

An empty hostname is deliberately treated as unprobeable rather than local. Probing
an unattributable PID risks a false "dead" verdict against a live claim on shared
storage, which is the exact double-flash this design exists to prevent. Waiting out
the TTL fails safe.

### Caller changes

- `upload.ts:86` and `upload.ts:233` must handle a failed claim and surface a structured
  `PORT_BUSY` error naming the holding PID, workspace, and claim type, rather than
  proceeding.
- `stopMonitor` force-clears a surviving monitor claim **only when the kill was
  proven** (a PID was found, tree-kill succeeded, and the PID is confirmed gone).
  `killPioMonitorByPort` resolves even when it found no PID, so an unverified kill
  must fall back to a non-force release; otherwise a live monitor that was never
  killed loses its claim and the next `claimPort` flashes the port underneath it.
- `monitor.ts:405`'s `isPortClaimed()` pre-check is **removed**. It is an
  `existsSync` that ignores staleness, so a crashed monitor's leftover claim blocks
  `startMonitor` forever even though `claimPort` twelve lines later would reclaim
  it; it is also a TOCTOU against that call. Letting `claimPort` throw is strictly
  better and yields a `PortBusyError` naming the holder.
- Monitor and spooler release paths are unchanged.

Long-running monitors must not block a flash indefinitely. `stopMonitor` currently
releases the port claim **inside** `if (activeDaemons[port])` (`src/tools/monitor.ts:158`),
an in-process map, while `killPioMonitorByPort` runs afterwards outside that branch. A CLI
process has an empty `activeDaemons`, so it kills the monitor and leaves the claim behind;
the claim's `owner_pid` is the still-alive MCP server, so it reads as live-and-foreign and
the subsequent flash fails `PORT_BUSY` after the monitor is already dead.

The release must therefore move **after** `killPioMonitorByPort`, outside the
`activeDaemons` branch, and force-release only when the surviving claim is
`type: "monitor"`. A competing *upload* claim remains a hard conflict.

### A flash pre-empts a monitor, across processes

`uploadFirmware` and `startMonitor` both call `stopMonitor` before claiming the
port. That rule predates this work; what is new is that it now reaches across
process boundaries. A `pio-agent flash` will stop a monitor started by an MCP
session in a different process, take the port, and flash.

This is deliberate and is the right default for a single developer with one
board: a monitor is a passive observer and a flash is the operation the user
actually asked for, so the flash wins, and the monitor claim is released rather
than reported as `PORT_BUSY`. Only a competing *upload* claim is a hard
conflict. The cost is that a monitor another session was relying on stops
without that session being told. Two things keep this safe: the claim is
released only once the monitor's own PID is confirmed gone, never on an
unverified kill; and a monitor on another *host* (shared `PIO_MCP_DATA_DIR`) is
never stopped, since we cannot kill it and must not steal its claim.

### Known limitations of the claim model

These are documented rather than fixed, because each needs either a platform we
cannot test here or a design change out of proportion to its likelihood.

- **`hostname` is used as a proxy for "same PID namespace", and that is false in
  containers.** Two containers sharing `PIO_MCP_DATA_DIR` through a bind mount
  have independent PID namespaces, and compose replicas share a hostname, so a
  same-host PID probe may hit an unrelated process. A container and its host
  read as *foreign* and fall back to the TTL alone, so a multi-hour monitor
  becomes reclaimable after 30 minutes. Given this repo's own dev-container
  convention, a boot-id or container-id in the claim is the right follow-up.
- **`tree-kill` ignores the signal on Windows** (it runs `taskkill /F`), so
  `task-cancel`'s `SIGTERM` is a forced kill there with no graceful flush.
- **`tree-kill` on Alpine/busybox** cannot enumerate children (`ps --ppid` is
  procps-only) and silently kills only the parent, orphaning `pio`'s Python
  children. Ubuntu and macOS are unaffected.
- **A claim file held open by another process** (an antivirus scanner, Explorer)
  makes `rmSync` fail `EBUSY` on Windows. Node itself opens with share-delete,
  and claim files are never held open by this tool, so the exposure is external.
- **No Windows machine ran this branch.** The Windows-specific paths --
  reserved device names, the `EACCES` link fallback, `taskkill` semantics --
  are reasoned from libuv and Win32 behaviour and covered by the windows-latest
  CI job, but a manual `pio-agent --version` and one claim on a real `COMn`
  port are worth doing before relying on it there.

### Global pipeline lock

`HardwareLockManager` stays an in-process singleton. It remains meaningful under
`pio-agent serve` and the dashboard, where one process owns all work. It is a no-op for
one-shot CLI invocations, and this is documented rather than papered over:

- The `pio-manager` gateway skill states plainly that the global pipeline lock is
  MCP/dashboard-only, and that port-level exclusion is what protects CLI hardware access.
- `lock status` output includes a `scope: "process"` field so an agent cannot mistake it
  for a cross-session guarantee.

Port-scoped exclusion is also strictly better for the common case: two boards on two ports
can build and flash in parallel, which a global pipeline lock would forbid.

## 3. Skills

Sources are `.skills/*` and `.agents/skills/pio-manager`.
`plugins/platformio-mcp/skills/` is generated by `npm run plugin:sync`; it is never
edited directly, and `npm run plugin:sync:check` gates drift.

### `pio-manager` (gateway)

Its "3-Tier Execution Hierarchy" currently reads
"Tier 1 (Preferred): MCP Server Primitives ... agents MUST ALWAYS attempt to use these tools first."

This inverts:

- **Tier 1** — the `pio-agent` CLI. Full command reference lives here.
- **Tier 2** — MCP tools, only when a server is already running. Never start one.
- **Tier 3** — raw shell/esptool escape hatches, unchanged.

`references/mcp-agent-reference.md` gains a CLI equivalent; the MCP reference is retained
and marked optional.

### Task skills

The 7 task skills stop naming MCP tools and defer to the gateway for syntax, keeping
their own narrow `description` triggers and safety rules.

### `platformio-dashboard`

Rewritten so the agent **never starts the dashboard itself**. It instructs the user to run:

```
pio-agent dashboard --serve
```

and waits for the user to do so.

## 4. Entry-point behavior

| Invocation | Behavior |
|---|---|
| `pio-agent` (bare) | Starts MCP stdio server **and** prints a deprecation warning to stderr |
| `pio-agent serve` | Starts MCP stdio server, no warning |
| `pio-agent dashboard` | Prints the dashboard URL/status (current behavior) |
| `pio-agent dashboard --serve` | Starts the web UI and blocks; human-initiated only |
| `pio-agent <command>` | Runs and exits |

### `--background` from the CLI

The spooler's background mode keeps the *parent* alive: completion bookkeeping
— task status, PID unregister, port-claim release, the `--start-monitor` hook —
runs in the parent's `.then()` after the child exits. Under the long-lived MCP
server that is exactly right. Under a one-shot CLI it meant
`pio-agent build --background` printed `{status:"running"}` and then blocked for
the whole build — the opposite of what the skills promise agents.

So the CLI backgrounds by **re-executing itself in foreground mode as a
detached child**, with the task id assigned up front and threaded through
`mcpContext` as the command id. The foreground path already does all of the
bookkeeping, including `onSuccess` hooks, so nothing is serialised across
processes and the MCP path is untouched. The parent prints
`{status:"running", taskId}` and exits in ~100 ms; `task-status <id>` reads the
child's recorded result. The child is short-lived — it ends with the task —
which is consistent with "nothing outlives the command it was asked for".

The deprecation warning goes to **stderr only**, so stdio MCP framing on stdout is unaffected.

`src/index.ts` is untouched, so documented `claude mcp add platformio -- node build/index.js`
setups continue to work unchanged.

## 5. Testing

- `tests/lock-manager.test.ts` stays green unchanged; `HardwareLockManager` is not modified.
- `tests/upload.test.ts` currently mocks `claimPort`/`releasePort` as no-ops and asserts
  only that they were called. It must be extended to cover a failing claim.
- **New multi-process port-claim test:** spawn two real `pio-agent flash` processes
  targeting the same port and assert exactly one proceeds while the other exits with a
  structured `PORT_BUSY` error; then kill a holder and assert the next claimer reclaims the
  stale claim. This is the regression test for the concurrent-flash defect.
- **New test:** two different ports claim concurrently and both succeed, proving the fix
  did not reintroduce global serialization.
- CLI smoke coverage for all 19 new commands (`--help` parse + JSON shape).
- `npm run plugin:sync:check` verifies skill sources and generated plugin copies agree.
- Existing suites (`mcp.test.ts`, `mcp-agent-smoke.test.ts`) must stay green, proving
  MCP was demoted and not broken.

## Migration

No user action is required. MCP setups keep working. Users wanting the lower-footprint
path switch their agents to the CLI and skills; the deprecation warning on bare invocation
signals the future direction.
