import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Effect, Fiber, Schedule } from "effect";
import {
  emptyGitInfoState,
  GIT_INFO_CHANNEL,
  REFRESH_CHANNEL,
  type PullRequestInfo,
} from "../shared/dashboard-state.ts";
import {
  loadChangedFiles,
  showChangedFiles,
} from "./src/changed-files-view.ts";
import { runCommand, type CommandRunner } from "./src/process.ts";
import { makeRefreshCoordinator } from "./src/refresh-coordinator.ts";
import {
  createRuntime,
  runEffect,
  type GitInfoRuntime,
} from "./src/runtime.ts";

const POLL_INTERVAL_MS = 3_000;
const GIT_TIMEOUT_MS = 3_000;
const GH_TIMEOUT_MS = 10_000;

function countChangedFiles(status: string) {
  if (!status.trim()) return 0;
  return status.split("\n").filter(Boolean).length;
}

function countNumstat(numstat: string) {
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const line of numstat.split("\n")) {
    const [added, removed] = line.split("\t");
    if (added && added !== "-") linesAdded += Number(added) || 0;
    if (removed && removed !== "-") linesRemoved += Number(removed) || 0;
  }
  return { linesAdded, linesRemoved };
}

function countUntrackedLines(paths: string[], cwd: string) {
  let linesAdded = 0;
  for (const path of paths) {
    try {
      const content = readFileSync(resolve(cwd, path));
      if (content.includes(0)) continue; // Ignore binary files.
      linesAdded += content.length === 0 ? 0 : content.toString("utf8").split("\n").length - 1 + (content.at(-1) === 10 ? 0 : 1);
    } catch {
      // Files can disappear while the status refresh is running.
    }
  }
  return linesAdded;
}

function parsePullRequest(value: unknown) {
  if (typeof value !== "object" || value === null) return null;
  if (!("number" in value) || typeof value.number !== "number") return null;
  if (!("url" in value) || typeof value.url !== "string") return null;
  if (!("state" in value) || value.state !== "OPEN") return null;

  return {
    number: value.number,
    url: value.url,
    isDraft: "isDraft" in value && value.isDraft === true,
  } satisfies PullRequestInfo;
}

function parsePullRequestJson(value: string) {
  try {
    return parsePullRequest(JSON.parse(value));
  } catch {
    return null;
  }
}

export default function gitInfo(pi: ExtensionAPI, initialCtx?: ExtensionContext) {
  let state = emptyGitInfoState();
  let runtime: GitInfoRuntime | undefined;
  let pollingFiber: Fiber.Fiber<void> | undefined;
  let currentContext: ExtensionContext | undefined;
  let generation = 0;
  let queriedPrBranch: string | null = null;
  const refreshCoordinator = makeRefreshCoordinator();

  const getRuntime = () => (runtime ??= createRuntime());
  const publish = () => pi.events.emit(GIT_INFO_CHANNEL, { ...state });
  const run = (
    command: string,
    args: string[],
    ctx: ExtensionContext,
    timeout: number,
  ) => runCommand(command, args, ctx.cwd, timeout);

  const lookupPullRequest = (ctx: ExtensionContext, branch: string) =>
    Effect.gen(function* () {
      const result = yield* run(
        "gh",
        ["pr", "view", branch, "--json", "number,url,state,isDraft"],
        ctx,
        GH_TIMEOUT_MS,
      );
      if (result.code !== 0) return null;
      return parsePullRequestJson(result.stdout);
    });

  const refreshEffect = (
    ctx: ExtensionContext,
    forcePullRequest: boolean,
    refreshGeneration: number,
  ) =>
    Effect.suspend(() => {
      if (refreshGeneration !== generation) return Effect.void;
      currentContext = ctx;

      return Effect.gen(function* () {
        const repo = yield* run(
          "git",
          ["rev-parse", "--is-inside-work-tree"],
          ctx,
          GIT_TIMEOUT_MS,
        );
        if (refreshGeneration !== generation) return;

        if (repo.code !== 0 || repo.stdout.trim() !== "true") {
          queriedPrBranch = null;
          state = emptyGitInfoState();
          publish();
          return;
        }

        const [branchResult, headResult, statusResult, numstatResult, untrackedResult] = yield* Effect.all(
          [
            run("git", ["branch", "--show-current"], ctx, GIT_TIMEOUT_MS),
            run("git", ["rev-parse", "--short", "HEAD"], ctx, GIT_TIMEOUT_MS),
            run(
              "git",
              ["status", "--porcelain=v1", "--untracked-files=all"],
              ctx,
              GIT_TIMEOUT_MS,
            ),
            run("git", ["diff", "--numstat", "HEAD", "--"], ctx, GIT_TIMEOUT_MS),
            run("git", ["ls-files", "--others", "--exclude-standard", "-z"], ctx, GIT_TIMEOUT_MS),
          ],
          { concurrency: "unbounded" },
        );
        if (refreshGeneration !== generation) return;

        const branchName = branchResult.stdout.trim();
        const shortHead = headResult.stdout.trim();
        const branch =
          branchName || (shortHead ? `detached@${shortHead}` : "detached");
        const branchChanged = branchName !== queriedPrBranch;

        const numstat = numstatResult.code === 0
          ? countNumstat(numstatResult.stdout)
          : { linesAdded: 0, linesRemoved: 0 };
        const untrackedPaths = untrackedResult.code === 0
          ? untrackedResult.stdout.split("\0").filter(Boolean)
          : [];

        state = {
          ...state,
          isRepository: true,
          branch,
          changedFiles:
            statusResult.code === 0
              ? countChangedFiles(statusResult.stdout)
              : 0,
          linesAdded: numstat.linesAdded + countUntrackedLines(untrackedPaths, ctx.cwd),
          linesRemoved: numstat.linesRemoved,
          pullRequest: branchChanged ? null : state.pullRequest,
        };
        publish();

        if (!branchName) {
          // queriedPrBranch is never "", so branchChanged already cleared pullRequest.
          queriedPrBranch = null;
          return;
        }

        if (forcePullRequest || branchChanged) {
          queriedPrBranch = branchName;
          const pullRequest = yield* lookupPullRequest(ctx, branchName);
          if (refreshGeneration !== generation) return;
          state = { ...state, pullRequest };
          publish();
        }
      });
    });

  const refresh = (ctx: ExtensionContext, forcePullRequest = false) =>
    refreshCoordinator.run(refreshEffect(ctx, forcePullRequest, generation));

  const refreshIfIdle = (ctx: ExtensionContext) =>
    refreshCoordinator.runIfIdle(refreshEffect(ctx, false, generation));

  const reportBackgroundDefect = (defect: unknown) =>
    Effect.logError("git-info background task defect", defect);

  const poll = () =>
    Effect.suspend(() =>
      currentContext ? refreshIfIdle(currentContext) : Effect.void,
    ).pipe(
      Effect.catchDefect(reportBackgroundDefect),
      Effect.repeat(Schedule.fixed(POLL_INTERVAL_MS)),
      Effect.delay(POLL_INTERVAL_MS),
      Effect.asVoid,
    );

  const forkBackground = (effect: Effect.Effect<void, never, CommandRunner>) =>
    getRuntime().runFork(
      effect.pipe(Effect.catchDefect(reportBackgroundDefect)),
    );

  const refreshInBackground = (ctx: ExtensionContext) => {
    forkBackground(refreshIfIdle(ctx));
  };

  const stopRefreshListener = pi.events.on(REFRESH_CHANNEL, () => {
    if (currentContext) refreshInBackground(currentContext);
  });

  const initialize = async (ctx: ExtensionContext) => {
    generation += 1;
    queriedPrBranch = null;

    const previousPollingFiber = pollingFiber;
    pollingFiber = undefined;
    if (previousPollingFiber) {
      await getRuntime().runPromise(Fiber.interrupt(previousPollingFiber));
    }

    // Do not block Pi startup on GitHub/network I/O. The initial refresh publishes
    // state when it completes; polling continues to keep it current afterwards.
    refreshInBackground(ctx);
    pollingFiber = forkBackground(poll());
  };

  pi.on("session_start", async (_event, ctx) => initialize(ctx));
  if (initialCtx) void initialize(initialCtx);

  pi.on("input", (_event, ctx) => {
    refreshInBackground(ctx);
    return { action: "continue" };
  });

  pi.on("tool_execution_end", (_event, ctx) => {
    refreshInBackground(ctx);
  });

  pi.on("session_shutdown", async () => {
    stopRefreshListener();
    generation += 1;
    currentContext = undefined;
    pollingFiber = undefined;
    const closing = runtime;
    runtime = undefined;
    await closing?.dispose();
  });

  pi.registerCommand("lg", {
    description: "Browse changed files and their diffs",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify(
          "The local changes viewer requires the interactive TUI",
          "warning",
        );
        return;
      }

      const files = await runEffect(getRuntime(), loadChangedFiles(ctx.cwd), {
        signal: ctx.signal,
        interruptMessage: "Loading changed files was cancelled.",
      });
      if (files === null) {
        ctx.ui.notify("Not a git repository", "warning");
        return;
      }
      if (files.length === 0) {
        ctx.ui.notify("Working tree is clean", "info");
        return;
      }

      await showChangedFiles(ctx, files);
    },
  });

  pi.registerCommand("pr", {
    description: "Refresh git and pull request information",
    handler: async (_args, ctx) => {
      await runEffect(getRuntime(), refresh(ctx, true), {
        signal: ctx.signal,
        interruptMessage: "Git and pull request refresh was cancelled.",
      });
      if (!state.isRepository) {
        ctx.ui.notify("Not a git repository", "warning");
      } else if (state.pullRequest) {
        ctx.ui.notify(
          `PR #${state.pullRequest.number}: ${state.pullRequest.url}`,
          "info",
        );
      } else {
        ctx.ui.notify(`No open PR found for ${state.branch}`, "info");
      }
    },
  });
}
