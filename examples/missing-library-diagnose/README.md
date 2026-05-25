# missing-library-diagnose

This demo intentionally includes a missing header so `agent_build_diagnose` returns `MissingHeader`.

## Run Diagnosis

```bash
npx platformio-mcp agent-build-diagnose --project-dir ./examples/missing-library-diagnose --json
```

## Expected Classification

- `success: false`
- `diagnostic.errorType: "MissingHeader"`
- `diagnostic.recommendedAction` suggests adding/fixing the dependency

## Typical Fix

1. Replace `#include <DefinitelyMissingHeader.h>` with the correct header.
2. Add the corresponding dependency to `lib_deps` if needed.
3. Re-run `agent_build_diagnose`.
