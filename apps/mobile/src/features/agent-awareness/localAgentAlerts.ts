import type {
  EnvironmentId,
  OrchestrationProjectShell,
  OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { projectThreadAwarenessV2, type AgentAwarenessPhase } from "@t3tools/shared/agentAwareness";
import * as DateTime from "effect/DateTime";

/**
 * Local alerts for builds that cannot receive relay pushes. They apply the relay's own rules
 * (infra/relay/src/agentActivity/agentActivityAlerts.ts) to the shells this client already
 * streams, and render through the same native notification path, so they read the same.
 */
export interface LocalAgentRow {
  readonly key: string;
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

/** The relay's alert text for one or several rows. */
export function localAlertText(rows: ReadonlyArray<LocalAgentRow>) {
  const first = rows[0];
  if (!first) return null;
  if (rows.length === 1)
    return { title: first.threadTitle, body: `${first.status}: ${first.projectTitle}` };
  return {
    title: `${rows.length} agents ${isAttention(first.phase) ? "need attention" : "finished"}`,
    body: rows.map((row) => row.threadTitle).join(", "),
  };
}

/** A relay-shaped FCM data payload for the native renderer, which dedupes by `alert_id`. */
export function localAlertPayload(input: {
  readonly rows: ReadonlyArray<LocalAgentRow>;
  readonly deviceId: string;
  readonly userId: string;
  readonly nowMs: number;
}): Record<string, string> | null {
  const text = localAlertText(input.rows);
  const first = input.rows[0];
  if (text === null || first === undefined) return null;
  return {
    t3_kind: "agent_activity",
    device_id: input.deviceId,
    user_id: input.userId,
    updated_at: String(input.nowMs),
    alert_id: input.rows.map((row) => `${row.key}|${row.phase}|${row.updatedAt}`).join("\n"),
    alert_title: text.title,
    alert_body: text.body,
    alert_path: first.deepLink,
  };
}
