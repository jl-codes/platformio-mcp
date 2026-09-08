#!/usr/bin/env node
/**
 * pio-agent — product-name binary that delegates entirely to platformio-mcp.
 *
 * The canonical CLI inspects process.argv directly, so importing its entrypoint
 * forwards every command and option without maintaining a second implementation.
 */
import("platformio-mcp/build/cli.js");
