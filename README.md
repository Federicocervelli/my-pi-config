# Pi agent configuration

Public configuration, extensions, themes, and skills for [Pi](https://github.com/badlogic/pi-mono).

This repository is the contents of `~/.pi/agent`. It intentionally contains configuration and source only; credentials, sessions, trust decisions, and installed packages stay local and are ignored.

## Install

Back up an existing agent directory, then clone this repository as `~/.pi/agent`:

```bash
mv ~/.pi/agent ~/.pi/agent.backup 2>/dev/null || true
git clone https://github.com/Federicocervelli/pi-agent.git ~/.pi/agent
cd ~/.pi/agent
npm install
```

Restore `auth.json` from your local backup if needed. Pi credentials must never be committed.

## Development

The root dependencies and extension dependencies are installed separately:

```bash
npm install
for dir in extensions/*; do
  [ -f "$dir/package.json" ] && npm --prefix "$dir" install
done
```

Each extension package provides its own `test`, `check`, and formatting scripts where applicable. The configuration is intentionally opinionated; adjust `settings.json` and remove extensions or skills you do not need.
