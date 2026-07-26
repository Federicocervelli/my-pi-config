import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import https from "node:https";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CODEX_USAGE_CHANNEL } from "../shared/dashboard-state.ts";

const ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const REFRESH_MS = 60_000;

type Json = Record<string, unknown>;
type Window = { used: number; resetAfterSeconds?: number; seconds?: number };

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readAuth(path: string): Promise<{ access: string; accountId?: string } | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isObject(value)) return undefined;

    const piAuth = value["openai-codex"];
    if (isObject(piAuth) && typeof piAuth.access === "string") {
      return {
        access: piAuth.access,
        ...(typeof piAuth.accountId === "string" ? { accountId: piAuth.accountId } : {}),
      };
    }

    const tokens = value.tokens;
    if (isObject(tokens) && typeof tokens.access_token === "string") {
      return {
        access: tokens.access_token,
        ...(typeof tokens.account_id === "string" ? { accountId: tokens.account_id } : {}),
      };
    }
  } catch {
    // Try the next credential source.
  }
  return undefined;
}

async function auth(): Promise<{ access: string; accountId?: string } | undefined> {
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  return (
    (await readAuth(join(agentDir, "auth.json"))) ??
    (await readAuth(join(homedir(), ".codex", "auth.json")))
  );
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as { code?: string; message?: string } | undefined;
  return cause?.code ? `${error.message} (${cause.code}${cause.message ? `: ${cause.message}` : ""})` : error.message;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseWindow(value: unknown): Window | undefined {
  if (!isObject(value)) return undefined;
  const used = number(value.used_percent);
  if (used === undefined) return undefined;

  const resetAfter = number(value.reset_after_seconds);
  const resetAt = number(value.reset_at);
  const seconds = number(value.limit_window_seconds);
  return {
    used: Math.max(0, Math.min(100, used)),
    ...(resetAfter !== undefined
      ? { resetAfterSeconds: resetAfter }
      : resetAt !== undefined
        ? { resetAfterSeconds: Math.max(0, resetAt - Date.now() / 1000) }
        : {}),
    ...(seconds !== undefined ? { seconds } : {}),
  };
}

async function fetchUsage(): Promise<{ remainingPercent: number; resetAfterSeconds: number | null }> {
  const credentials = await auth();
  if (!credentials) throw new Error("no Codex OAuth credentials");

  const body = await requestUsage({
    authorization: `Bearer ${credentials.access}`,
    ...(credentials.accountId ? { "chatgpt-account-id": credentials.accountId } : {}),
    accept: "application/json",
    "user-agent": "pi-codex-usage",
  });
  if (!isObject(body) || !isObject(body.rate_limit)) throw new Error("unexpected response");
  const rateLimit = body.rate_limit;
  const windows = [parseWindow(rateLimit.primary_window), parseWindow(rateLimit.secondary_window)].filter(
    (window): window is Window => window !== undefined,
  );
  if (windows.length === 0) throw new Error("no rate-limit window");
  const weekly = windows.find((window) => (window.seconds ?? 0) >= 172_800) ?? windows[0];
  return {
    remainingPercent: Math.max(0, 100 - weekly.used),
    resetAfterSeconds: weekly.resetAfterSeconds ?? null,
  };
}

function requestUsage(headers: Record<string, string>): Promise<Json> {
  return new Promise((resolve, reject) => {
    const request = https.get(ENDPOINT, { headers, family: 4, timeout: 15_000 }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { raw += chunk; });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode ?? "unknown"}`));
          return;
        }
        try {
          resolve(JSON.parse(raw) as Json);
        } catch {
          reject(new Error("invalid JSON response"));
        }
      });
    });
    request.on("timeout", () => request.destroy(new Error("request timeout")));
    request.on("error", reject);
  });
}

export default function codexUsage(pi: ExtensionAPI): void {
  let context: ExtensionContext | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let request = 0;

  const publish = (
    remainingPercent: number | null,
    resetAfterSeconds: number | null = null,
  ) => pi.events.emit(CODEX_USAGE_CHANNEL, { remainingPercent, resetAfterSeconds });

  const refresh = async (ctx: ExtensionContext, reportError = false) => {
    if (!ctx.hasUI) return;
    const current = ++request;
    try {
      const usage = await fetchUsage();
      if (current === request) publish(usage.remainingPercent, usage.resetAfterSeconds);
    } catch (error) {
      if (current !== request) return;
      publish(null);
      if (reportError) {
        ctx.ui.notify(
          `Codex usage unavailable: ${formatError(error)}`,
          "warning",
        );
      }
    }
  };

  const start = (ctx: ExtensionContext) => {
    context = ctx;
    if (timer) clearInterval(timer);
    void refresh(ctx);
    timer = setInterval(() => {
      if (context) void refresh(context);
    }, REFRESH_MS);
  };

  pi.registerCommand("codex-usage", {
    description: "Refresh Codex weekly usage",
    handler: async (_args, ctx) => refresh(ctx, true),
  });
  pi.on("session_start", (_event, ctx) => {
    publish(null);
    start(ctx);
  });
  pi.on("session_shutdown", () => {
    request += 1;
    if (timer) clearInterval(timer);
    timer = undefined;
    context = undefined;
  });
}
