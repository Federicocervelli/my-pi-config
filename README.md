# My Pi config

My personal Pi configuration baseline. This repository keeps the settings, model definitions, extensions, and skills used by my Pi agent in one place.

## Install

Clone this repository to `~/.pi/agent` (back up any existing directory first), then install runtime dependencies for extensions that need them. Do not copy local credentials or session data into this repository.

## Contents

- `settings.json` — current Pi settings and enabled models
- `models.json` — custom model definitions
- `extensions/` — local extensions and extension configuration
- `skills/` — personal and project skills

The `npm:pi-goal-x` package remains configured in `settings.json`; it is installed by Pi separately. Runtime state, credentials, sessions, and `node_modules` are intentionally excluded.
