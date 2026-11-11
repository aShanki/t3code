import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { makeRawThreadShell } from "../../test-fixtures";
import {
  COMPLETION_CONFIRM_MS,
  DEFAULT_LOCAL_ALERT_PREFERENCES,
  localAgentRows,
  localAlertPayload,
  localAlertRows,
  type LocalAgentRow,
} from "./localAgentAlerts";

const environmentId = EnvironmentId.make("env");
const projects = [{ id: ProjectId.make("project-test"), title: "Website" }];
const now = Date.parse("2026-11-11T12:00:00.000Z");

const thread = (id: string, input: Partial<OrchestrationV2ThreadShell>) =>
  makeRawThreadShell({
    id: ThreadId.make(id),
    title: `Task ${id}`,
    updatedAt: DateTime.makeUnsafe(now - 1_000),
    ...input,
  });

const phases = (rows: ReadonlyArray<LocalAgentRow>) =>
  new Map(rows.map((row) => [row.key, row.phase] as const));

describe("local agent alerts", () => {
  it("alerts like the relay: attention on entry, completion once confirmed and fresh", () => {
    const running = localAgentRows({
      environmentId,
      projects,
      threads: [thread("a", { status: "running" }), thread("b", { status: "running" })],
    });
    const next = localAgentRows({
      environmentId,
      projects,
      threads: [
        thread("a", {
          status: "running",
          pendingRuntimeRequest: {
            kind: "command",
          } as OrchestrationV2ThreadShell["pendingRuntimeRequest"],
        }),
        thread("b", { status: "completed" }),
      ],
    });
    const decision = localAlertRows({
      previous: phases(running),
      next,
      preferences: DEFAULT_LOCAL_ALERT_PREFERENCES,
      nowMs: now,
    });
    expect(decision.rows.map((row) => [row.threadTitle, row.status])).toEqual([
      ["Task a", "Approval needed"],
    ]);
    // Completions wait COMPLETION_CONFIRM_MS natively, as the relay holds them.
    expect(decision.completions.map((row) => row.status)).toEqual(["Agent finished"]);
    expect(COMPLETION_CONFIRM_MS).toBe(5_000);
    const confirmed = { rows: [...decision.rows, ...decision.completions] };

    const payload = localAlertPayload({
      rows: confirmed.rows,
      deviceId: "device",
      userId: "local",
      nowMs: now,
    });
    expect(payload).toMatchObject({
      t3_kind: "agent_activity",
      device_id: "device",
      user_id: "local",
      alert_title: "2 agents need attention",
      alert_body: "Task a, Task b",
      alert_path: "/threads/env/a",
    });
  });

  it("stays quiet on a replay, an unobserved finish, a stale finish, and disabled kinds", () => {
    const done = localAgentRows({
      environmentId,
      projects,
      threads: [thread("c", { status: "completed" })],
    });
    const base = { next: done, preferences: DEFAULT_LOCAL_ALERT_PREFERENCES, nowMs: now };
    const alerted = (input: Parameters<typeof localAlertRows>[0]) => {
      const decision = localAlertRows(input);
      return [...decision.rows, ...decision.completions];
    };
    expect(alerted({ ...base, previous: null })).toEqual([]);
    expect(alerted({ ...base, previous: new Map() })).toEqual([]);
    const wasRunning = new Map([[done[0]!.key, "running" as const]]);
    expect(alerted({ ...base, previous: wasRunning })).toHaveLength(1);
    expect(alerted({ ...base, previous: wasRunning, nowMs: now + 10 * 60 * 1_000 })).toEqual([]);
    expect(
      alerted({
        ...base,
        previous: wasRunning,
        preferences: { ...DEFAULT_LOCAL_ALERT_PREFERENCES, notifyOnCompletion: false },
      }),
    ).toEqual([]);
  });

  it("skips subagents and archived threads, and lifts a child's approval to its parent", () => {
    const child = thread("child", {
      lineage: {
        rootThreadId: ThreadId.make("parent"),
        parentThreadId: ThreadId.make("parent"),
        relationshipToParent: "subagent",
      },
      status: "running",
    });
    const rows = localAgentRows({
      environmentId,
      projects,
      threads: [
        child,
        thread("parent", { status: "completed" }),
        thread("old", { status: "running", archivedAt: DateTime.makeUnsafe(now) }),
      ],
      childApprovals: new Map([["parent", new Date(now).toISOString()]]),
    });
    expect(rows.map((row) => [row.threadTitle, row.phase])).toEqual([
      ["Task parent", "waiting_for_approval"],
    ]);
  });
});
