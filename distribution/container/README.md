# Container distribution candidate

This image runs the full canonical CLI/MCP launcher from the validated Linux Python wheel, including its pinned Node runtime, plus PlatformIO Core 6.1.16. It runs as UID/GID 10001 and does not request privileged access, expose ports, mount a Docker socket or start a browser. The canonical image and functional repository aliases are intended to share one digest:

- `ghcr.io/jl-codes/platformio-mcp`
- `ghcr.io/jl-codes/platformio.mcp`
- `ghcr.io/jl-codes/pio-mcp`
- `ghcr.io/jl-codes/pio-agent`

These are candidates, not published installation commands. Registry authority, naming eligibility, image execution, native serial bindings and digest equality still require evidence. Python dependency resolution for PlatformIO Core is not yet fully locked; the finished image digest must be retained and verified, and dependency locking remains a release gate.

Build context preparation uses `npm run package:container -- <validated-wheel-directory> <new-context-directory>`. Build that context with Docker, supplying `VERSION` from package.json and `SOURCE_COMMIT` from its recorded identity. The intended architectures are Linux amd64 and arm64; build and run each on its native host before publishing a combined manifest.

For MCP, attach stdin without allocating a terminal (`-i`, not `-t`), mount the intended project at `/workspace`, and provide the same explicit policy/configuration used by the native package. Build outputs require writable project permissions. Persist only deliberately chosen state/cache directories. Do not bake host configuration, credentials, projects or device data into an image.

Physical USB access requires an explicitly mapped Linux device and appropriate group permissions. Windows/macOS container engines do not automatically expose host serial devices; remote device access or a native installation is required there. A successful container build is not hardware acceptance. No `--privileged` workaround is implied.
