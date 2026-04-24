<p align="center">
  <img src="Cline-PlatformIO-MCP-Server-Logo.png" alt="PlatformIO MCP Server Logo" width="200"/>
</p>

# PlatformIO MCP Server

A board-agnostic [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for [PlatformIO](https://platformio.org) embedded development. This server enables AI agents like [Antigravity](https://antigravity.google/), [Cline](https://github.com/cline/cline), and [Claude Code](https://docs.anthropic.com/en/docs/claude-code) to interact with PlatformIO's comprehensive ecosystem of **1,000+ development boards** across **30+ platforms**.

## Quickstart

### Prerequisites

- Node.js >= 18.0.0
- PlatformIO Core CLI ([install guide](https://platformio.org/install/cli))

```bash
# Install PlatformIO via pip
pip install platformio

# Or via Homebrew on macOS
brew install platformio

# Verify
pio --version
```

### Installation

```bash
git clone https://github.com/jl-codes/platformio-mcp.git
cd platformio-mcp
npm install
npm run build
```

### Usage Example

Add the server to your agent's MCP configuration:

```json
{
  "mcpServers": {
    "platformio": {
      "command": "node",
      "args": ["/absolute/path/to/platformio-mcp/build/index.js"]
    }
  }
}
```

## Documentation Index

- [LLM Installation Guide](docs/llms-install.md)
- [Setting Up ESP32 Devices for Native USB Stability](docs/SettingUpESP32Devices.md)
- [PIO MCP Design Specification (Placeholder)](#)
- [Web UX Design Specification (Placeholder)](#)
- [MCP Server Command Reference (Placeholder)](#)

## Contributing & Support

Contributions welcome. Open an issue or submit a pull request.

For issues and questions:
- Open an issue on GitHub
- Check PlatformIO documentation: https://docs.platformio.org
- Join PlatformIO community: https://community.platformio.org

## License

MIT. See [LICENSE](LICENSE).
