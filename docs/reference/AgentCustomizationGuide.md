# Agent Customization Guide

[← Back to README](../../README.md)

## Usage with AI Agents

### Antigravity
Antigravity will automatically use the MCP interface when running in the workspace. Simply execute `npm run dev` to bring the server online. By default, the Web Dashboard is securely opt-in. Pass `--open-dashboard-on-start` or set `PIO_MCP_OPEN_DASH_ON_START=true` if you wish to launch the REST/WebSocket layer, which will produce a secure localhost token at boot. Let the agent manage the rest.

### Cline
Cline accesses the server seamlessly through its standard MCP integration. Instruct Cline to "Build my PlatformIO project" or "Flash the connected device," and it will correctly orchestrate the tasks through the exposed MCP tools.

### Claude Code
Claude Code detects the server once configured via the CLI or settings file. You can directly ask Claude Code to list available development boards, query the library registry, or compile the active workspace.

## Antigravity Customization

Antigravity natively utilizes Advanced Agentic constructs that integrate perfectly with PlatformIO development lifecycles via the repository's `.agents/` directory.

### Invariant Rules
Antigravity enforces strict repository invariants by automatically reading Markdown files located in `.agents/rules/` upon session start. Use these to securely mandate hardware lock acquisition before flashing, or define C++ formatting guidelines.

### Workflows
Antigravity Workflows are step-by-step Markdown guides placed in `.agents/workflows/`. You can invoke them via slash commands. For example, a custom `/flash-test` workflow can orchestrate building the binary, deploying the filesystem, and natively interfacing with the background serial monitor.

### Skills
Antigravity's `skills/` directory is properly framed as the absolute source of truth for empowering AI agents. For example, a dedicated `pio-manager` skill serves as the single source of truth for all embedded operations, securely managing complex edgecases like macOS USB re-enumeration races and concurrent serial lock contention.

## Cline Customization

Cline has several customization features that work well with PlatformIO projects.

### Rules
[Cline Rules](https://docs.cline.bot/customization/cline-rules) let you set persistent instructions that apply to every task. Use them to tell Cline about your project conventions, preferred board targets, or coding standards for embedded C/C++. Rules can be global or project-scoped via `.clinerules`.

### Workflows
[Cline Workflows](https://docs.cline.bot/customization/workflows) are Markdown files that define multi-step processes. Place them in `.clinerules/workflows/` and invoke them with `/` in the chat input.

Example (`build-upload-monitor.md`):
```markdown
# Build, Upload, Monitor

1. Build the PlatformIO project in the current directory
2. If the build succeeds, upload the firmware to the connected device
3. Provide the serial monitor command so I can observe the output
```

### Skills
[Cline Skills](https://docs.cline.bot/customization/skills) are modular instruction sets that load on demand. They package development expertise into a `SKILL.md` with optional bundled docs and templates. Skills live in `.cline/skills/` (project) or `~/.cline/skills/` (global).

### Hooks
[Cline Hooks](https://docs.cline.bot/customization/hooks) are executable scripts that run at key moments in the task lifecycle (task start, before/after tool use, etc.). Use them for validation and guardrails:
- Ensure a successful build exists before allowing firmware upload
- Run static analysis or binary size checks after compilation
- Inject board configuration and project state at task start

### Kanban
For multi-component firmware projects, use the Kanban to break work into tasks and track progress across boards, features, and integration milestones. Useful when a project spans firmware, filesystem uploads, library integration, and hardware bring-up.
