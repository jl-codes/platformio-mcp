---
name: get-started
description: Set up PIO Agent in Codex for a first PlatformIO project inspection. Use when a user has just installed the plugin, asks how to start, or needs help checking local prerequisites. Do not use for flashing or unattended hardware actions.
---

# Get started with PIO Agent

Help the user reach one useful project inspection with the installed plugin.

1. Check that the bundled PIO Agent MCP server responds. If it cannot start, report the launch error and verify that Node.js is available; do not silently replace the packaged runtime with a source checkout.
2. Identify the intended PlatformIO project from the active workspace. If there are several plausible `platformio.ini` files, let the user choose the project before calling project-scoped tools.
3. Call `get_project_context` with the explicit project directory. Summarize declared environments, source and dependency state, build cache, connected devices, and the next useful step. Use `list_devices` only when current device detail is needed.
4. If PlatformIO Core is missing, explain the prerequisite and the existing installation instructions. Do not install packages or toolchains without a user request.
5. Offer a build or dashboard inspection as the next step. A first-run check must not flash, erase, open the browser, or approve hardware operations automatically.

When a native Codex panel is supported, the `platformio-dashboard` skill can open it. Otherwise use the documented browser or headless route and state which surface is available.
