import { homedir } from "node:os";
import { relative } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
  ThemeColor,
} from "@earendil-works/pi-coding-agent";
import {
  getCapabilities,
  hyperlink,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  emptyCodexUsageState,
  emptyGitInfoState,
  emptyModelInfoState,
  CODEX_USAGE_CHANNEL,
  GIT_INFO_CHANNEL,
  MODEL_INFO_CHANNEL,
  REFRESH_CHANNEL,
  isCodexUsageState,
  isGitInfoState,
  isModelInfoState,
} from "../shared/dashboard-state.ts";

const MATRIX_PHRASES = [
  "decrypting the matrix",
  "watching the rain",
  "dodging tracebacks",
  "syncing with the source",
  "hopping the signal",
  "booting the simulation",
  "stabilizing the stack",
  "crossing the firewall",
] as const;

function matrixWorkingText(text: string): string {
  if (!/working\.\.\./i.test(text)) return text;
  const phrase = MATRIX_PHRASES[Math.floor(Date.now() / 2_000) % MATRIX_PHRASES.length];
  return text.replace(/working\.\.\./i, phrase);
}

function setMatrixWorkingMessage(ctx: ExtensionContext) {
  if (ctx.mode !== "tui") return;
  const phrase = MATRIX_PHRASES[Math.floor(Date.now() / 2_000) % MATRIX_PHRASES.length];
  ctx.ui.setWorkingMessage(`${phrase}...`);
}

interface RenderableNode {
  children?: RenderableNode[];
  invalidate(): void;
  render(width: number): string[];
}

interface DashboardTui extends RenderableNode {
  requestRender(force?: boolean): void;
}

const ANSI_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
// eslint-disable-next-line no-control-regex
const OSC_PATTERN =
  /(?:\u001b\]|\u009d)(?:[^\u0007\u001b\u009c]|\u001b(?!\\))*(?:\u0007|\u001b\\|\u009c)/g;
// eslint-disable-next-line no-control-regex
const CSI_PATTERN = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g;
// eslint-disable-next-line no-control-regex
const ESCAPE_PATTERN = /\u001b(?:[()][0-2A-Z]|[ -/]*[@-~])/g;

function sanitizeTerminalLabel(text: string) {
  return text
    .replace(OSC_PATTERN, "")
    .replace(CSI_PATTERN, "")
    .replace(ESCAPE_PATTERN, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

function hasChildren(
  component: RenderableNode,
): component is RenderableNode & { children: RenderableNode[] } {
  return Array.isArray(component.children);
}

function renderedText(component: RenderableNode) {
  try {
    return component.render(200).join("\n").replace(ANSI_PATTERN, "");
  } catch {
    return "";
  }
}

function hideThemesSection(component: RenderableNode) {
  if (!hasChildren(component)) return false;

  for (let index = 0; index < component.children.length; index += 1) {
    const child = component.children[index]!;
    const firstLine = renderedText(child)
      .split("\n")
      .find((line) => line.trim())
      ?.trim();

    if (firstLine === "[Themes]") {
      const removeCount =
        component.children[index + 1] &&
        renderedText(component.children[index + 1]!).trim() === ""
          ? 2
          : 1;
      component.children.splice(index, removeCount);
      component.invalidate();
      return true;
    }

    if (hideThemesSection(child)) return true;
  }

  return false;
}

function formatTokens(tokens: number) {
  if (tokens < 1_000) return `${tokens}`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1_000)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}m`;
}

function formatDirectory(cwd: string) {
  const home = homedir();
  if (cwd === home) return "~";
  const display = cwd.startsWith(`${home}/`) ? `~/${relative(home, cwd)}` : cwd;
  return sanitizeTerminalLabel(display);
}

function columns(left: string, right: string, width: number) {
  if (!right) return truncateToWidth(left, width);

  const naturalGap = width - visibleWidth(left) - visibleWidth(right);
  if (naturalGap >= 1) return `${left}${" ".repeat(naturalGap)}${right}`;

  const leftWidth = Math.max(1, Math.floor(width * 0.45));
  const rightWidth = Math.max(1, width - leftWidth - 1);
  const fittedLeft = truncateToWidth(left, leftWidth);
  const fittedRight = truncateToWidth(right, rightWidth);
  const gap = Math.max(
    1,
    width - visibleWidth(fittedLeft) - visibleWidth(fittedRight),
  );
  return truncateToWidth(
    `${fittedLeft}${" ".repeat(gap)}${fittedRight}`,
    width,
  );
}

export default function uiCustomization(pi: ExtensionAPI) {
  let title = "pi";
  let modelInfo = emptyModelInfoState();
  let gitInfo = emptyGitInfoState();
  let codexUsage = emptyCodexUsageState();
  let requestRender: (() => void) | undefined;
  let activeTui: DashboardTui | undefined;
  let themeRemovalTimers: Array<ReturnType<typeof setTimeout>> = [];

  const stopModelListener = pi.events.on(MODEL_INFO_CHANNEL, (value) => {
    if (!isModelInfoState(value)) return;
    modelInfo = value;
    requestRender?.();
  });

  const stopGitListener = pi.events.on(GIT_INFO_CHANNEL, (value) => {
    if (!isGitInfoState(value)) return;
    gitInfo = value;
    requestRender?.();
  });

  const stopCodexUsageListener = pi.events.on(CODEX_USAGE_CHANNEL, (value) => {
    if (!isCodexUsageState(value)) return;
    codexUsage = value;
    requestRender?.();
  });

  function scheduleThemeRemoval(tui: DashboardTui) {
    for (const timer of themeRemovalTimers) clearTimeout(timer);
    themeRemovalTimers = [];

    for (const delay of [0, 50, 250, 1_000]) {
      themeRemovalTimers.push(
        setTimeout(() => {
          if (hideThemesSection(tui)) tui.requestRender(true);
        }, delay),
      );
    }
  }

  function install(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") return;

    ctx.ui.setHeader((tui) => {
      activeTui = tui;
      requestRender = () => tui.requestRender();
      scheduleThemeRemoval(tui);

      return { render: () => [], invalidate() {} };
    });

    ctx.ui.setFooter((tui, theme, footerData: ReadonlyFooterDataProvider) => {
      requestRender = () => tui.requestRender();

      return {
        invalidate() {},
        render(width: number) {
          const statuses = footerData.getExtensionStatuses();
          const dictateStatus = statuses.get("dictate");
          const diff = gitInfo.branch
            ? ` ${theme.fg("toolDiffAdded", `+${gitInfo.linesAdded}`)} ${theme.fg("toolDiffRemoved", `-${gitInfo.linesRemoved}`)}`
            : "";
          const location = gitInfo.branch
            ? `${theme.fg("text", formatDirectory(ctx.cwd))} ${theme.fg("muted", `@ ${gitInfo.branch}`)}${diff}`
            : theme.fg("text", formatDirectory(ctx.cwd));
          const directory = dictateStatus ? `${location} ${dictateStatus}` : location;
          let git = "";

          if (gitInfo.pullRequest) {
            const prLabel = `PR #${gitInfo.pullRequest.number}`;
            const linkedPr = getCapabilities().hyperlinks
              ? hyperlink(prLabel, gitInfo.pullRequest.url)
              : prLabel;
            git += ` · ${linkedPr}`;
          }

          const contextPercent =
            modelInfo.contextPercent === null
              ? "?"
              : `${Math.round(modelInfo.contextPercent)}`;
          const contextWindow =
            modelInfo.contextWindow > 0
              ? formatTokens(modelInfo.contextWindow)
              : "?";
          const contextDisplay = `${contextPercent}%/${contextWindow}`;
          const contextValue = modelInfo.contextPercent ?? 0;
          const contextColor: ThemeColor =
            contextValue >= 90
              ? "error"
              : contextValue >= 80
                ? "syntaxVariable"
                : contextValue >= 70
                  ? "warning"
                  : "muted";
          const codexRemaining = codexUsage.remainingPercent;
          const codexColor: ThemeColor =
            codexRemaining === null
              ? "muted"
              : codexRemaining <= 10
                ? "error"
                : codexRemaining <= 25
                  ? "warning"
                  : "success";
          const resetDays =
            codexUsage.resetAfterSeconds === null
              ? null
              : Math.floor(codexUsage.resetAfterSeconds / 86_400);
          const codexDisplay =
            codexRemaining === null
              ? theme.fg(codexColor, "?%")
              : `${theme.fg(codexColor, `${Math.round(codexRemaining)}%`)}${resetDays === null ? "" : ` ${theme.fg("muted", `resets in ${resetDays} days`)}`}`;
          const usage = `${theme.fg(contextColor, contextDisplay)} · ${codexDisplay}`;
          const fastStatus = statuses.get("fast-priority");
          const fastIndicator = fastStatus ? theme.fg("accent", "⚡︎") : "";
          const thinkingColor = ({
            off: "thinkingOff",
            minimal: "thinkingMinimal",
            low: "thinkingLow",
            medium: "thinkingMedium",
            high: "thinkingHigh",
            xhigh: "thinkingXhigh",
            max: "thinkingXhigh",
          } as Record<string, ThemeColor>)[modelInfo.thinking] ?? "muted";
          const modelName = modelInfo.provider
            ? `${modelInfo.provider}/${modelInfo.modelId}`
            : modelInfo.modelId;
          const model = [
            theme.fg("accent", modelName),
            modelInfo.provider ? theme.fg(thinkingColor, modelInfo.thinking) : "",
            fastIndicator,
          ].filter(Boolean).join(" ");

          const subagentsStatus = statuses.get("subagents");
          const bottomRight = [git, subagentsStatus]
            .filter(Boolean)
            .join(theme.fg("dim", " · "));
          const lines = [
            columns(directory, model, width),
            columns(theme.fg("muted", usage), bottomRight, width),
          ];

          // Extension statuses render after the two dashboard lines, one per row.
          // Fast mode, dictation, and subagents are shown inline above instead.
          const statusLines = Array.from(statuses.entries())
            .filter(
              ([key]) =>
                key !== "fast-priority" &&
                key !== "dictate" &&
                key !== "subagents",
            )
            .sort(([a], [b]) => a.localeCompare(b))
            .flatMap(([, text]) => text.split("\n"));
          for (const statusLine of statusLines) {
            lines.push(
              truncateToWidth(matrixWorkingText(statusLine), width, theme.fg("dim", "...")),
            );
          }

          return lines;
        },
      };
    });

    ctx.ui.setTitle(`pi · ${title}`);
    pi.events.emit(REFRESH_CHANNEL, undefined);
  }

  pi.on("session_start", (_event, ctx) => {
    title = formatDirectory(ctx.cwd);
    modelInfo = emptyModelInfoState();
    gitInfo = emptyGitInfoState();
    codexUsage = emptyCodexUsageState();
    install(ctx);
    setMatrixWorkingMessage(ctx);
  });

  pi.on("agent_start", (_event, ctx) => setMatrixWorkingMessage(ctx));

  pi.on("resources_discover", () => {
    if (activeTui) scheduleThemeRemoval(activeTui);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    stopModelListener();
    stopGitListener();
    stopCodexUsageListener();
    for (const timer of themeRemovalTimers) clearTimeout(timer);
    themeRemovalTimers = [];
    activeTui = undefined;
    requestRender = undefined;
    if (ctx.mode === "tui") {
      ctx.ui.setHeader(undefined);
      ctx.ui.setFooter(undefined);
    }
  });
}
