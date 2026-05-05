#!/usr/bin/env node
/**
 * pio-mcp — short alias binary that delegates entirely to platformio-mcp.
 *
 * The CLI router inside platformio-mcp inspects process.argv directly, so a
 * simple dynamic import is enough to forward every argument unchanged.
 */
import("platformio-mcp");
