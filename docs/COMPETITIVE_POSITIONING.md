# Competitive Positioning

This document summarizes PlatformIO-MCP positioning relative to proprietary AI firmware IDEs in neutral terms.

## PlatformIO-MCP: Core Differentiators

- Open source and inspectable
- Agent-agnostic (MCP + CLI adapters)
- Local-first execution model
- Explicit policy and approval controls
- Structured diagnostics and persistent artifacts
- Extensible board intelligence and workflow modules

## Practical Comparison Dimensions

### Openness
- **PlatformIO-MCP:** Source, behavior, and file artifacts are visible and patchable.
- **Proprietary IDEs:** Internal orchestration and policy logic may be opaque.

### Agent Integration
- **PlatformIO-MCP:** Designed as a reusable execution layer for multiple hosts.
- **Proprietary IDEs:** Often optimized for a single hosted agent experience.

### Safety Controls
- **PlatformIO-MCP:** Explicit allow/deny/approval model, audit trails, and policy profiles.
- **Proprietary IDEs:** Safety behavior may be managed centrally with less local customization.

### Extensibility
- **PlatformIO-MCP:** Add new tools, diagnostics, board profiles, and tests directly.
- **Proprietary IDEs:** Extension points can be narrower or vendor-scoped.

### Deployment Model
- **PlatformIO-MCP:** Runs locally with your PlatformIO toolchain and hardware.
- **Proprietary IDEs:** May blend local and hosted components depending on vendor.

## Positioning Statement

PlatformIO-MCP is best positioned as an open, policy-aware hardware execution layer that keeps embedded AI workflows transparent, local, and adaptable across agent ecosystems.
