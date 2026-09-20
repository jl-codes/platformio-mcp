# Distribution namespace coverage

The release objective includes all seven requested names: `platformio-mcp`, `pio-mcp`, `platformio.mcp`, `pio-agent`, `platformiomcp`, `pioagent`, and `flashagent`. Evaluate each on every suitable distribution channel. A canonical package alone does not satisfy alias coverage where functional aliases are permitted and project control is verified.

`namespaces.json` is the machine-readable release inventory. A candidate entry or prepared package is not evidence of ownership or publication. Record registry evidence and the exact published version before describing a name as secured.

| Channel | Required disposition |
| --- | --- |
| npm | Publish the canonical package and functional `pio-mcp` / `pio-agent` aliases together. Resolve eligibility of punctuation variants and scoped aliases using registry rules and verified publisher authority. |
| PyPI | Publish the supported runtime and eligible functional aliases. Record normalized-name collisions and third-party ownership explicitly. |
| GHCR | Publish all seven candidate image names under the verified project owner, pointing to the same multi-platform image digest. |
| MCP Registry | Publish the canonical server identity; evaluate alternate names against current registry eligibility and duplicate-listing rules. |
| Plugin distribution | Keep the supported plugin installable and linked to the canonical source; evaluate aliases against marketplace identity rules. |
| Docker Hub | Evaluate all four image names after establishing a controlled publisher namespace and a reproducible image release. |
| Homebrew, winget, Chocolatey | Evaluate supported installer/formula names and aliases against each channel's rules; ship working installation and removal behavior. |
| VS Code Marketplace, Open VSX | Evaluate only with a functional extension distribution; package-name reservations alone are not delivery. |
| Domains | Track separately from package distribution. Domain purchase requires an explicit domain and spending authorization. |

For every channel/name pair, the final release accounting must identify one of: published and verified; equivalent to a controlled name under registry normalization; blocked by naming rules; held by another publisher; blocked by missing publisher access; or unsuitable with a concrete reason. Do not silently omit a requested name or count a candidate as deployed.

Functional aliases must install the same release, preserve existing commands and permissions, identify the canonical repository, and receive future release updates. Container aliases must resolve to the same digest. Registry acceptance and artifact identity checks should be focused; do not repeat unrelated runtime smoke tests for namespace-only changes.

This coverage reduces impersonation opportunities. No finite alias list can guarantee that all possible confusing names on all services are unavailable to other publishers.

The additional `platformiomcp` and `pioagent` spellings already have npm punctuation-collision entries. Their PyPI spellings are distinct from hyphenated names and require separate evaluation. `flashagent` has a functional npm candidate package; all three additional Python aliases remain packaging candidates.

When changing the canonical npm version, run `npm run aliases:sync` to update every functional alias, including candidates, then `npm run aliases:check`. This changes version pins only and does not enable publication. Python alias versions derive directly from the canonical manifest during wheel assembly.

Additional spelling coverage now includes the `flash-agent`, `flash.agent`, and `flash_agent` family. PyPI has a functional `flash-agent` candidate (the dotted/underscored forms normalize to it), separate from `flashagent`. npm has a functional `@forkbomb/flashagent` candidate; punctuation-only siblings remain eligibility checks rather than duplicate publication promises. Functional `@forkbomb/platformiomcp` and `@forkbomb/pioagent` candidates are also prepared; registry naming eligibility remains unverified.

The container inventory now contains ten candidate image names. Publication requires the original seven targets and includes every additional valid project-owned inventory entry; no extra entry can bypass the existing verified-authority requirements. Current packaging sources cover ten npm aliases plus the canonical npm package, and six Python aliases plus the canonical Python runtime. These counts describe prepared source packages, not published namespace ownership.

Run `npm run namespace:coverage` after refreshing registry observations to regenerate `docs/reviews/platformio-namespace-coverage.json`. It covers every explicitly requested name across the supported and evaluated channels, including missing implementations, normalized-name collisions and scoped alternatives. It never treats prepared artifacts or public repository links as secured namespace ownership. Additional channels remain visible even when no installer or publisher exists yet.

The shared runtime contains `capabilities.json`, generated from
`distribution/capabilities.json` and included in its checksum inventory. It lists
optional backend dependencies, explicit installation steps, and implementation
limits. It is a declaration, not an installed-dependency probe or a hardware
acceptance certificate. npm ships the plugin runtime; Python staging copies the
same runtime, and containers install those wheels.
