---
name: background-terminals
description: Run and manage long-lived shell commands in background terminals. Use for dev servers, watchers, streaming builds, and other commands that should keep running while the agent continues working.
---

# Background Terminals

Use `bg_run` for long-running commands; use regular `bash` for quick commands. User-launched commands can also use `/bg`.

## Start

Call `bg_run` with:

- `name`: short recognizable label
- `command`: shell command to run
- `isAgent`: `false` for ordinary shell work
- `timeoutSeconds`: optional hard runtime limit

Background commands receive no stdin. Never use them for interactive prompts. Shell jobs are not sandboxed and run with Pi's local permissions, environment, credentials, and network access.

After starting, continue useful work instead of polling. Tool-launched jobs notify Pi and can wake a follow-up turn when they exit.

## Inspect and stop

- Use `bg_status` only when current status is needed.
- Use `bg_logs` for bounded output; `/logs` is the interactive command.
- Use `bg_kill` when a process is no longer needed or is stuck.
- Use `/jobs` to inspect the task dock and `/kill` to stop tasks interactively.

Prefer meaningful names and avoid duplicate servers or watchers. Output is captured under `.pi/tasks`; completion messages show bounded output. Tasks are killed during Pi shutdown or reload, while their metadata and artifacts remain available.
