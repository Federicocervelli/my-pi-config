import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const CHANNEL = "dashboard:codex-usage";
const REFRESH_MS = 60_000;
const CACHE_DIR = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "pi-codex-usage");
const LOCK_STALE_MS = 45_000;
const CACHE_MAX_STALE_MS = 10 * REFRESH_MS;

type Json = Record<string, unknown>;
type UsageCache = { remainingPercent: number; fetchedAt: number };

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchRemaining(): Promise<number> {
  const dir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const auth: unknown = JSON.parse(await readFile(join(dir, "auth.json"), "utf8"));
  const credential = isObject(auth) ? auth["openai-codex"] : undefined;
  if (!isObject(credential) || typeof credential.access !== "string") {
    throw new Error("Codex OAuth credential unavailable");
  }

  const response = await fetch(ENDPOINT, {
    headers: {
      authorization: `Bearer ${credential.access}`,
      ...(typeof credential.accountId === "string" ? { "chatgpt-account-id": credential.accountId } : {}),
      accept: "application/json",
      "user-agent": "pi-codex-usage",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Codex usage HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!isObject(body) || !isObject(body.rate_limit)) throw new Error("Unexpected Codex usage response");

  const windows = [body.rate_limit.primary_window, body.rate_limit.secondary_window]
    .filter(isObject)
    .filter((window) => typeof window.used_percent === "number");
  const weekly = windows.find((window) => Number(window.limit_window_seconds) >= 172_800) ?? windows[0];
  if (!weekly || typeof weekly.used_percent !== "number") throw new Error("Codex quota unavailable");
  return Math.max(0, Math.min(100, 100 - weekly.used_percent));
}

async function readCache(path: string): Promise<UsageCache | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (isObject(value) && typeof value.remainingPercent === "number" && typeof value.fetchedAt === "number") {
      return { remainingPercent: value.remainingPercent, fetchedAt: value.fetchedAt };
    }
  } catch {}
  return undefined;
}

async function sharedRemaining(): Promise<number | null> {
  await mkdir(CACHE_DIR, { recursive: true, mode: 0o700 });
  const cachePath = join(CACHE_DIR, "usage.json");
  const lockPath = join(CACHE_DIR, "usage.lock");
  let cached = await readCache(cachePath);
  if (cached && Date.now() - cached.fetchedAt < REFRESH_MS) return cached.remainingPercent;

  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    try {
      if (Date.now() - (await stat(lockPath)).mtimeMs > LOCK_STALE_MS) {
        await unlink(lockPath).catch(() => {});
        return sharedRemaining();
      }
    } catch {}
    return cached && Date.now() - cached.fetchedAt < CACHE_MAX_STALE_MS
      ? cached.remainingPercent
      : null;
  }

  try {
    cached = await readCache(cachePath);
    if (cached && Date.now() - cached.fetchedAt < REFRESH_MS) return cached.remainingPercent;
    const remainingPercent = await fetchRemaining();
    const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, JSON.stringify({ remainingPercent, fetchedAt: Date.now() }), { mode: 0o600, flag: "wx" });
    await rename(tempPath, cachePath);
    return remainingPercent;
  } catch {
    return cached && Date.now() - cached.fetchedAt < CACHE_MAX_STALE_MS
      ? cached.remainingPercent
      : null;
  } finally {
    await lock.close();
    await unlink(lockPath).catch(() => {});
  }
}

export default function (pi: ExtensionAPI) {
  let ctx: ExtensionContext | undefined;
  let provider = "";
  let timer: ReturnType<typeof setInterval> | undefined;
  let requestId = 0;

  const publish = (remainingPercent: number | null) =>
    pi.events.emit(CHANNEL, { remainingPercent });

  const refresh = async () => {
    if (!ctx || !ctx.hasUI || provider !== "openai-codex") return;
    const current = ++requestId;
    try {
      const remaining = await sharedRemaining();
      if (current === requestId) publish(remaining);
    } catch {
      if (current === requestId) publish(null);
    }
  };

  const selectProvider = (context: ExtensionContext, selected: string) => {
    ctx = context;
    provider = selected;
    requestId++;
    if (timer) clearInterval(timer);
    timer = undefined;
    publish(null);
    if (provider === "openai-codex" && ctx.hasUI) {
      void refresh();
      timer = setInterval(() => void refresh(), REFRESH_MS);
    }
  };

  pi.on("session_start", (_event, context) => selectProvider(context, context.model?.provider ?? ""));
  pi.on("model_select", (event, context) => selectProvider(context, event.model.provider));
  pi.on("session_shutdown", () => {
    requestId++;
    if (timer) clearInterval(timer);
    timer = undefined;
    ctx = undefined;
    provider = "";
    publish(null);
  });
}
