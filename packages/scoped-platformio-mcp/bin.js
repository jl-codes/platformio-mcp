#!/usr/bin/env node
/** Delegate all arguments, stdio, signals and exit status to the exact canonical runtime in this process. */
import("platformio-mcp/build/cli.js");
