# PlatformIO compatibility guide

### Build and cleanup options

The canonical build_project tool accepts optional jobs (integer 1–1024) and forceExecution (boolean). The latter bypasses cached-result replay without enabling verbose logs. CLI equivalents are --jobs and --force-execution on the build command. The canonical clean_project tool accepts optional environment and full; full requests PlatformIO fullclean, including downloaded dependencies. Both options are included in the authorized request. Omitting these fields preserves previous behavior. The dashboard launcher exposes parallel build jobs, cleanup environment selection, and an explicit option to remove downloaded dependencies. Dashboard builds already run as background tasks and therefore execute without cached-result replay.

