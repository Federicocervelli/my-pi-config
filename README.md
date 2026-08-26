# My Pi config

My personal, opinionated configuration for [Pi](https://github.com/badlogic/pi-mono). This repository contains settings, skills, themes, and mutable local configuration. Extensions are installed from their public Git or npm package sources listed in `settings.json`.

## Install

```bash
git clone https://github.com/Federicocervelli/my-pi-config.git ~/.pi/agent
pi update --extensions
```

Pi reads the package sources from `settings.json`, installs missing packages, and installs their runtime dependencies automatically.

## Extensions

- [pi-ask-user](https://github.com/Federicocervelli/pi-ask-user)
- [pi-background-tasks](https://github.com/ismailsaleekh/pi-background-tasks)
- [pi-codex-fast](https://github.com/Federicocervelli/pi-codex-fast)
- [pi-codex-usage](https://github.com/Federicocervelli/pi-codex-usage)
- [pi-dictate](https://github.com/Federicocervelli/pi-dictate)
- [pi-file-search](https://github.com/Federicocervelli/pi-file-search)
- [pi-git-info](https://github.com/Federicocervelli/pi-git-info)
- [pi-goal](https://github.com/Federicocervelli/pi-goal)
- [pi-idle-notify](https://github.com/Federicocervelli/pi-idle-notify)
- [pi-model-info](https://github.com/Federicocervelli/pi-model-info)
- [pi-subagents](https://github.com/nicobailon/pi-subagents)
- [pi-ui-customization](https://github.com/Federicocervelli/pi-ui-customization)

Install one independently with:

```bash
pi install npm:pi-subagents@0.57.0
```

## Theme

The active theme is published separately as [pi-theme-github-dark-default](https://github.com/Federicocervelli/pi-theme-github-dark-default) and installed from `settings.json` like the extension packages.
