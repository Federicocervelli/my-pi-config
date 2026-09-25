# My Pi config

My personal Pi configuration baseline. This repository keeps the settings, model definitions, extensions, and skills used by my Pi agent in one place.

## Install

Clone this repository to `~/.pi/agent` (back up any existing directory first), then install runtime dependencies for extensions that need them. Do not copy local credentials or session data into this repository.

## Contents

- `settings.json` — current Pi settings and enabled models
- `models.json` — custom model definitions
- `extensions/` — local extensions and extension configuration, including RTK's Pi hook
- `skills/` — personal and project skills

RTK command rewriting requires the `rtk` binary on `PATH`. Install RTK, then run `rtk init --agent pi --global` to install its global Pi hook. The hook fails open if RTK is unavailable. The `npm:pi-goal-x` package remains configured in `settings.json`; Pi installs it separately. Runtime state, credentials, sessions, and `node_modules` are intentionally excluded.
