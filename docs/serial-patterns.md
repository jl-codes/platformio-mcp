# Serial pattern matching

Existing assertion arguments retain literal substring semantics. The shared matcher defaults to literal, case-sensitive matching; callers must explicitly request regex mode. Existing `query_logs.searchPattern` retains its case-insensitive regex behavior but now evaluates in a worker.

Regex mode uses ECMAScript RegExp syntax without global or sticky state. Matching is per line. Compatibility adapters may explicitly enable translation of Python `(?P<name>...)` groups and `(?P=name)` references. Python-only escapes such as `\A`, `\Z`, `\N`, `\U`, `\a`, and `\e` are rejected; inline flag constructs such as `(?i)` are unsupported. This is not a full Python regex interpreter. Existing literal assertions do not interpret metacharacters.

Each request accepts at most 4,096 pattern characters, 10,000 lines and 1 MiB of line data. Regex workers have a 1-second default deadline (configurable internally from 1 to 2,000 ms), memory limits, and a maximum of four concurrent workers. Excess concurrent work returns PATTERN_BUSY. Timeout, unsupported syntax and input limits are explicit errors; no partial match result is treated as success. Workers are terminated before completion is reported, including errors.

New session/capture compatibility adapters still need to call this matcher with their explicit matching mode. These bounds do not establish serial transport, cursor or physical-device acceptance.

## Serial buffer foundation

The internal `SerialSessionBuffer` frames split UTF-8 bytes, CRLF and bare CR/LF into a bounded ring. Defaults retain 5,000 completed lines and 1 MiB of decoded text, with a 16 KiB prefix per line. A partial line shares the byte budget; old completed lines are evicted when necessary. Overlong lines are truncated at whole code points until their actual terminator, never split into invented lines. Results distinguish raw received bytes, evicted decoded-text bytes and truncated decoded-text bytes.

Cursors count completed lines. Stale cursors report lost lines and resume at the earliest retained cursor. Reads advance only through returned completed lines; partial text is a repeatable preview with its own cursor. A full line or byte page defers partial text and reports `moreAvailable`, so callers can paginate without skipping it. Read defaults are 500 lines and 64 KiB, bounded by 10,000 lines and 1 MiB. A custom byte limit must fit one stored line.

Waits are bounded to 120 seconds, with at most 32 pending readers. Cancellation affects only that reader. Disconnect, stop and error retain unread text and terminal state. Literal matching remains the default; regex reads use the bounded matcher above. Its separate 1-second execution deadline may extend the read deadline, and matcher errors are not reported as successful reads. A full page returns immediately even when the requested pattern has not matched.

This module is not yet connected to a serial transport or public tool. Session authorization, physical-device ownership, writes, cleanup, compatibility adapters and real-device acceptance remain required before serial-session parity can be claimed. Existing monitoring behavior is unchanged.
