import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "fast-priority";
const SETTINGS_KEY = "pi-codex-fast";
const PRIORITY_MODELS = new Set([
  "openai-codex/gpt-5.4",
  "openai-codex/gpt-5.5",
  "openai-codex/gpt-5.6-sol",
  "openai-codex/gpt-5.6-terra",
  "openai-codex/gpt-5.6-luna",
]);

type Settings = Record<string, unknown>;

function isRecord(value: unknown): value is Settings {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function settingsPath(): string {
  return join(
    process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
    "settings.json",
  );
}

function projectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

async function readSettings(path: string): Promise<Settings> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    return isRecord(value) ? value : {};
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return {};
    throw error;
  }
}

function mergeSettings(base: Settings, overrides: Settings): Settings {
  const merged = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (isRecord(merged[key]) && isRecord(value)) {
      merged[key] = mergeSettings(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

async function loadFastMode(cwd: string): Promise<boolean | undefined> {
  const settings = mergeSettings(
    await readSettings(settingsPath()),
    await readSettings(projectSettingsPath(cwd)),
  );
  const extensionSettings = settings[SETTINGS_KEY];
  if (!isRecord(extensionSettings)) return undefined;
  return typeof extensionSettings.enabled === "boolean"
    ? extensionSettings.enabled
    : undefined;
}

async function saveFastMode(enabled: boolean): Promise<void> {
  const path = settingsPath();
  const settings = await readSettings(path);
  const current = isRecord(settings[SETTINGS_KEY]) ? settings[SETTINGS_KEY] : {};
  settings[SETTINGS_KEY] = { ...current, enabled };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`);
}

function modelName(ctx: ExtensionContext): string | undefined {
  return ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
}

export default function fastExtension(pi: ExtensionAPI): void {
  let enabled = false;
  let saveQueue: Promise<void> = Promise.resolve();

  const updateStatus = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    if (!enabled) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    ctx.ui.setStatus(
      STATUS_KEY,
      ctx.ui.theme.fg(
        "accent",
        PRIORITY_MODELS.has(modelName(ctx) ?? "") ? "fast" : "fast (inactive)",
      ),
    );
  };

  const setEnabled = (value: boolean, ctx: ExtensionContext) => {
    enabled = value;
    saveQueue = saveQueue.catch(() => undefined).then(() => saveFastMode(value));
    void saveQueue.catch((error) => {
      if (ctx.hasUI) {
        ctx.ui.notify(
          `fast: failed to write settings: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      }
    });
    updateStatus(ctx);
    if (ctx.hasUI) {
      ctx.ui.notify(
        enabled ? "Fast mode enabled." : "Fast mode disabled.",
        "info",
      );
    }
  };

  const reload = async (ctx: ExtensionContext) => {
    enabled = (await loadFastMode(ctx.cwd)) ?? false;
    if (pi.getFlag("fast") === true) enabled = true;
    updateStatus(ctx);
  };

  pi.registerFlag("fast", {
    description: "Start with fast mode enabled",
    type: "boolean",
    default: false,
  });

  pi.registerCommand("fast", {
    description: "Toggle fast mode",
    handler: async (_args, ctx) => setEnabled(!enabled, ctx),
  });

  pi.on("session_start", async (_event, ctx) => reload(ctx));
  pi.on("model_select", async (_event, ctx) => updateStatus(ctx));
  pi.on("before_provider_request", (event, ctx) => {
    if (!enabled || !PRIORITY_MODELS.has(modelName(ctx) ?? "")) return;
    if (!isRecord(event.payload)) return;
    return { ...event.payload, service_tier: "priority" };
  });
}
