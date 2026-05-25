# Development Guide

[← Back to README](../../README.md)

## Development

```bash
npm run dev          # Development mode with auto-reload
npm test             # Run tests
npm run test:ci:unit # CI unit/component suite (no hardware required)
npm run test:e2e:ci  # CI-safe agent + CLI e2e smoke suite
npm run test:watch   # Run tests in watch mode
npm run lint         # Lint code
npm run format       # Format code
```

## CI/CD

- `.github/workflows/ci.yml` runs on pull requests and pushes.
- It executes typecheck, cross-platform tests, agent/CLI e2e smoke, and package smoke checks.
- `.github/workflows/hardware-e2e.yml` is manual and intended for self-hosted hardware runners.

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
