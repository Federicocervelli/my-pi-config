# On-demand capability router

Keep optional capability instructions out of normal context. Only when the task matches, read the exact archived skill below before acting; otherwise do not read any of them.

- Cloudflare platform/Workers/Pages: `~/.pi/agent/skills-disabled/cloudflare/SKILL.md`
- Cloudflare Agents SDK: `~/.pi/agent/skills-disabled/agents-sdk/SKILL.md`
- Durable Objects: `~/.pi/agent/skills-disabled/durable-objects/SKILL.md`
- Workers implementation/review: `~/.pi/agent/skills-disabled/workers-best-practices/SKILL.md`
- Wrangler CLI: `~/.pi/agent/skills-disabled/wrangler/SKILL.md`
- Cloudflare email, Zero Trust, migrations, Turnstile, or sandbox: read the matching directory under `~/.pi/agent/skills-disabled/`.
- React/Next.js performance: `~/.pi/agent/skills-disabled/vercel-react-best-practices/SKILL.md`
- Web performance/Core Web Vitals: `~/.pi/agent/skills-disabled/web-perf/SKILL.md`
- Live browser automation: tell the user the browser extension is disabled and ask them to restart Pi with `pi -e npm:pi-agent-browser-native`.
- Coding tasks where a minimal, dependency-free, or YAGNI-first approach is useful: read and apply `~/.pi/agent/skills/ponytail/SKILL.md`. Use it selectively for coding work, especially when the user asks for a simple, minimal, lazy, or non-overengineered solution; do not use it for non-coding requests.
