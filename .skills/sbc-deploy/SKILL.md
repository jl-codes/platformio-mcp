---
name: sbc-deploy
description: Deploy and validate services on single-board computers such as Raspberry Pi, Jetson, Orange Pi, BeagleBone, and Coral. Use when checking SSH connectivity, runtime dependencies, logs, service health, Docker workloads, or systemd deployment.
---

# SBC Deploy

## Purpose

Use this skill when working with single-board computers such as Raspberry Pi, Jetson, Orange Pi, BeagleBone, or Coral Dev Board.

## Safety Rules

- Do not run destructive shell commands.
- Ask before installing services, changing boot behavior, or modifying system packages.
- Do not expose secrets in logs.
- Prefer dry-run commands first.
- Preserve deployment logs.

## Workflow

1. Identify target host.
2. Check SSH connectivity.
3. Inspect OS, architecture, Python, Docker, and required runtime.
4. Copy or pull project code.
5. Install dependencies with approval if needed.
6. Run service manually first.
7. Inspect logs.
8. Verify health check or expected output.
9. Ask before installing persistent systemd service.
10. Summarize deployment status.

## Preferred Commands

```bash
ssh target "uname -a"
ssh target "python3 --version"
ssh target "docker --version"
ssh target "systemctl status service-name"
ssh target "journalctl -u service-name -n 100 --no-pager"
```
