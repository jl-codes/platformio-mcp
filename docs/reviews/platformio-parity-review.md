# Implementation plan review — 2026-09-19

Reviewed [the implementation plan](../platformio-parity-implementation-plan.md) against local source, live public package metadata, the current pinned reference registry and official PlatformIO, packaging, MCP Registry and GDB documentation. Independent reviews covered technical correctness and goal actionability. Findings below are corrected in the plan; they are not claims that implementation fixes have shipped.

| Priority | Finding | Correction |
| --- | --- | --- |
| P1 | The 29-tool baseline was stale; the reference now registers 40 tools. | Pinned reference SHA `a7b31021982f20b5406eaf80732899f8e75bd464`; added all eleven missing tools and a [40-entry source inventory](platformio-parity-baseline.json). |
| P1 | Namespace collision was not addressed. PyPI punctuation variants are the same project, and the existing name is occupied. | Added registry-specific normalization, authentic install commands, supported identities, functional aliases, provenance, an ownership inventory and bounded monitoring. |
| P1 | Authentication was conflated with human approval in the older local API: an MCP-accessible dashboard credential can reach approval routes. | Required separate approval-grant authority, an end-to-end self-approval negative test and an explicit same-user trust limitation. Reconcile with upstream fixes before implementation. |
| P1 | Artifact hashes alone do not establish ELF correspondence or survive later rebuilds. | Required immutable build/upload manifests, image offsets, retained ELF/images, lock/authorization ordering and race tests. |
| P1 | Build-only testing could still open/reset hardware, and builds execute project scripts. | Defined native, compile-only and hardware-test effects; compile-only disables uploading and testing; documented the trusted-code boundary. |
| P1 | Newly added debugger, flash-read and power features introduce effects outside ordinary build/upload. | Added GDB auto-load/function-call controls, probe ownership, reset/read policy, OTA target binding, protected dumps and PPK2 voltage/power/cleanup requirements. |
| P2 | Regex translation and cross-process serial ownership were insufficiently specified. | Preserved literal legacy matching, specified a bounded regex dialect/worker, and required a shared device-lock root and caller authority. |
| P2 | Packaging and acceptance depended on unspecified platforms, hosts and hardware. | Added an S0 support/prerequisite manifest, wheel proof, exact runner/ABI requirements, named executor roles and explicit blocked states. |
| P2 | Goal completion mixed implementation, acceptance and publication, with a contradictory S1 exit gate. | Separated the three completion states, corrected stage dependencies, fixed source scope, and defined executable requirement/evidence records. |

## Namespace result

Public npm metadata links `platformio-mcp`, `pio-agent` and `pio-mcp` version `3.0.0` to this project's repository and lists `forkbomb` as maintainer. That is useful observed evidence, not authenticated proof that the current operator can administer those packages. PyPI `platformio.mcp` version `0.2.0` links to the other repository. Candidate Python distribution lookups returned 404; this does not establish availability or registration control. See [saved registry observations](platformio-namespace-observations.json).

The revised plan does not promise universal name ownership. It requires controlled supported identities, functional aliases where registries permit them, verified release provenance, unmistakable installer commands and detection of meaningful lookalike changes. Existing third-party names remain documented exclusions. No packages were installed, reserved or published, and no live monitoring automation was created by this review.

## Verification of this revision

- Source inventory contains 40 unique registered tool names and 40 unique requirement IDs, extracted using Python AST inspection without executing the reference code.
- All 40 reference names appear in the plan; no stale 29-tool completion gates remain.
- Required house-style sections and the goal/prerequisite contract are present.
- JSON evidence files parse and the plan has no trailing whitespace.
- Existing unrelated working-tree changes were preserved.

Implementation tests, actual host approval behavior, hardware acceptance, optional backend installation, publication authority and registry provenance remain implementation/release evidence to collect. The plan is ready to guide a bounded implementation goal; full acceptance still depends on the explicitly listed resources and gates.
