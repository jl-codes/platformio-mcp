# Serial pattern matching

Existing assertion arguments retain literal substring semantics. The shared matcher defaults to literal, case-sensitive matching; callers must explicitly request regex mode. Existing `query_logs.searchPattern` retains its case-insensitive regex behavior but now evaluates in a worker.

Regex mode uses ECMAScript RegExp syntax without global or sticky state. Matching is per line. Compatibility adapters may explicitly enable translation of Python `(?P<name>...)` groups and `(?P=name)` references. Python-only escapes such as `\A`, `\Z`, `\N`, `\U`, `\a`, and `\e` are rejected; inline flag constructs such as `(?i)` are unsupported. This is not a full Python regex interpreter. Existing literal assertions do not interpret metacharacters.

Each request accepts at most 4,096 pattern characters, 10,000 lines and 1 MiB of line data. Regex workers have a 1-second default deadline (configurable internally from 1 to 2,000 ms), memory limits, and a maximum of four concurrent workers. Excess concurrent work returns PATTERN_BUSY. Timeout, unsupported syntax and input limits are explicit errors; no partial match result is treated as success. Workers are terminated before completion is reported, including errors.

New session/capture compatibility adapters still need to call this matcher with their explicit matching mode. These bounds do not establish serial transport, cursor or physical-device acceptance.
