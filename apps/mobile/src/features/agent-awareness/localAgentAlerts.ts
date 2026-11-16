import type {
  EnvironmentId,
  OrchestrationProjectShell,
  OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { projectThreadAwarenessV2, type AgentAwarenessPhase } from "@t3tools/shared/agentAwareness";
import * as DateTime from "effect/DateTime";

/**
 * Local alerts for builds that cannot receive relay pushes. They apply the relay's own rules
 * (infra/relay/src/agentActivity/agentActivityAlerts.ts) for when to alert to the shells this
 * client already streams. Each thread has one card (`slot`) that its alerts replace.
 */
export interface LocalAgentRow {
  readonly key: string;
  /** The card of this thread, the same one the fork's server names in its pushes. */
  readonly slot: string;
  readonly phase: AgentAwarenessPhase;
  readonly status: string;
  readonly threadTitle: string;
  readonly projectTitle: string;
  readonly updatedAt: string;
  readonly deepLink: string;
}

export interface LocalAgentAlertPreferences {
  readonly notifyOnApproval: boolean;
  readonly notifyOnInput: boolean;
  readonly notifyOnCompletion: boolean;
  readonly notifyOnFailure: boolean;
}

export const DEFAULT_LOCAL_ALERT_PREFERENCES: LocalAgentAlertPreferences = {
  notifyOnApproval: true,
  notifyOnInput: true,
  notifyOnCompletion: true,
  notifyOnFailure: true,
};

/** The relay holds a completion this long: a run can end moments before its continuation. */
export const COMPLETION_CONFIRM_MS = 5_000;
const TERMINAL_FRESHNESS_MS = 2 * 60 * 1_000;

export function localAgentRows(input: {
  readonly environmentId: EnvironmentId;
  readonly threads: ReadonlyArray<OrchestrationV2ThreadShell>;
  readonly projects: ReadonlyArray<Pick<OrchestrationProjectShell, "id" | "title">>;
  /** Top-level threads whose subagent waits on an approval, with the child's update time. */
  readonly childApprovals?: ReadonlyMap<string, string>;
}): ReadonlyArray<LocalAgentRow> {
  const projects = new Map(input.projects.map((project) => [project.id, project]));
  const rows: LocalAgentRow[] = [];
  for (const thread of input.threads) {
    if (thread.archivedAt !== null) continue;
    const project = projects.get(thread.projectId);
    if (!project) continue;
    const childUpdatedAt = input.childApprovals?.get(thread.id);
    const state = projectThreadAwarenessV2({
      environmentId: input.environmentId,
      project,
      thread,
      pendingSubagentRequest:
        childUpdatedAt === undefined
          ? null
          : {
              requestId: thread.id as never,
              updatedAt: DateTime.makeUnsafe(childUpdatedAt),
            },
    });
    if (state === null || state.phase === "stale") continue;
    rows.push({
      key: JSON.stringify([input.environmentId, thread.id]),
      slot: `task:${input.environmentId}/${thread.id}`,
      phase: state.phase,
      status: state.headline,
      threadTitle: state.threadTitle,
      projectTitle: state.projectTitle,
      updatedAt: state.updatedAt,
      deepLink: state.deepLink,
    });
  }
  return rows;
}

const isAttention = (phase: AgentAwarenessPhase) =>
  phase === "waiting_for_approval" || phase === "waiting_for_input";
const isTerminal = (phase: AgentAwarenessPhase) => phase === "completed" || phase === "failed";

function allowed(preferences: LocalAgentAlertPreferences, phase: AgentAwarenessPhase) {
  switch (phase) {
    case "waiting_for_approval":
      return preferences.notifyOnApproval;
    case "waiting_for_input":
      return preferences.notifyOnInput;
    case "completed":
      return preferences.notifyOnCompletion;
    case "failed":
      return preferences.notifyOnFailure;
    default:
      return false;
  }
}

export interface LocalAlertDecision {
  /** Alert now: approvals, questions and failures. */
  readonly rows: ReadonlyArray<LocalAgentRow>;
  /** Alert after COMPLETION_CONFIRM_MS unless the thread moves on first. */
  readonly completions: ReadonlyArray<LocalAgentRow>;
}

/** Rows to alert for between two observations. A missing baseline is a replay, so it never alerts. */
export function localAlertRows(input: {
  readonly previous: ReadonlyMap<string, AgentAwarenessPhase> | null;
  readonly next: ReadonlyArray<LocalAgentRow>;
  readonly preferences: LocalAgentAlertPreferences;
  readonly nowMs: number;
}): LocalAlertDecision {
  if (input.previous === null) return { rows: [], completions: [] };
  const rows: LocalAgentRow[] = [];
  const completions: LocalAgentRow[] = [];
  for (const row of input.next) {
    if (!allowed(input.preferences, row.phase)) continue;
    const before = input.previous.get(row.key);
    if (isAttention(row.phase)) {
      if (before === undefined || !isAttention(before)) rows.push(row);
      continue;
    }
    if (!isTerminal(row.phase) || before === undefined || isTerminal(before)) continue;
    const updatedAt = Date.parse(row.updatedAt);
    if (Number.isNaN(updatedAt) || input.nowMs - updatedAt > TERMINAL_FRESHNESS_MS) continue;
    (row.phase === "completed" ? completions : rows).push(row);
  }
  // Attention first, like the relay's alert ordering.
  rows.sort((a, b) => Number(isAttention(b.phase)) - Number(isAttention(a.phase)));
  return { rows, completions };
}

/** What a thread's card says: its state first, since a notification shade cuts a title's end. */
const CARD_TEXT: Partial<
  Record<
    AgentAwarenessPhase,
    { readonly state: string; readonly label: string; readonly body: string }
  >
> = {
  waiting_for_approval: {
    state: "approval",
    label: "Needs approval",
    body: "Waiting for you to approve a step.",
  },
  waiting_for_input: { state: "answer", label: "Needs answer", body: "Waiting for your answer." },
  completed: { state: "done", label: "Done", body: "The run finished." },
  failed: { state: "failed", label: "Failed", body: "The run failed." },
};

/** A relay-shaped FCM data payload for the native renderer, which dedupes by `alert_id`. */
export function localAlertPayload(input: {
  readonly row: LocalAgentRow;
  readonly deviceId: string;
  readonly userId: string;
  readonly nowMs: number;
}): Record<string, string> | null {
  const { row } = input;
  const text = CARD_TEXT[row.phase];
  if (text === undefined) return null;
  return {
    t3_kind: "agent_activity",
    device_id: input.deviceId,
    user_id: input.userId,
    updated_at: String(input.nowMs),
    alert_id: `${row.key}|${row.phase}|${row.updatedAt}`,
    alert_title: `${text.label} · ${row.threadTitle}`,
    alert_body: text.body,
    alert_path: row.deepLink,
    alert_slot: row.slot,
    alert_state: text.state,
    alert_task: row.threadTitle,
    // This device knows the state but not what the agent said; a server's account outranks it.
    alert_generic: "1",
  };
}
