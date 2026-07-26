# Goal mode

Codex-style long-running goals for Pi.

```text
/goal Refactor the auth module and keep tests green --max-turns 20 --tokens 50k
/quality
/goal status
/goal prompt
/goal quality
/goal pause
/goal resume
/goal clear
```

The extension persists goal state in the Pi session, keeps the main chat active throughout the goal, automatically continues after settled turns, and runs an independent review subagent between turns. It pauses on user input, budget exhaustion, repeated no-progress turns, or an explicit blocker.

`/quality` starts a reusable 12-turn, 30k-token goal focused on simplifying the current codebase. The main agent must call `goal_complete` with concrete evidence or `goal_blocked` with a real blocker. `/goal quality` remains available as an optional editing pass focused on simplification, duplication, unnecessary abstractions, and standard-library reuse. Subagents use the local `subagents` manager and are cancelled when the goal is paused or cleared.
