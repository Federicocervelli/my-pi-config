import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  GOAL_SUBAGENT_SERVICE,
  type GoalSubagentBridge,
  type GoalSubagentServiceRequest,
  type GoalSubagentTask,
} from "../subagents/src/bridge.ts";
import type { ReasoningEffort } from "../subagents/src/domain.ts";

const STATE_TYPE = "goal-state";
const MAX_OBJECTIVE_LENGTH = 4_000;
const DEFAULT_MAX_TURNS = 25;
const DEFAULT_MAX_TOKENS = 50_000;
const NO_PROGRESS_LIMIT = 2;
const MIN_EVIDENCE_LENGTH = 20;

type GoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "complete"
  | "budget_limited"
  | "cleared";

interface GoalState {
  id: string;
  objective: string;
  status: GoalStatus;
  createdAt: number;
  updatedAt: number;
  turns: number;
  tokensUsed: number;
  maxTurns: number;
  tokenBudget: number;
  noProgressTurns: number;
  reviewerId?: string;
  qualityId?: string;
  lastEvidence?: string;
  lastBlocker?: string;
  completionPending?: boolean;
  lastReviewFingerprint?: string;
}

interface GoalInput {
  evidence: string;
}

function isGoalState(value: unknown): value is GoalState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.id === "string" &&
    typeof state.objective === "string" &&
    typeof state.status === "string" &&
    ["active", "paused", "blocked", "complete", "budget_limited", "cleared"].includes(state.status) &&
    typeof state.createdAt === "number" &&
    typeof state.updatedAt === "number" &&
    typeof state.turns === "number" &&
    typeof state.tokensUsed === "number" &&
    typeof state.maxTurns === "number" &&
    typeof state.tokenBudget === "number" &&
    typeof state.noProgressTurns === "number"
  );
}

function latestGoalState(ctx: ExtensionContext): GoalState | undefined {
  for (const entry of [...ctx.sessionManager.getBranch()].reverse()) {
    if (entry.type !== "custom" || entry.customType !== STATE_TYPE) continue;
    if (isGoalState(entry.data)) return entry.data;
  }
  return undefined;
}

function outputText(message: unknown): string {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (part): part is { type: "text"; text: string } =>
        !!part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("\n");
}

function parsePositive(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)([km])?$/i);
  if (!match) return fallback;
  const multiplier = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2] ? 1_000 : 1;
  const parsed = Number(match[1]) * multiplier;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseStart(raw: string) {
  const args = raw.trim();
  let maxTurns = DEFAULT_MAX_TURNS;
  let tokenBudget = DEFAULT_MAX_TOKENS;
  const tokens = args.match(/--tokens(?:=|\s+)([^\s]+)/i);
  const turns = args.match(/--max-turns(?:=|\s+)([^\s]+)/i);
  if (tokens) tokenBudget = parsePositive(tokens[1], tokenBudget);
  if (turns) maxTurns = parsePositive(turns[1], maxTurns);
  const objective = args
    .replace(/--tokens(?:=|\s+)[^\s]+/gi, "")
    .replace(/--max-turns(?:=|\s+)[^\s]+/gi, "")
    .trim();
  return { objective, maxTurns, tokenBudget };
}

function statusLine(state: GoalState) {
  const progress = `${state.turns}/${state.maxTurns}`;
  const budget = `${Math.round(state.tokensUsed / 1000)}k/${Math.round(state.tokenBudget / 1000)}k`;
  return `🎯 ${state.status} · ${progress} · ${budget}`;
}

function describe(state: GoalState | undefined) {
  if (!state || state.status === "cleared") return "No active goal.";
  const lines = [
    `Goal ${state.id}: ${state.status}`,
    state.objective,
    `Turns: ${state.turns}/${state.maxTurns}`,
    `Tokens: ${Math.round(state.tokensUsed / 1000)}k/${Math.round(state.tokenBudget / 1000)}k`,
    `No-progress turns: ${state.noProgressTurns}/${NO_PROGRESS_LIMIT}`,
  ];
  if (state.reviewerId) lines.push(`Reviewer: ${state.reviewerId}`);
  if (state.qualityId) lines.push(`Quality pass: ${state.qualityId}`);
  if (state.lastEvidence) lines.push(`Evidence: ${state.lastEvidence}`);
  if (state.lastBlocker) lines.push(`Blocker: ${state.lastBlocker}`);
  return lines.join("\n");
}

function parentTask(ctx: ExtensionContext, prompt: string, title: string): GoalSubagentTask {
  return {
    prompt,
    title,
    cwd: ctx.cwd,
    parentCwd: ctx.cwd,
    projectTrusted: ctx.isProjectTrusted(),
    inheritedModel: ctx.model
      ? { provider: ctx.model.provider, id: ctx.model.id }
      : undefined,
    inheritedThinkingLevel: ctx.thinkingLevel,
    modelRegistry: ctx.modelRegistry,
    reasoningEffort: "high" satisfies ReasoningEffort,
  };
}

export default function goalExtension(pi: ExtensionAPI) {
  let state: GoalState | undefined;
  let sessionContext: ExtensionContext | undefined;
  let mainStarted = false;
  let continuationPending = false;
  let reviewInFlight = false;
  let qualityInFlight = false;
  let lastTurnFailed = false;
  let operation: Promise<void> | undefined;

  const getBridge = (): GoalSubagentBridge | undefined => {
    let bridge: GoalSubagentBridge | undefined;
    pi.events.emit(GOAL_SUBAGENT_SERVICE, {
      provide(service: GoalSubagentBridge) {
        bridge = service;
      },
    } satisfies GoalSubagentServiceRequest);
    return bridge;
  };

  const save = () => {
    if (state) pi.appendEntry(STATE_TYPE, { ...state });
  };

  const render = () => {
    if (!sessionContext?.hasUI || !state || state.status === "cleared") {
      sessionContext?.ui.setStatus("goal", undefined);
      return;
    }
    sessionContext.ui.setStatus("goal", statusLine(state));
  };

  const update = (patch: Partial<GoalState>) => {
    if (!state) return;
    state = { ...state, ...patch, updatedAt: Date.now() };
    save();
    render();
  };

  const notify = (text: string, level: "info" | "warning" | "error" = "info") => {
    if (sessionContext?.hasUI) sessionContext.ui.notify(text, level);
  };

  const cancelSubagents = async () => {
    const ids = [state?.reviewerId, state?.qualityId].filter(
      (id): id is string => Boolean(id),
    );
    const bridge = getBridge();
    if (bridge && ids.length > 0) {
      try {
        await bridge.cancel(ids);
      } catch {
        // The goal is already being paused/cleared; cancellation is best effort.
      }
    }
  };

  const pause = async (nextStatus: "paused" | "blocked" | "budget_limited", reason?: string) => {
    if (!state || state.status !== "active") return;
    update({ status: nextStatus, lastBlocker: reason });
    await cancelSubagents();
    notify(
      nextStatus === "blocked"
        ? `Goal blocked: ${reason ?? "unknown blocker"}`
        : `Goal ${nextStatus.replace("_", " ")}.`,
      nextStatus === "blocked" ? "warning" : "info",
    );
  };

  const queue = (prompt: string) => {
    if (!state || state.status !== "active") return;
    continuationPending = true;
    pi.sendUserMessage(prompt, { deliverAs: "followUp" });
  };

  const reviewerPrompt = (goal: GoalState) => `
You are the verification subagent for a long-running Pi goal.
Do not edit files, commit, or push. Inspect the current working tree and run safe, relevant checks when useful.
Goal: ${goal.objective}
${goal.completionPending ? `The main agent claims completion with this evidence:\n${goal.lastEvidence ?? "(none)"}\n` : ""}
Report what appears complete, what remains, exact failing checks, and the next concrete action. Treat the goal as incomplete unless the evidence is strong.
If and only if every requirement is satisfied and verification supports completion, include the exact marker GOAL_REVIEW: COMPLETE; otherwise include GOAL_REVIEW: INCOMPLETE.
`.trim();

  const qualityPrompt = (goal: GoalState) => `
You are the code-quality and simplification pass for a long-running Pi goal.
You may edit files, but do not commit or push. Inspect the current diff and surrounding code before changing anything.
Goal: ${goal.objective}
Look specifically for duplicated logic, needless abstractions, repeated parsing or state handling, reinvented standard-library or platform functionality, dead code, and unnecessarily difficult control flow. Preserve behavior and scope: make only high-confidence simplifications that reduce code or make the intent clearer. Do not refactor merely for style, add speculative infrastructure, or broaden the task.
Run the smallest relevant verification after edits and report exactly what you changed and what you intentionally left alone. If no worthwhile simplification exists, say so.
`.trim();

  const startGoal = async (ctx: ExtensionCommandContext) => {
    void ctx;
    const current = state;
    if (!current || current.status !== "active") return;
    queue(`Start pursuing the goal below. Work in small checkpoints, run tests, and call goal_complete only when every requirement is actually satisfied.\n\nGoal: ${current.objective}`);
  };

  const reviewThenContinue = async (ctx: ExtensionContext) => {
    if (reviewInFlight || !state || state.status !== "active") return;
    const bridge = getBridge();
    if (!bridge) {
      queue(`Continue the goal. Inspect the current state, make the next concrete change, verify it, and stop only when the goal is complete.\n\nGoal: ${state.objective}`);
      return;
    }
    reviewInFlight = true;
    const goalId = state.id;
    try {
      const reviewer = await bridge.spawn(parentTask(ctx, reviewerPrompt(state), "goal reviewer"));
      if (state?.id !== goalId || state.status !== "active") return;
      update({ reviewerId: reviewer.id });
      await bridge.waitFor([reviewer.id]);
      const result = await bridge.get(reviewer.id);
      if (state?.id !== goalId || state.status !== "active") return;
      const report = result?.finalText?.slice(0, 12_000) || "Reviewer returned no report.";
      const fingerprint = report.replace(/\s+/g, " ").trim().slice(0, 1_000);
      const repeated = fingerprint.length > 0 && fingerprint === state.lastReviewFingerprint;
      if (state.completionPending && report.includes("GOAL_REVIEW: COMPLETE") && report.length >= MIN_EVIDENCE_LENGTH) {
        update({ status: "complete", completionPending: false, lastReviewFingerprint: fingerprint });
        await cancelSubagents();
        notify("Goal complete; independent review passed.", "info");
        return;
      }
      update({
        completionPending: false,
        lastReviewFingerprint: fingerprint,
        noProgressTurns: repeated ? state.noProgressTurns + 1 : 0,
      });
      if (repeated && state.noProgressTurns >= NO_PROGRESS_LIMIT) {
        await pause("paused", "The reviewer reported no new progress.");
        return;
      }
      queue(`Continue the active goal using this independent review. Address remaining work and verify it. If all requirements are satisfied, call goal_complete with concrete evidence; otherwise keep working.\n\nGoal: ${state.objective}\n\nReviewer report:\n${report}`);
    } catch (error) {
      if (state?.id === goalId && state.status === "active") {
        queue(`Continue the active goal. The reviewer was unavailable; inspect and verify the work yourself.\n\nGoal: ${state.objective}`);
      }
    } finally {
      reviewInFlight = false;
    }
  };

  const runQualityPass = async (ctx: ExtensionContext) => {
    if (qualityInFlight || !state || state.status !== "active") return;
    const bridge = getBridge();
    if (!bridge) {
      notify("Subagent bridge unavailable; quality pass skipped.", "warning");
      return;
    }
    qualityInFlight = true;
    const goalId = state.id;
    try {
      const quality = await bridge.spawn(parentTask(ctx, qualityPrompt(state), "goal quality pass"));
      if (state?.id !== goalId || state.status !== "active") return;
      update({ qualityId: quality.id });
      await bridge.waitFor([quality.id]);
      const result = await bridge.get(quality.id);
      if (state?.id !== goalId || state.status !== "active") return;
      update({ qualityId: undefined });
      queue(`Review the quality pass below, inspect its changes, and continue the goal. Verify behavior and do not accept speculative refactors.\n\nGoal: ${state.objective}\n\nQuality pass report:\n${result?.finalText?.slice(0, 12_000) || "Quality pass returned no report."}`);
    } catch (error) {
      if (state?.id === goalId && state.status === "active") {
        update({ qualityId: undefined });
        notify(`Goal quality pass failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
      }
    } finally {
      qualityInFlight = false;
    }
  };

  const restoreSession = async (ctx: ExtensionContext) => {
    await cancelSubagents();
    sessionContext = ctx;
    state = latestGoalState(ctx);
    mainStarted = false;
    continuationPending = false;
    if (state?.status === "active") {
      state = { ...state, status: "paused", updatedAt: Date.now() };
      save();
      notify("Restored an unfinished goal in paused state. Use /goal resume to continue.", "info");
    }
    render();
  };

  pi.on("session_start", (_event, ctx) => restoreSession(ctx));
  pi.on("session_tree", (_event, ctx) => restoreSession(ctx));

  pi.on("agent_start", () => {
    continuationPending = false;
    lastTurnFailed = false;
  });

  pi.on("turn_end", (event, ctx) => {
    if (!state || state.status !== "active") return;
    const stopReason = (event.message as { stopReason?: string })?.stopReason;
    if (stopReason === "error" || stopReason === "aborted") {
      lastTurnFailed = true;
      return;
    }
    lastTurnFailed = false;
    const text = outputText(event.message);
    const toolCount = Array.isArray(event.toolResults) ? event.toolResults.length : 0;
    const usage = (event.message as { usage?: { output?: number; outputTokens?: number } })?.usage;
    const tokens = usage?.output ?? usage?.outputTokens ?? 0;
    const noProgressTurns = text.trim().length === 0 && toolCount === 0
      ? state.noProgressTurns + 1
      : 0;
    update({
      turns: state.turns + 1,
      tokensUsed: state.tokensUsed + tokens,
      noProgressTurns,
    });
    if (state.turns >= state.maxTurns || state.tokensUsed >= state.tokenBudget) {
      void pause("budget_limited", "The configured goal budget was reached.");
    } else if (noProgressTurns >= NO_PROGRESS_LIMIT) {
      void pause("paused", "No meaningful progress was detected.");
    }
    void ctx;
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (!state || state.status !== "active" || !mainStarted || continuationPending) return;
    if (lastTurnFailed) {
      notify("Goal is waiting after a failed model turn; retry when the connection recovers.", "warning");
      return;
    }
    void reviewThenContinue(ctx);
  });

  pi.on("input", (event, ctx) => {
    if (event.source !== "extension" && state?.status === "active") {
      void pause("paused", "User input paused the autonomous goal.");
      ctx.abort();
    }
    return { action: "continue" };
  });

  pi.on("before_agent_start", (event) => {
    if (!state || state.status !== "active") return;
    return {
      systemPrompt: `${event.systemPrompt}\n\nACTIVE GOAL\nObjective: ${state.objective}\nProgress: ${state.turns}/${state.maxTurns} turns, ${state.tokensUsed}/${state.tokenBudget} output-token budget\n\nKeep working in small verified checkpoints. Do not claim completion without concrete evidence. Use goal_complete only when every requirement is satisfied, or goal_blocked when a real external blocker prevents progress. The extension runs an independent reviewer between turns.`,
    };
  });

  pi.on("session_shutdown", async () => {
    sessionContext = undefined;
    mainStarted = false;
    continuationPending = false;
    reviewInFlight = false;
    qualityInFlight = false;
    operation = undefined;
  });

  pi.registerTool({
    name: "goal_status",
    label: "Goal Status",
    description: "Read the current long-running goal and its progress.",
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: "text", text: describe(state) }], details: state ?? {} };
    },
  });

  pi.registerTool({
    name: "goal_complete",
    label: "Complete Goal",
    description: "Mark the active goal complete. Include concrete evidence from files, tests, or other verification.",
    parameters: Type.Object({ evidence: Type.String({ minLength: MIN_EVIDENCE_LENGTH }) }),
    async execute(_toolCallId, params: GoalInput) {
      if (!state || state.status !== "active") throw new Error("There is no active goal.");
      const evidence = params.evidence.trim();
      if (evidence.length < MIN_EVIDENCE_LENGTH) throw new Error("Completion evidence is too short.");
      update({ completionPending: true, lastEvidence: evidence });
      return {
        content: [{ type: "text", text: "Completion claim recorded. An independent reviewer will verify it before the goal is closed." }],
        details: state,
      };
    },
  });

  pi.registerTool({
    name: "goal_blocked",
    label: "Block Goal",
    description: "Pause the active goal because a real external blocker prevents further progress.",
    parameters: Type.Object({ blocker: Type.String({ minLength: 10 }) }),
    async execute(_toolCallId, params: { blocker: string }) {
      if (!state || state.status !== "active") throw new Error("There is no active goal.");
      await pause("blocked", params.blocker.trim());
      return { content: [{ type: "text", text: `Goal blocked: ${params.blocker}` }], details: state };
    },
  });

  const beginGoal = async (objective: string, maxTurns: number, tokenBudget: number, ctx: ExtensionCommandContext) => {
    if (state?.status === "active") {
      const replace = ctx.hasUI ? await ctx.ui.confirm("Replace active goal?", describe(state)) : false;
      if (!replace) return;
      await pause("paused", "Replaced by a new goal.");
    }
    await ctx.waitForIdle();
    const now = Date.now();
    state = {
      id: `goal-${now.toString(36)}`,
      objective,
      status: "active",
      createdAt: now,
      updatedAt: now,
      turns: 0,
      tokensUsed: 0,
      maxTurns,
      tokenBudget,
      noProgressTurns: 0,
    };
    mainStarted = true;
    continuationPending = false;
    save();
    render();
    notify(`Goal started: ${state.objective}`, "info");
    operation = startGoal(ctx).catch((error) => {
      if (state?.status === "active") void pause("blocked", error instanceof Error ? error.message : String(error));
    });
  };

  pi.registerCommand("goal", {
    description: "Set, inspect, pause, resume, or clear a long-running goal",
    handler: async (rawArgs, ctx) => {
      const args = rawArgs.trim();
      const action = args.toLowerCase();
      if (!args || action === "status") {
        ctx.ui.notify(describe(state), "info");
        return;
      }
      if (action === "prompt") {
        if (!state) {
          ctx.ui.notify("No active goal.", "warning");
          return;
        }
        ctx.ui.notify(reviewerPrompt(state), "info");
        return;
      }
      if (action === "quality" || action === "polish") {
        if (!state || state.status !== "active") {
          ctx.ui.notify("No active goal to review.", "warning");
          return;
        }
        if (qualityInFlight) {
          ctx.ui.notify("A quality pass is already running.", "info");
          return;
        }
        ctx.ui.notify("Starting code-quality pass.", "info");
        operation = runQualityPass(ctx).catch((error) => {
          notify(`Quality pass failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
        });
        return;
      }
      if (action === "pause") {
        await pause("paused", "Paused by the user.");
        ctx.abort();
        return;
      }
      if (action === "resume") {
        if (!state || !["paused", "blocked", "budget_limited"].includes(state.status)) {
          ctx.ui.notify("No paused goal to resume.", "warning");
          return;
        }
        update({ status: "active", lastBlocker: undefined, noProgressTurns: 0 });
        mainStarted = true;
        queue(`Resume the goal and continue from the current workspace state. Verify before claiming completion.\n\nGoal: ${state.objective}`);
        return;
      }
      if (action === "clear") {
        await cancelSubagents();
        if (state) update({ status: "cleared" });
        mainStarted = false;
        continuationPending = false;
        ctx.ui.notify("Goal cleared.", "info");
        return;
      }
      if (action === "help") {
        ctx.ui.notify("/goal <objective> [--tokens N] [--max-turns N]\n/goal status | prompt | quality | pause | resume | clear", "info");
        return;
      }

      const parsed = parseStart(args);
      if (!parsed.objective) {
        ctx.ui.notify("Provide a goal objective.", "warning");
        return;
      }
      if (parsed.objective.length > MAX_OBJECTIVE_LENGTH) {
        ctx.ui.notify(`Goal objectives are limited to ${MAX_OBJECTIVE_LENGTH} characters.`, "error");
        return;
      }
      await beginGoal(parsed.objective, parsed.maxTurns, parsed.tokenBudget, ctx);
    },
  });
}
