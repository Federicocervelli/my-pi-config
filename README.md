# My Pi config

My personal, opinionated configuration for [Pi](https://github.com/badlogic/pi-mono). This repository contains settings, skills, themes, and mutable local configuration. Extensions are maintained as independent public Git-based Pi packages.

## Install

```bash
git clone https://github.com/Federicocervelli/my-pi-config.git ~/.pi/agent
pi update --extensions
```

Pi reads the package sources from `settings.json`, clones missing packages, and installs their runtime dependencies automatically.

## Extensions

- [pi-ask-user](https://github.com/Federicocervelli/pi-ask-user)
- [pi-background-terminals](https://github.com/Federicocervelli/pi-background-terminals)
- [pi-codex-fast](https://github.com/Federicocervelli/pi-codex-fast)
- [pi-codex-usage](https://github.com/Federicocervelli/pi-codex-usage)
- [pi-dictate](https://github.com/Federicocervelli/pi-dictate)
- [pi-file-search](https://github.com/Federicocervelli/pi-file-search)
- [pi-git-info](https://github.com/Federicocervelli/pi-git-info)
- [pi-goal](https://github.com/Federicocervelli/pi-goal)
- [pi-idle-notify](https://github.com/Federicocervelli/pi-idle-notify)
- [pi-model-info](https://github.com/Federicocervelli/pi-model-info)
- [pi-subagents](https://github.com/Federicocervelli/pi-subagents)
- [pi-ui-customization](https://github.com/Federicocervelli/pi-ui-customization)
- [pi-workflows](https://github.com/Federicocervelli/pi-workflows)

Install one independently with:

```bash
pi install git:github.com/Federicocervelli/pi-ask-user
```
