# Claude Code Configuration

Prefer the CLI. It needs no server and nothing stays running:

```bash
pio-agent --help
```

See `docs/LLMInstallationGuide.md` for installation and the full command reference.

## MCP server (optional)

```bash
claude mcp add platformio -- node /path/to/platformio-mcp/build/index.js
```

Restart Claude Code after adding. Each session using MCP runs its own server
process; the CLI does not.
