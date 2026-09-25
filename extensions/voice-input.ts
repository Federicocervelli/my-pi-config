import { spawn, type ChildProcess } from "node:child_process";
import { Key, visibleWidth } from "@earendil-works/pi-tui";
import { FooterComponent, type AgentSession, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

const ENDPOINT = "ws://100.92.220.2:8766/stream"; // Tailscale-only listener on core.

export default function (pi: ExtensionAPI) {
  let microphone: ChildProcess | undefined;
  let socket: WebSocket | undefined;
  let recording = false;
  let waiting = false;
  let limitReached = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let indicator = "";
  let requestRender: (() => void) | undefined;
  let currentModel: ExtensionContext["model"];
  let currentThinking: ExtensionContext["thinkingLevel"];
  let codexRemaining: number | null = null;

  pi.events.on("dashboard:codex-usage", (value) => {
    if (typeof value !== "object" || value === null || !("remainingPercent" in value)) return;
    const remaining = value.remainingPercent;
    if (remaining !== null && typeof remaining !== "number") return;
    codexRemaining = remaining;
    requestRender?.();
  });

  function show(text: string) {
    indicator = text;
    requestRender?.();
  }

  function cleanup(ctx: ExtensionContext) {
    if (timer) clearTimeout(timer);
    timer = undefined;
    recording = false;
    waiting = false;
    limitReached = false;
    microphone?.kill("SIGTERM");
    microphone = undefined;
    socket?.close();
    socket = undefined;
    show("");
  }

  const toggle = async (ctx: ExtensionContext) => {
      if (ctx.mode !== "tui") return;
      if (waiting) return;

      if (recording) {
        recording = false;
        waiting = true;
        show("Transcribing…");
        const mic = microphone;
        if (!mic) {
          cleanup(ctx);
          return;
        }
        // Flush the microphone's last bytes before asking for the final transcript.
        mic.once("close", () => {
          if (socket?.readyState === WebSocket.OPEN) socket.send("stop");
        });
        mic.kill("SIGINT");
        timer = setTimeout(() => {
          ctx.ui.notify("Voice transcription timed out", "error");
          cleanup(ctx);
        }, 210_000);
        return;
      }

      waiting = true;
      try {
        const ws = new WebSocket(ENDPOINT);
        socket = ws;
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Core did not respond")), 8_000);
          ws.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
          ws.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Cannot connect to core")); }, { once: true });
        });

        ws.addEventListener("message", (event) => {
          try {
            const msg = JSON.parse(String(event.data));
            if (msg.type === "limit") {
              recording = false;
              waiting = true;
              limitReached = true;
              show("Transcribing…");
              microphone?.kill("SIGINT");
              timer = setTimeout(() => {
                ctx.ui.notify("Voice transcription timed out", "error");
                cleanup(ctx);
              }, 210_000);
            } else if (msg.type === "final") {
              const text = String(msg.text || "").trim();
              if (text) ctx.ui.pasteToEditor(text);
              else ctx.ui.notify("No speech detected", "info");
              cleanup(ctx);
            } else if (msg.type === "error") {
              ctx.ui.notify(`Voice input: ${msg.message}`, "error");
              cleanup(ctx);
            }
          } catch (error) {
            ctx.ui.notify(`Voice input: ${error}`, "error");
            cleanup(ctx);
          }
        });
        ws.addEventListener("close", () => {
          if (recording || waiting) {
            ctx.ui.notify("Voice connection closed before transcription finished", "error");
            cleanup(ctx);
          }
        });

        const mic = spawn("pw-record", ["--raw", "--rate", "16000", "--channels", "1", "--format", "s16", "-"], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        microphone = mic;
        mic.stdout?.on("data", (pcm: Buffer) => {
          if (!limitReached && ws.readyState === WebSocket.OPEN) ws.send(Uint8Array.from(pcm));
        });
        mic.stderr?.on("data", () => {}); // Consume diagnostics without logging microphone/device details.
        mic.on("error", (error) => {
          ctx.ui.notify(`Microphone: ${error.message}`, "error");
          cleanup(ctx);
        });
        mic.on("close", (code) => {
          if (recording) {
            ctx.ui.notify(`Microphone stopped unexpectedly (${code})`, "error");
            cleanup(ctx);
          }
        });
        recording = true;
        waiting = false;
        limitReached = false;
        show("● Recording");
      } catch (error) {
        ctx.ui.notify(`Voice input: ${error}`, "error");
        cleanup(ctx);
      }
  };

  pi.registerShortcut(Key.alt("r"), { description: "Toggle voice recording", handler: toggle });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    currentModel = ctx.model;
    currentThinking = ctx.thinkingLevel;
    // Reuse Pi's native usage footer; only place our indicator beside its context percentage.
    const session = {
      state: { get model() { return currentModel; }, get thinkingLevel() { return currentThinking; } },
      sessionManager: ctx.sessionManager,
      getContextUsage: () => ctx.getContextUsage(),
      // Pi bundles differ by runtime version; satisfy both footer APIs while hiding the sub badge.
      modelRuntime: { isUsingOAuth: () => false, isUsingSubscription: () => false },
    } as unknown as AgentSession;
    ctx.ui.setFooter((tui, theme, data) => {
      requestRender = () => tui.requestRender();
      const original = new FooterComponent(session, data);
      return {
        dispose: () => original.dispose(),
        invalidate: () => original.invalidate(),
        render(width: number): string[] {
          const isCodex = currentModel?.provider === "openai-codex";
          const quota = isCodex
            ? theme.fg(codexRemaining === null ? "muted" : codexRemaining <= 10 ? "error" : codexRemaining <= 25 ? "warning" : "success", `${codexRemaining === null ? "?" : Math.round(codexRemaining)}% left`)
            : "";
          const suffix = [quota, indicator ? theme.fg("warning", indicator) : ""].filter(Boolean).join(" ");
          const lines = original.render(Math.max(1, width - visibleWidth(suffix ? ` ${suffix}` : "")));
          let line = lines[1]?.replace(/ \(auto\)/g, "");
          if (line && isCodex) line = line.replace(/\s+\$[0-9,]+\.\d{3}(?=\s|$)/g, "");
          const context = /(\?|\d+(?:\.\d+)?%)\/\d+(?:\.\d+)?[kM]?/;
          if (line) {
            line = line.replace(context, (usage) => `${usage}${quota ? ` ${quota}` : ""}${indicator ? ` ${theme.fg("warning", indicator)}` : ""}`);
            lines[1] = line;
          }
          return lines;
        },
      };
    });
  });
  pi.on("model_select", (event) => { currentModel = event.model; requestRender?.(); });
  pi.on("thinking_level_select", (event) => { currentThinking = event.level; requestRender?.(); });
  pi.on("session_shutdown", (_event, ctx) => {
    cleanup(ctx);
    requestRender = undefined;
    ctx.ui.setFooter(undefined);
  });
}
