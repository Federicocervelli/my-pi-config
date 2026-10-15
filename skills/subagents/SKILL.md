---
name: subagents
description: invoke this skill when the user asks you to use subagents
---

# Subagents

Subagents come from the `pi-subagents` package; its own `pi-subagents` skill documents the `subagent` tool. Each child is headless with its own context window and cannot see the parent conversation, so give every child a self-contained task with paths, constraints, and the expected report.

## Models

Models are pinned per agent in `settings.json` (`subagents.agentOverrides`), so normally pass no `model`:

| Agent                                               | Model                              | Thinking |
| --------------------------------------------------- | ---------------------------------- | -------- |
| `scout`                                             | `claude-bridge/claude-haiku-5-5`   | low      |
| `researcher`, `worker`, `delegate`, any other agent | `claude-bridge/claude-sonnet-5-5`  | medium   |
| `evidence-auditor`                                  | `claude-bridge/claude-sonnet-5-5`  | high     |
| `reviewer`                                          | `claude-bridge/claude-opus-5-5`    | medium   |
| `oracle`                                            | `claude-bridge/claude-opus-5-5`    | high     |

Only Opus 5.5, Sonnet 5.5, and Haiku 5.5 via `claude-bridge` are allowed (`subagents.modelScope`, strict). Never use Fable for subagents. Per-run overrides must stay within those three.
