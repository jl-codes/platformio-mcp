# Dependency inspection

Use the canonical MCP tool `deps_check`, or run:

```text
pio-agent deps-check --project-dir /path/to/project --environment example --json
```

The tool compares resolved declarations with local, extra-directory and installed
library manifests. It reports collisions, unconstrained registry dependencies,
possible missing or leftover libraries, and observed manifest cycles. These
findings do not prove which library the linker selected.

Add `--build` to request a separately authorized build and collect its dependency
graph. Inspect `inventoryComplete`, `diagnostics`, `graphStatus` and the build
result separately. Missing graph output is not an empty successful graph.

The CLI accepts `--approval-id`, `--configuration-approval-id`,
`--inventory-approval-id` and `--build-approval-id` for the corresponding scoped
stages. Approval IDs are not interchangeable. The command does not accept a
blanket `--approve` flag. MCP uses the corresponding camel-case argument names.

The reference `pio_deps_check` adapter and full hardware/release acceptance are
still pending in this development revision.
