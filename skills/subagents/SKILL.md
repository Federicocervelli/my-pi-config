---
name: subagents
description: invoke this skill when the user asks you to use subagents
---

# Subagents

Each subagent is headless, has its own context window, cannot see the parent conversation, cannot ask the user, and cannot spawn subagents or workflows. Give every child a self-contained prompt with paths, constraints, and the expected report.

## Pi Harness

**Harness:** `pi`
**Prompt nicknames:** “pi”, “pi agent”, “pi subagent”
**Best default:** Use when the user does not request another harness. Route work by difficulty:

- **Planning:** use `openai-codex/gpt-5.6-sol` only for the hardest planning and architectural decisions. Sol is not an execution model.
- **Quite hard execution/review:** use `openai-codex/gpt-5.6-terra`.
- **Quick/easy execution or reconnaissance:** use `openai-codex/gpt-5.6-luna`.

Do not use models from the Anthropic provider even if one appears in the model list.

Pi can use any model shown by `pi --list-models`. Prefer `provider/model-id`; a bare model id only works when unambiguous. Common picks in this environment:

| Model                            | Recommended effort |
| -------------------------------- | ------------------ |
| inherited parent model (default) | inherited          |
| `openai-codex/gpt-5.6-sol`       | `high` — planning only |
| `openai-codex/gpt-5.6-terra`     | `high` — harder execution |
| `openai-codex/gpt-5.6-luna`      | `medium` — quick/easy work |

**Thinking budgets:** `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. These map directly to pi thinking levels.

## Spawn and Manage

Use the `pi` harness for every subagent. Sol is planning-only; Terra handles harder execution/review; Luna handles quick/easy work.

Call `subagent_spawn` with a complete `prompt`, short `name`, chosen `harness`, and optional `working_dir`, `model`, and `reasoning_effort`. At most four subagents run concurrently.

- `subagent_check({ id })`: peek without blocking.
- `subagent_list()`: list all runs.
- `subagent_wait({ ids })`: block only when results are required to proceed.
- `subagent_cancel({ ids })`: stop runs while preserving partial transcripts.
- `/sa`: inspect or take over a run interactively.

Results return automatically. After spawning, continue useful parent work instead of immediately waiting.
