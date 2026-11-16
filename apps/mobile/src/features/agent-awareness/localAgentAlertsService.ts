import { enabledEnvironmentIds } from "@t3tools/client-runtime/state/connections";
import type { EnvironmentId, OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import { subagentAwaitsApproval, type AgentAwarenessPhase } from "@t3tools/shared/agentAwareness";
import * as DateTime from "effect/DateTime";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";

import { environmentCatalog } from "../../connection/catalog";
import { isPersonalFork } from "../../lib/personalFork";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom } from "../../state/preferences";
import { threadEnvironment } from "../../state/threads";
import { rajeshPushStatusAtom } from "../assistant-chat/rajesh/rajesh-push";
import {
  cancelLocalAndroidAgentAlert,
  receiveLocalAndroidAgentAlert,
  receiveLocalAndroidAgentAlertLater,
  setAndroidBackgroundConnection,
} from "./androidNotifications";
import {
  COMPLETION_CONFIRM_MS,
  DEFAULT_LOCAL_ALERT_PREFERENCES,
  localAgentRows,
  localAlertPayload,
  localAlertRows,
  type LocalAgentRow,
} from "./localAgentAlerts";

const LOCAL_DEVICE_ID = "local-alerts";
const LOCAL_USER_ID = "local";
/**
 * Rajesh pushes its own account of a task's question, finish or failure, usually within 15
 * seconds and with what the agent said. This device's alert waits this long for it, and shows
 * only when none came. An approval never waits: the agent is blocked until the user acts.
 */
const RAJESH_ACCOUNT_WAIT_MS = 45_000;

interface LocalAlertInputs {
  readonly enabled: boolean;
  readonly snapshots: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly snapshot: OrchestrationV2ShellSnapshot | null;
  }>;
}

const localAlertInputsAtom = Atom.make((get): LocalAlertInputs => {
  const preferences = get(mobilePreferencesAtom);
  const enabled =
    !AsyncResult.isSuccess(preferences) || preferences.value.localAgentAlertsEnabled !== false;
  const catalog = get(environmentCatalog.catalogValueAtom);
  return {
    enabled,
    snapshots: Array.from(enabledEnvironmentIds(catalog), (environmentId) => ({
      environmentId,
      snapshot: get(threadEnvironment.snapshotAtom(environmentId)),
    })),
  };
}).pipe(Atom.withLabel("mobile:local-agent-alerts:inputs"));

/** Top-level threads whose subagent waits on an approval, as the relay republishes them. */
function childApprovals(snapshot: OrchestrationV2ShellSnapshot): ReadonlyMap<string, string> {
  const approvals = new Map<string, string>();
  for (const thread of snapshot.threads) {
    if (thread.archivedAt !== null || !subagentAwaitsApproval(thread)) continue;
    const root = thread.lineage.rootThreadId;
    const updatedAt = DateTime.formatIso(thread.updatedAt);
    const current = approvals.get(root);
    if (current === undefined || current < updatedAt) approvals.set(root, updatedAt);
  }
  return approvals;
}

/**
 * Personal forks cannot receive T3's relay pushes, so they raise the same alerts from the
 * environment streams this app already holds. A foreground service keeps those connections
 * open while the app is in the background; it is started only while the app is in front,
 * as Android requires.
 */
export function installLocalAgentAlerts(): () => void {
  if (Platform.OS !== "android" || !isPersonalFork) return () => {};

  // Per environment: absent until its first snapshot, which is a replay and never alerts.
  const previous = new Map<EnvironmentId, ReadonlyMap<string, AgentAwarenessPhase>>();
  // Alerts waiting natively, by card, with the phase each reports.
  const held = new Map<string, AgentAwarenessPhase>();
  let enabled = true;
  let environmentCount = 0;
  let permissionRequested = false;

  const observe = (
    observations: ReadonlyArray<{ environmentId: EnvironmentId; rows: readonly LocalAgentRow[] }>,
  ) => {
    const nowMs = Date.now();
    const rajeshWaitMs =
      appAtomRegistry.get(rajeshPushStatusAtom) === "on" ? RAJESH_ACCOUNT_WAIT_MS : 0;
    const alert = (row: LocalAgentRow, delayMs: number) => {
      const payload = localAlertPayload({
        row,
        deviceId: LOCAL_DEVICE_ID,
        userId: LOCAL_USER_ID,
        nowMs: nowMs + delayMs,
      });
      if (payload === null) return;
      if (delayMs === 0) {
        receiveLocalAndroidAgentAlert(payload);
        return;
      }
      held.set(row.slot, row.phase);
      receiveLocalAndroidAgentAlertLater(payload, delayMs, row.slot);
    };
    for (const { environmentId, rows } of observations) {
      const decision = localAlertRows({
        previous: previous.get(environmentId) ?? null,
        next: rows,
        preferences: DEFAULT_LOCAL_ALERT_PREFERENCES,
        nowMs,
      });
      previous.set(environmentId, new Map(rows.map((row) => [row.key, row.phase])));
      if (!enabled) continue;
      for (const row of decision.rows) {
        alert(row, row.phase === "waiting_for_approval" ? 0 : rajeshWaitMs);
      }
      for (const row of decision.completions) {
        alert(row, Math.max(COMPLETION_CONFIRM_MS, rajeshWaitMs));
      }
    }
    // A run can end moments before its continuation; drop a held alert once its thread moves on.
    const phases = new Map(
      observations.flatMap(({ rows }) => rows.map((row) => [row.slot, row.phase] as const)),
    );
    for (const [slot, phase] of held) {
      if (phases.get(slot) !== phase) {
        held.delete(slot);
        cancelLocalAndroidAgentAlert(slot);
      }
    }
  };

  const syncBackgroundConnection = () => {
    if (!enabled || environmentCount === 0) {
      setAndroidBackgroundConnection(false, "");
      return;
    }
    // Android refuses to start a foreground service from the background.
    if (AppState.currentState !== "active") return;
    if (!permissionRequested) {
      permissionRequested = true;
      void Notifications.getPermissionsAsync()
        .then((status) =>
          status.granted || !status.canAskAgain ? status : Notifications.requestPermissionsAsync(),
        )
        .catch(() => undefined);
    }
    setAndroidBackgroundConnection(
      true,
      `Connected to ${environmentCount} environment${environmentCount === 1 ? "" : "s"}`,
    );
  };

  const stopInputs = appAtomRegistry.subscribe(
    localAlertInputsAtom,
    (inputs) => {
      enabled = inputs.enabled;
      environmentCount = inputs.snapshots.length;
      const observations = inputs.snapshots.flatMap(({ environmentId, snapshot }) =>
        snapshot === null
          ? []
          : [
              {
                environmentId,
                rows: localAgentRows({
                  environmentId,
                  threads: snapshot.threads,
                  projects: snapshot.projects,
                  childApprovals: childApprovals(snapshot),
                }),
              },
            ],
      );
      for (const environmentId of previous.keys()) {
        if (!inputs.snapshots.some((entry) => entry.environmentId === environmentId)) {
          previous.delete(environmentId);
        }
      }
      observe(observations);
      syncBackgroundConnection();
    },
    { immediate: true },
  );
  const appState = AppState.addEventListener("change", syncBackgroundConnection);

  return () => {
    stopInputs();
    appState.remove();
    for (const slot of held.keys()) cancelLocalAndroidAgentAlert(slot);
    setAndroidBackgroundConnection(false, "");
  };
}
