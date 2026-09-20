# Python compatibility distributions

`pio-agent` and `pio-mcp` depend on the exact matching `pio-agent-platformio` release. The canonical package owns all three executable files, so installing or uninstalling an alias cannot overwrite or remove another distribution's command file. The aliases provide `python -m pio_agent_alias` and `python -m pio_mcp_alias`, which delegate to the same launcher and preserve its arguments, stdio and exit status.

After publication, explicit installation commands are `uvx --from pio-agent pio-agent` and `uvx --from pio-mcp pio-mcp`. The `[platformio]` extra delegates to the canonical package's pinned extra. These names are candidates until publishing authority and registry acceptance are verified. No alias is published by the build script.

Build with `python scripts/build-python-aliases.py <new-staging-directory>` using the pinned setuptools/wheel build environment. Version and exact dependencies derive from the root package; namespace membership is checked against the distribution inventory. Prerelease version mapping is rejected until explicitly supported.
