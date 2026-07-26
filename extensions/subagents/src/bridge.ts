import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { ReasoningEffort, SubagentSnapshot, SpawnTask } from "./domain.ts";

export const GOAL_SUBAGENT_SERVICE = "subagents:goal-service";

export interface GoalSubagentTask {
  readonly prompt: string;
  readonly title: string;
  readonly cwd: string;
  readonly model?: string;
  readonly reasoningEffort?: ReasoningEffort;
  readonly parentCwd: string;
  readonly projectTrusted: boolean;
  readonly inheritedModel?: { provider: string; id: string };
  readonly inheritedThinkingLevel?: string;
  readonly modelRegistry?: ModelRegistry;
}

export interface GoalSubagentBridge {
  spawn(task: GoalSubagentTask): Promise<SubagentSnapshot>;
  waitFor(ids: ReadonlyArray<string>): Promise<void>;
  get(id: string): Promise<SubagentSnapshot | undefined>;
  cancel(ids: ReadonlyArray<string>): Promise<unknown>;
}

export interface GoalSubagentServiceRequest {
  provide(service: GoalSubagentBridge): void;
}

export function makeSpawnTask(task: GoalSubagentTask): SpawnTask {
  return {
    origin: "goal",
    prompt: task.prompt,
    title: task.title,
    cwd: task.cwd,
    model: task.model,
    reasoningEffort: task.reasoningEffort,
    parent: {
      parentCwd: task.parentCwd,
      projectTrusted: task.projectTrusted,
      inheritedModel: task.inheritedModel,
      inheritedThinkingLevel: task.inheritedThinkingLevel,
      modelRegistry: task.modelRegistry,
    },
  };
}
