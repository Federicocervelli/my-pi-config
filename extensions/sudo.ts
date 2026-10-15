// Session-scoped sudo for the agent.
//
// When a bash tool call mentions `sudo` and the session isn't elevated yet, the
// user gets a masked password prompt. The password is verified, kept in memory
// only, and handed to sudo through SUDO_ASKPASS for the rest of the session.
// `/sudo` elevates on demand, `/sudo off` drops it.
//
// Plumbing: bash commands get a `sudo` wrapper (`sudo -A`) prepended to PATH.
// The askpass helper reads the password from a unix socket in a 0700 runtime
// dir; the socket only answers while an agent bash call is in flight.

import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BashToolCallEvent,
  ExtensionAPI,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import {
  decodeKittyPrintable,
  Key,
  matchesKey,
  truncateToWidth,
} from "@earendil-works/pi-tui";

const SUDO = "/usr/bin/sudo";
const MAX_ATTEMPTS = 2;
const MENTIONS_SUDO = /(^|[\s;&|(`$])sudo(\s|$)/m;

function isBashToolCallEvent(event: ToolCallEvent): event is BashToolCallEvent {
  return event.toolName === "bash";
}

// Resolves true if sudo accepts the password. -k ignores and doesn't update
// sudo's own credential cache, so verifying leaves no timestamp behind.
function verifyPassword(password: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(SUDO, ["-k", "-S", "-p", "", "true"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
    child.stdin.end(password + "\n");
  });
}

function promptPassword(
  ctx: any,
  title: string,
  detail?: string,
): Promise<string | null> {
  return ctx.ui.custom(
    (tui: any, theme: any, _kb: any, done: (v: string | null) => void) => {
      let value = "";
      let error = "";
      let attempts = 0;
      let checking = false;

      const refresh = () => tui.requestRender();

      async function submit() {
        if (!value || checking) return;
        checking = true;
        error = "";
        refresh();
        const candidate = value;
        if (await verifyPassword(candidate)) return done(candidate);
        checking = false;
        value = "";
        attempts++;
        if (attempts >= MAX_ATTEMPTS) return done(null);
        error = `Wrong password (${MAX_ATTEMPTS - attempts} left)`;
        refresh();
      }

      function handleInput(data: string) {
        if (checking) return;
        if (matchesKey(data, Key.escape)) return done(null);
        if (matchesKey(data, Key.enter)) return void submit();
        if (matchesKey(data, Key.backspace)) value = value.slice(0, -1);
        else if (matchesKey(data, "ctrl+u")) value = "";
        else {
          const ch = decodeKittyPrintable(data);
          // Fall back to raw text so pasted passwords work too.
          const text = ch ?? data.replace(/\x1b\[20[01]~/g, "");
          if (!/^[^\x00-\x1f\x7f]+$/.test(text)) return;
          value += text;
        }
        refresh();
      }

      function render(width: number): string[] {
        const add = (s: string) => truncateToWidth(s, width);
        const lines = [
          add(theme.fg("warning", "─".repeat(width))),
          add(theme.fg("text", ` 🔐 ${title}`)),
        ];
        if (detail)
          for (const l of detail.split("\n").slice(0, 6))
            lines.push(add(theme.fg("muted", `   ${l}`)));
        lines.push("");
        lines.push(
          add(
            ` Password: ${"•".repeat(value.length)}${checking ? "" : theme.fg("accent", "▏")}`,
          ),
        );
        if (checking) lines.push(add(theme.fg("dim", " Checking…")));
        if (error) lines.push(add(theme.fg("error", ` ${error}`)));
        lines.push("");
        lines.push(
          add(
            theme.fg(
              "dim",
              " Enter elevate • Esc skip • sudo stays unlocked for this session",
            ),
          ),
        );
        lines.push(add(theme.fg("warning", "─".repeat(width))));
        return lines;
      }

      return { render, invalidate: () => {}, handleInput };
    },
  );
}

export default function (pi: ExtensionAPI) {
  let password: string | null = null;
  // Agent bash calls currently allowed to read the password.
  const inflight = new Set<string>();
  let pending: Promise<boolean> | null = null;
  let dir: string | null = null;
  let server: Server | null = null;

  function setup() {
    if (dir) return dir;
    dir = mkdtempSync(
      join(process.env.XDG_RUNTIME_DIR || tmpdir(), "pi-sudo-"),
    );
    chmodSync(dir, 0o700);
    const sock = join(dir, "sock");
    server = createServer((s) =>
      s.end(password && inflight.size > 0 ? password + "\n" : ""),
    );
    server.listen(sock);

    writeFileSync(
      join(dir, "askpass"),
      `#!/usr/bin/env node\nconst s=require("net").connect(${JSON.stringify(sock)});s.pipe(process.stdout);s.on("error",()=>process.exit(1))\n`,
      { mode: 0o700 },
    );
    writeFileSync(join(dir, "sudo"), `#!/bin/sh\nexec ${SUDO} -A "$@"\n`, {
      mode: 0o700,
    });
    return dir;
  }

  function teardown() {
    password = null;
    server?.close();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  }

  function setStatus(ctx: any) {
    ctx.ui?.setStatus?.(
      "sudo",
      password
        ? (ctx.ui.theme?.fg?.("warning", "🔓 sudo") ?? "🔓 sudo")
        : undefined,
    );
  }

  // Shared so parallel sudo calls produce a single prompt.
  function elevate(ctx: any, title: string, detail?: string): Promise<boolean> {
    if (password) return Promise.resolve(true);
    if (!ctx.hasUI) return Promise.resolve(false);
    pending ??= promptPassword(ctx, title, detail)
      .then((pw) => {
        if (pw) {
          setup();
          password = pw;
        }
        setStatus(ctx);
        return !!pw;
      })
      .finally(() => (pending = null));
    return pending;
  }

  pi.registerCommand("sudo", {
    description:
      "Elevate this session with your sudo password (/sudo off to drop)",
    handler: async (args, ctx) => {
      const arg = args.trim();
      if (arg === "off") {
        teardown();
        setStatus(ctx);
        return ctx.ui.notify("sudo dropped for this session", "info");
      }
      if (arg === "status")
        return ctx.ui.notify(
          password ? "Session is elevated" : "Session is not elevated",
          "info",
        );
      if (password) return ctx.ui.notify("Session is already elevated", "info");
      if (await elevate(ctx, "Elevate this pi session"))
        ctx.ui.notify("sudo unlocked for this session", "info");
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!isBashToolCallEvent(event)) return;
    const cmd = event.input.command;
    if (typeof cmd !== "string" || !MENTIONS_SUDO.test(cmd)) return;
    if (
      !(await elevate(ctx, "The agent wants to run a command with sudo", cmd))
    )
      return;

    const d = setup();
    event.input.command = `export PATH=${d}:"$PATH" SUDO_ASKPASS=${d}/askpass\n${cmd}`;
    inflight.add(event.toolCallId);
  });

  pi.on("tool_result", (event) => {
    inflight.delete(event.toolCallId);
  });

  pi.on("session_shutdown", () => teardown());
}
