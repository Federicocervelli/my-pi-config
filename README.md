# My Pi config

My personal, opinionated configuration for [Pi](https://github.com/badlogic/pi-mono). This repository is the contents of `~/.pi/agent`; it is not intended as a neutral default setup.

Credentials, sessions, trust decisions, and installed packages stay local and are ignored.

## Install

```bash
git clone https://github.com/Federicocervelli/my-pi-config.git ~/.pi/agent
cd ~/.pi/agent
npm install
for dir in extensions/*; do
  [ -f "$dir/package.json" ] && npm --prefix "$dir" install
done
```

Adjust `settings.json`, extensions, and skills to suit your machine.

## Extensions

- **ask-user** — asks the user a multiple-choice question.
- **background-terminals** — runs and monitors long-lived shell commands.
- **codex-fast** — toggles priority service tier for supported Codex models.
- **codex-usage** — displays remaining Codex quota.
- **dictate** — offline WhisperX voice dictation.
- **file-search** — provides safe `fd` and `rg` search tools.
- **git-info** — shows repository status and changed-file information.
- **goal** — runs bounded planner → implementation → review goals.
- **idle-notify** — sends desktop notifications when Pi settles.
- **model-info** — displays model, token, timing, and cost information.
- **subagents** — runs and manages parallel Pi, Claude, and Codex subagents.
- **ui-customization** — provides the custom footer and dashboard styling.
- **workflows** — runs model-authored multi-agent orchestration workflows.
