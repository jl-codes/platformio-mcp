# Development Guide

[← Back to README](../../README.md)

## Development

```bash
npm run dev          # Development mode with auto-reload
npm test             # Run tests
npm run test:watch   # Run tests in watch mode
npm run lint         # Lint code
npm run format       # Format code
```

## Project Structure

```text
platformio-mcp/
├── src/
│   ├── index.ts          # MCP server entry point
│   ├── types.ts          # Type definitions and Zod schemas
│   ├── platformio.ts     # PlatformIO CLI wrapper
│   ├── tools/
│   │   ├── boards.ts     # Board discovery
│   │   ├── devices.ts    # Device listing
│   │   ├── projects.ts   # Project init
│   │   ├── build.ts      # Build and clean
│   │   ├── upload.ts     # Firmware and filesystem upload
│   │   ├── monitor.ts    # Serial monitor
│   │   └── libraries.ts  # Library management
│   └── utils/
│       ├── validation.ts # Input validation
│       └── errors.ts     # Error handling
├── package.json
├── tsconfig.json
└── README.md
```
