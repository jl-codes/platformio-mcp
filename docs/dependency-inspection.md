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
Graph status describes parsing of the tree printed by PlatformIO; normal build
output may omit transitive dependencies. It is not proof of a complete linker
or manifest graph.

`inventoryTiming` is `before_build`: the optional build may install or change
libraries after the inventory scan. Run another inspection to observe that
resulting state. Compatibility output exposes this as `inventory_timing`.

The CLI accepts `--approval-id`, `--configuration-approval-id`,
`--inventory-approval-id` and `--build-approval-id` for the corresponding scoped
stages. Approval IDs are not interchangeable. The command does not accept a
blanket `--approve` flag. MCP uses the corresponding camel-case argument names.

Opt-in compatibility mode also provides `pio_deps_check` with `project_dir`,
`env`, `build` and snake-case approval identifiers. Exact reference result-field
equivalence and full build/hardware/release acceptance remain pending.
