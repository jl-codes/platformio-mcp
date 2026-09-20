# Container distribution candidate

This image runs the full canonical CLI/MCP launcher from the validated Linux Python wheel, including its pinned Node runtime, plus PlatformIO Core 6.1.16. It runs as UID/GID 10001 and does not request privileged access, expose ports, mount a Docker socket or start a browser. The canonical image and functional repository aliases are intended to share one digest:

- `ghcr.io/jl-codes/platformio-mcp`
- `ghcr.io/jl-codes/platformio.mcp`
- `ghcr.io/jl-codes/pio-mcp`
- `ghcr.io/jl-codes/pio-agent`
- `ghcr.io/jl-codes/platformiomcp`
- `ghcr.io/jl-codes/pioagent`
- `ghcr.io/jl-codes/flashagent`

These are candidates, not published installation commands. Registry authority, naming eligibility, image execution, native serial bindings and digest equality still require evidence. PlatformIO Core and its 21 transitive dependencies are pinned with SHA-256 hashes in `requirements.txt`, resolved for Python 3.11 on both Linux architectures. The finished image digest must still be retained and verified.

Build context preparation uses `npm run package:container -- <validated-wheel-directory> <new-context-directory>`. Build that context with Docker, supplying `VERSION` from package.json and `SOURCE_COMMIT` from its recorded identity. The intended architectures are Linux amd64 and arm64; build and run each on its native host before publishing a combined manifest.

For MCP, attach stdin without allocating a terminal (`-i`, not `-t`), mount the intended project at `/workspace`, and provide the same explicit policy/configuration used by the native package. Build outputs require writable project permissions. Persist only deliberately chosen state/cache directories. Do not bake host configuration, credentials, projects or device data into an image.

Physical USB access requires an explicitly mapped Linux device and appropriate group permissions. Windows/macOS container engines do not automatically expose host serial devices; remote device access or a native installation is required there. A successful container build is not hardware acceptance. No `--privileged` workaround is implied.

Regenerate the dependency lock using uv 0.10.12: `uv pip compile distribution/container/requirements.in --python-version 3.11 --python-platform linux --generate-hashes --output-file distribution/container/requirements.txt --no-header`. Resolve again for `aarch64-unknown-linux-gnu` and compare before accepting an update. Binary wheels are required during image installation.

The release workflow offers `publish_ghcr`, disabled by default. It requires the exact version tag, complete same-commit acceptance, verified inventory flags (`publishIntent`, `publicationControlVerified`, `namingEligibilityVerified`) for every GHCR target, and the protected `ghcr` environment. Configure `GHCR_PUBLISHERS_VERIFIED` as the comma-separated target list in the order emitted by `validate-container-release.py`. The marker records operator verification; it does not itself establish ownership or configure environment protection.

The publisher loads and validates both native archives, checks every existing version/architecture tag before publishing, and never intentionally replaces a conflicting version index. It pushes architecture images and one byte-identical multi-platform index to all seven names. The workflow serializes its own publication jobs; registry administrators must avoid concurrent external writers because registry tags do not provide a compare-and-swap guarantee. It publishes version tags only. A partial failure retains per-alias evidence for inspection and retry.

New GHCR packages may initially be private. Configure public visibility for each controlled package; anonymous manifest and child reads must pass before publication evidence says public. Repository token credentials are supplied through the protected workflow and Docker stdin, never packaged into the images. Registry-pulled execution and hardware acceptance are separate requirements.
