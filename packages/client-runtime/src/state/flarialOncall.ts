import type { EnvironmentThreadShell } from "./models.ts";

// This personal fork's quiet policy belongs to one project on one environment.
const FLARIAL_ONCALL_SCOPE = {
  environmentId: "1c41a451-71b9-42b2-a8a5-3bcc7d95ac4a",
  projectId: "c351dd77-7e1c-4ca7-aa65-3abb1fe95499",
} as const;

export function isRoutineFlarialOncall(thread: EnvironmentThreadShell): boolean {
  if (
    thread.environmentId !== FLARIAL_ONCALL_SCOPE.environmentId ||
    thread.projectId !== FLARIAL_ONCALL_SCOPE.projectId
  ) {
    return false;
  }
  if (
    thread.pinnedAt !== null ||
    thread.source.pendingRuntimeRequest !== null ||
    thread.pendingSubagentRequest != null ||
    (thread.pendingGuestMessageCount ?? 0) > 0 ||
    thread.hasActionableProposedPlan ||
    thread.blockedOnThreadWait ||
    thread.source.activityRunStatus === "waiting" ||
    thread.source.latestRunStopRequested === true ||
    thread.source.lastError
  ) {
    return false;
  }
  switch (thread.source.status) {
    case "preparing":
    case "queued":
    case "starting":
    case "running":
    case "completed":
      return true;
    default:
      return false;
  }
}

export function withRoutineFlarialOncallThreads(
  listed: ReadonlyArray<EnvironmentThreadShell>,
  loaded: ReadonlyArray<EnvironmentThreadShell>,
): ReadonlyArray<EnvironmentThreadShell> {
  const hidden = loaded.filter(isRoutineFlarialOncall);
  if (hidden.length === 0) return listed;
  const keys = new Set(listed.map((thread) => `${thread.environmentId}:${thread.id}`));
  return [
    ...listed,
    ...hidden.filter((thread) => !keys.has(`${thread.environmentId}:${thread.id}`)),
  ];
}
