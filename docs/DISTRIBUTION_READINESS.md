# Distribution readiness

The parity branch is not a releasable version yet. Implementation, acceptance, and publication remain separate gates. This inventory defines the supported publication targets; it does not claim that all lookalike names can be reserved.

| Channel | Intended identity | Current evidence | Remaining release gate |
|---|---|---|---|
| npm canonical | `platformio-mcp` | Public 3.0.0 metadata links this repository; local tarball validates | New unused version, full release gates, verified OIDC publisher or authenticated authority, registry-installed smoke and provenance |
| npm aliases | `pio-agent`, `pio-mcp` | Both published at 3.0.0; local functional wrappers now pin the exact canonical version | Publish canonical first, then matching aliases; verify installed command routing |
| npm scoped alias | `@forkbomb/platformio-mcp` | Public lookup missing | Authenticate scope control, implement/test functional wrapper; do not assume availability |
| PyPI canonical | `pio-agent-platformio` | Public lookup missing | Functional wheels for all five planned host targets, trusted publisher, actual name acceptance and installed-artifact verification |
| PyPI aliases | `pio-agent`, `pio-mcp` | Both functional alias wheels build with exact canonical pins and no shared command-file ownership | Installed uvx/uninstall acceptance, authority and publication |
| Official MCP Registry | `io.github.jl-codes/platformio-mcp` | Pinned official schema, server manifest and npm ownership metadata validate locally | Publisher authentication, new published npm version with matching mcpName, publish and verify registry result |
| Codex plugin | `platformio-mcp` from this repository | Local bundled plugin validation passes | Release version/source consistency, install/upgrade smoke against published source |
| GitHub release | `jl-codes/platformio-mcp` | Authenticated repository admin access verified | Reviewed release commit/tag, immutable artifact identity and release gates |
| Other registries | See inventory's unsupported channels | No supported artifacts or authority evidence | Build and validate an authentic installer before adding a channel |

## Occupied and watched names

PyPI normalizes runs of `.`, `_`, and `-`: `platformio.mcp`, `platformio_mcp`, and `platformio-mcp` are the same occupied third-party distribution. Never route this project's Python installation to that name. The same rule groups `pio.agent` with `pio-agent`. npm identities follow npm's own rules; do not apply Python normalization there. [Python normalization specification](https://packaging.python.org/en/latest/specifications/name-normalization/).

The finite source inventory is `distribution/namespaces.json`. `npm run namespace:audit` performs read-only public metadata lookups, records timestamps and response hashes, and never installs discovered packages. A 404 is `lookup_missing`, not a reserved or guaranteed-available name. A 401/403/429 is blocked, never available. Public repository links do not verify publishing authority. Current observations are in `docs/reviews/platformio-namespace-observations.json`.

## Concrete blockers observed

- Local `npm whoami --registry=https://registry.npmjs.org` returned HTTP 401. Repository admin access does not establish npm/PyPI ownership. Verify package-specific OIDC configuration in the protected release workflow; do not paste tokens into task messages.
- Local manifests still use 3.0.0, already published. Select and consistently apply a new release version after compatibility review. Do not treat the existing 3.0.0 packages as the new implementation.
- A first Windows wheel builds and passes isolated CLI smoke; the other wheel targets and MCP Registry publication automation remain incomplete. The MCP Registry manifest and npm mcpName are implemented and validated locally.
- Full parity, cross-host/hardware acceptance, and the release gate remain incomplete. No new release has been published by this goal.

## Release identity enforcement

The release workflow builds all three npm tarballs and checks names, versions, exact alias dependencies, and SHA-512 integrity before publishing any artifact. Existing versions are accepted only when their exact artifact integrity matches; registry errors fail closed. Publishing requests npm provenance and rechecks registry artifact integrity. This does not replace installed-artifact smoke tests or cryptographic attestation verification, which remain required.

`npm run test:namespaces` tests normalization, lookup failure handling, wrong-package rejection, and changed artifact identity. These controls are now part of CI and release gates. Namespace audit backoff/cache/change notification, wheel identity, and end-to-end publication checks remain outstanding.

## MCP Registry identity

`server.json` advertises the exact canonical npm version over stdio. `npm run registry:validate` verifies the official schema, repository identity, namespace inventory, npm `mcpName`, and package/version routing. The schema is pinned by upstream commit and SHA-256 in `distribution/mcp-schema-source.json`, with its upstream license preserved in `distribution/MCP-REGISTRY-LICENSE`. This is preparation only: a manifest cannot establish publisher authority or make the new runtime available before npm publication.

Publication now reads the previously uploaded npm preflight manifest and rejects changes to its source commit, package set, versions, artifact paths, or hashes. It does not rewrite that record during publication. An unpublished entry may become identical during a retry, but an already verified entry may not disappear. GitHub release uploads no longer overwrite existing assets; a duplicate asset stops that upload instead of replacing published bytes. Safe identical-asset reuse for GitHub remains to be implemented.

## Python runtime preparation

`distribution/python-runtime.json` pins Node 24.15.0 archive hashes for five planned wheel hosts and records the upstream OS/libc requirements. `scripts/prepare-python-node.py` downloads only the exact official archive at build time, validates its SHA-256, and stages the executable with its full license; the installed launcher never downloads Node. Windows x64 download/hash/extraction and `--version` passed locally. Other host launches and all installed-wheel acceptance remain pending. Wheel tags in this manifest are intended targets, not evidence of native dependency compatibility.

The first Windows wheel (`pio-agent-platformio`) was built with pinned setuptools/wheel tooling, installed offline into a fresh Python 3.14 environment, and launched successfully with only that environment's Scripts directory on PATH. The `pio-agent`, `platformio-mcp`, and `pio-mcp` commands exercised version, plugin validation and help. Evidence and artifact hash are in `docs/reviews/python-wheel-windows-evidence.json`. This development artifact uses 3.0.0 and is not approved for publication; complete installed MCP/signal checks and all release gates remain required.

The release workflow now assembles five canonical platform wheels and both aliases as a required preceding job, validates the exact seven-wheel set, and collects those artifacts alongside npm tarballs. `python-release-identity.json` records source commit and SHA-256 hashes. Cross-assembly does not prove that a wheel runs on its target host; target-host acceptance and PyPI publication remain separate unfinished gates.

Python release builders require clean committed source. Use `--allow-dirty` only for local development wheels; their sourceDirty marker makes them ineligible for release validation. Both canonical and alias wheels record the source commit, and builders recheck checkout state after assembly.

Namespace audits now reuse bounded cached observations from the output file, enforce the configured lookup budget, honor capped rate-limit backoff, and record meaningful metadata changes. Scheduled execution/notification remains unwired; cache and backoff never establish ownership or reserve names.

## Maintainer-enabled namespace audit

The Namespace audit workflow can be run manually. Weekly lookups are disabled unless the repository variable `NAMESPACE_AUDIT_ENABLED` is `true`. It restores the prior observation cache, performs bounded read-only lookups, saves the new evidence before reporting changes, and retains an artifact. New third-party/blocked/unknown states, repository or maintainer changes, and same-version integrity changes fail the reporting step for maintainer review. Routine version changes and unchanged observations do not fail it. No package installation, owner contact, claim or publication occurs. Release builds also retain current observations. The schedule has not been enabled or exercised by this work.


### Native Python release gate

The release workflow now requires local-wheel installation on Windows x64, macOS arm64/x64 and Linux arm64/x64 before its artifact/publication job can proceed. Runner labels follow [GitHub's hosted-runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). Each job validates the complete wheel set against the checked-out source, installs the matching canonical wheel and both exact-version aliases without registry fallback, checks all three commands and both alias modules without global Node on PATH, verifies MCP stdio/EOF behavior, and verifies alias removal preserves the canonical command. Evidence records wheel SHA-256 identities, source commit and actual host details.

This gate is implemented but has not yet run. It does not establish minimum-OS compatibility, signal forwarding, hardware behavior, publisher authority or public-registry installation acceptance. Those remain required separate release evidence.


### PyPI publisher configuration

The optional `publish_pypi` release input now stages checksum-validated wheels, publishes canonical wheels before aliases using the pinned PyPA OIDC action with attestations, and checks public filenames and SHA-256 values after upload. Existing different/yanked artifacts or unexpected files fail closed; reruns stage only absent identical-release files. Upload execution is tag/version gated behind release and native installation jobs. This is publication plumbing, not proof of publisher authority or a completed deployment.

On 2026-09-19, the repository API returned no GitHub environments and no `PYPI*` repository variables. Publication remains blocked until a maintainer configures a protected `pypi` environment and trusted/pending publishers for `pio-agent-platformio`, `pio-agent`, and `pio-mcp`, bound to repository `jl-codes/platformio-mcp`, workflow `release.yml`, environment `pypi`. After verifying those bindings, record `PYPI_PUBLISHERS_VERIFIED=pio-agent-platformio,pio-agent,pio-mcp`; this marker is an operator assertion, while PyPI's OIDC exchange enforces actual upload authority. No such marker or environment was created by this change. See [PyPI trusted publisher setup](https://docs.pypi.org/trusted-publishers/adding-a-publisher/) and [attestation production](https://docs.pypi.org/attestations/producing-attestations/). Public-registry installation and independent attestation verification remain separate unfinished gates.


### Official MCP Registry publication

The optional `publish_mcp_registry` input is tag/version gated and waits for release artifacts. Before publishing, it requires all three npm tarballs to match their public SHA-512 identities and requires the artifact's `server.json` to equal the checked-out validated descriptor. Existing conflicting or inactive registry versions are rejected instead of overwritten. New descriptors use GitHub OIDC and official `mcp-publisher` v1.8.1, whose Linux amd64 archive is pinned to SHA-256 `a06c9096dcb9727c13555b6be26c7effa707b01f06a4c561ba7a3635443cf2cc`. The public descriptor is read back after publication and evidence retained.

Configure a protected `mcp-registry` environment and verify the repository namespace binding before setting `MCP_REGISTRY_PUBLISHER_VERIFIED=io.github.jl-codes/platformio-mcp`. Neither configuration nor a live publication has been performed. An environment name in YAML alone does not establish protection or authority. See the [official GitHub Actions publishing guide](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/github-actions.mdx).


### Publication acceptance interlock

All npm/PyPI/MCP publication and tagged GitHub release attachment now require a successful same-commit Actions run with a `platformio-parity-acceptance` artifact containing `manifest.json` and its referenced evidence. `test:parity:acceptance` validates the full checked-in requirement catalog: 40 parity tools, every frozen legacy tool, permissions/host/backend/quality cases, five native host targets and all seven physical acceptance groups. It rejects missing/incomplete entries, wrong source revision, skipped or failed evidence, missing environment/executor/procedure, escaping paths and artifact hash mismatches. A historical passing unit run cannot substitute for this packet.

The checked-in acceptance manifest is an explicitly blocked template, not passing evidence. A final-revision packet must be produced after real execution; the collector and full acceptance evidence are still unfinished. Normal branch artifact builds remain available without asserting release readiness. This mechanical validator checks packet completeness and integrity; reviewers must still verify that recorded procedures and assertions actually demonstrate each requirement.


### Expanded requested alias coverage

The requested families are `platformio-mcp`, `platformio.mcp`, `pio-mcp`, and `pio-agent`. npm already serves 3.0.0 for the three hyphenated names with this repository in public metadata. `platformio.mcp` returned 404 on 2026-09-19, which does not override npm's [punctuation-only collision rule](https://blog.npmjs.org/post/168978377570/new-package-moniker-rules.html). The punctuation variants are recorded as naming-rule blocked, not as available names that have been reserved.

Functional scoped candidate packages are prepared for `@forkbomb/platformio-mcp`, `@forkbomb/platformio.mcp`, `@forkbomb/pio-mcp`, and `@forkbomb/pio-agent`. This scope was already a candidate in the inventory; scope ownership is still unverified. `package:aliases` packs them separately with exact canonical dependencies and no install hooks. They are not added to the authorized npm publish set until control, same-scope similarity eligibility and installation acceptance are verified. A candidate tarball is not a namespace reservation.

PyPI treats `platformio.mcp`, `platformio-mcp`, and `platformio_mcp` as one [normalized project name](https://packaging.python.org/en/latest/specifications/name-normalization/); it currently points to the other project's 0.2.0 release. That name cannot be published by this project without an authorized transfer. `pio-agent`, `pio-mcp`, and `pio-agent-platformio` returned 404; publisher setup and registry approval remain necessary. Other distribution channels remain individually subject to useful packaging, namespace rules and verified publisher authority.


The npm packer, content validator and publication identity planner now share `npm-release-packages.mjs` and the namespace inventory. Adding an eligible alias no longer requires editing a fixed publication list. Existing npm names cannot be accidentally omitted. New aliases require `publicationControlVerified` and `namingEligibilityVerified` before `publishIntent` can activate them; these recorded assertions still require actual operator evidence and registry authentication. Candidate packages remain separate from publication until those conditions are met.
