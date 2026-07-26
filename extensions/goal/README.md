# Goal mode

Codex-style long-running goals for Pi.

```text
/goal Refactor the auth module and keep tests green --max-turns 20 --tokens 50k
/skill:quality
/goal status
/goal prompt
/goal quality
/goal pause
/goal resume
/goal clear
```

The extension persists goal state in the Pi session, keeps the main chat active throughout the goal, automatically continues after settled turns, and runs an independent review subagent between turns. It pauses on user input, budget exhaustion, repeated no-progress turns, or an explicit blocker.

`/skill:quality` runs a focused editing pass for simplification, duplication, unnecessary abstractions, and standard-library reuse. `/goal quality` remains available as an optional quality pass inside an active long-running goal. Subagents use the local `subagents` manager and are cancelled when the goal is paused or cleared.
