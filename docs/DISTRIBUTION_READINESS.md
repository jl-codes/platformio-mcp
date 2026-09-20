# Distribution readiness

The parity branch is not a releasable version yet. Implementation, acceptance, and publication remain separate gates. This inventory defines the supported publication targets; it does not claim that all lookalike names can be reserved.

| Channel | Intended identity | Current evidence | Remaining release gate |
|---|---|---|---|
| npm canonical | `platformio-mcp` | Public 3.0.0 metadata links this repository; local tarball validates | New unused version, full release gates, verified OIDC publisher or authenticated authority, registry-installed smoke and provenance |
| npm aliases | `pio-agent`, `pio-mcp` | Both published at 3.0.0; local functional wrappers now pin the exact canonical version | Publish canonical first, then matching aliases; verify installed command routing |
| npm scoped alias | `@forkbomb/platformio-mcp` | Public lookup missing | Authenticate scope control, implement/test functional wrapper; do not assume availability |
| PyPI canonical | `pio-agent-platformio` | Public lookup missing | Functional wheels for all five planned host targets, trusted publisher, actual name acceptance and installed-artifact verification |
| PyPI aliases | `pio-agent`, `pio-mcp` | Public lookups missing | Exact canonical dependency, executable collision tests, authority and publication |
| Official MCP Registry | `io.github.jl-codes/platformio-mcp` | Planned owner-qualified identity | Server manifest, package ownership metadata, publisher authentication, publish and verify registry result |
| Codex plugin | `platformio-mcp` from this repository | Local bundled plugin validation passes | Release version/source consistency, install/upgrade smoke against published source |
| GitHub release | `jl-codes/platformio-mcp` | Authenticated repository admin access verified | Reviewed release commit/tag, immutable artifact identity and release gates |
| Other registries | See inventory's unsupported channels | No supported artifacts or authority evidence | Build and validate an authentic installer before adding a channel |

## Occupied and watched names

PyPI normalizes runs of `.`, `_`, and `-`: `platformio.mcp`, `platformio_mcp`, and `platformio-mcp` are the same occupied third-party distribution. Never route this project's Python installation to that name. The same rule groups `pio.agent` with `pio-agent`. npm identities follow npm's own rules; do not apply Python normalization there. [Python normalization specification](https://packaging.python.org/en/latest/specifications/name-normalization/).

The finite source inventory is `distribution/namespaces.json`. `npm run namespace:audit` performs read-only public metadata lookups, records timestamps and response hashes, and never installs discovered packages. A 404 is `lookup_missing`, not a reserved or guaranteed-available name. A 401/403/429 is blocked, never available. Public repository links do not verify publishing authority. Current observations are in `docs/reviews/platformio-namespace-observations.json`.

## Concrete blockers observed

- Local `npm whoami --registry=https://registry.npmjs.org` returned HTTP 401. Repository admin access does not establish npm/PyPI ownership. Verify package-specific OIDC configuration in the protected release workflow; do not paste tokens into task messages.
- Local manifests still use 3.0.0, already published. Select and consistently apply a new release version after compatibility review. Do not treat the existing 3.0.0 packages as the new implementation.
- Python wheel packaging and MCP Registry publication metadata are not implemented yet.
- Full parity, cross-host/hardware acceptance, and the release gate remain incomplete. No new release has been published by this goal.

## Release identity enforcement

The release workflow builds all three npm tarballs and checks names, versions, exact alias dependencies, and SHA-512 integrity before publishing any artifact. Existing versions are accepted only when their exact artifact integrity matches; registry errors fail closed. Publishing requests npm provenance and rechecks registry artifact integrity. This does not replace installed-artifact smoke tests or cryptographic attestation verification, which remain required.

`npm run test:namespaces` tests normalization, lookup failure handling, wrong-package rejection, and changed artifact identity. These controls are now part of CI and release gates. Namespace audit backoff/cache/change notification, wheel identity, and end-to-end publication checks remain outstanding.
