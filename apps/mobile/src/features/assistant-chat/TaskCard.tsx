import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { Pressable, View } from "react-native";

import type { AppSymbolName } from "../../components/ui/AppSymbol";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { useProject, useThreadShell } from "../../state/entities";
import { useRemoteConnectionStatus } from "../../state/use-remote-environment-registry";
import { resolveThreadListV2Status } from "../threads/threadListV2";
import { taskMeta, type TaskOrigin } from "./task-details";

type TaskStatus = ReturnType<typeof resolveThreadListV2Status> | "opening" | "stopped";

/** What a card marks in the chat: the task starting, ending, or an update about it. */
export type TaskMoment =
  | "started"
  | "ended"
  | "done"
  | "question"
  | "approval"
  | "failed"
  | "stopped";

const ATTENTION = {
  pill: "bg-warning",
  text: "text-warning-foreground",
  tint: "accent-warning-foreground",
};
const NEUTRAL = { pill: "bg-grouped-card", text: "text-foreground", tint: "accent-foreground" };

const TASK_STATUS: Readonly<
  Record<
    TaskStatus,
    { label: string; icon: AppSymbolName; pill: string; text: string; tint: string }
  >
> = {
  working: {
    label: "Working",
    icon: "clock",
    pill: "bg-update",
    text: "text-update-foreground",
    tint: "accent-update-foreground",
  },
  approval: { label: "Needs approval", icon: "exclamationmark.shield", ...ATTENTION },
  input: { label: "Needs your answer", icon: "questionmark.bubble", ...ATTENTION },
  request: { label: "Has a request", icon: "questionmark.bubble", ...ATTENTION },
  limited: { label: "Usage limit", icon: "pause", ...ATTENTION },
  failed: {
    label: "Failed",
    icon: "exclamationmark.circle",
    pill: "bg-danger",
    text: "text-danger-foreground",
    tint: "accent-danger-foreground",
  },
  ready: { label: "Done", icon: "checkmark.circle", ...NEUTRAL },
  waiting: { label: "Waiting", icon: "clock", ...NEUTRAL },
  stopped: { label: "Stopped", icon: "stop.fill", ...NEUTRAL },
  opening: {
    label: "Opening…",
    icon: "clock",
    pill: "bg-grouped-card",
    text: "text-foreground-muted",
    tint: "accent-foreground-muted",
  },
};

// How the task stood at a card's moment, shown until this device has the thread itself.
const MOMENT_STATUS: Readonly<Record<TaskMoment, TaskStatus>> = {
  started: "opening",
  ended: "opening",
  done: "ready",
  question: "input",
  approval: "approval",
  failed: "failed",
  stopped: "stopped",
};

// An earlier card says what happened then, in the past tense, and never asks for attention.
const MOMENT_RECORD: Readonly<Record<TaskMoment, { label: string; icon: AppSymbolName }>> = {
  started: { label: "Started", icon: "play" },
  ended: { label: "Ended", icon: "checkmark.circle" },
  done: { label: "Done", icon: "checkmark.circle" },
  question: { label: "Asked a question", icon: "questionmark.bubble" },
  approval: { label: "Asked for approval", icon: "exclamationmark.shield" },
  failed: { label: "Failed", icon: "exclamationmark.circle" },
  stopped: { label: "Stopped", icon: "stop.fill" },
};

/**
 * A T3 thread the assistant started or reported on. The whole card opens the native thread.
 * A task's newest card shows its status now; `compact` is the one-line record its earlier
 * cards become, so one task never shows the same card twice.
 */
export function TaskCard(props: {
  readonly threadId: string;
  /** Candidates in order: the machine the launch named, then the chat's. */
  readonly environmentIds: readonly [string | null, string];
  readonly onOpen: (environmentId: string, threadId: string) => void;
  readonly moment?: TaskMoment;
  /** The task's name from the assistant, used until this device has the thread. */
  readonly title?: string | null;
  /** What the assistant knows of the task's project, machine and model, until this device does. */
  readonly project?: string | null;
  readonly machine?: string | null;
  readonly model?: string | null;
  readonly origin?: TaskOrigin | null;
  readonly compact?: boolean;
}) {
  const threadId = ThreadId.make(props.threadId);
  const [named, own] = props.environmentIds;
  const namedShell = useThreadShell(
    named === null ? null : scopeThreadRef(EnvironmentId.make(named), threadId),
  );
  const ownShell = useThreadShell(scopeThreadRef(EnvironmentId.make(own), threadId));
  const shell = namedShell ?? ownShell;
  const environmentId = namedShell ? named! : own;
  // Labels already on this device only; a card never fetches more.
  const project = useProject(
    shell ? scopeProjectRef(EnvironmentId.make(environmentId), shell.projectId) : null,
  );
  const machine = useRemoteConnectionStatus().connectedEnvironments.find(
    (environment) => environment.environmentId === environmentId,
  )?.environmentLabel;
  const moment = props.moment ?? "started";
  const live = shell ? resolveThreadListV2Status(shell) : null;
  // The thread's own state wins while it is active or waiting on someone. At rest it reads as
  // "Done" whether it finished, failed early or was stopped, so there the update says which.
  const status =
    TASK_STATUS[
      live === null || (live === "ready" && (moment === "failed" || moment === "stopped"))
        ? MOMENT_STATUS[moment]
        : live
    ];
  const title = shell?.title ?? props.title ?? "New task";
  // Which project, where it runs, on what and from where: the detail line every card shares.
  const meta = taskMeta({
    project: project?.title ?? props.project ?? null,
    machine: machine ?? props.machine ?? null,
    model: shell?.modelSelection.model ?? props.model ?? null,
    origin: props.origin ?? null,
  });
  const context = meta.join(" · ");
  if (props.compact) {
    const record = MOMENT_RECORD[moment];
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${record.label}.${meta.length ? ` ${meta.join(", ")}.` : ""} Open thread.`}
        onPress={() => props.onOpen(environmentId, props.threadId)}
        className="min-h-11 flex-row items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 active:opacity-80"
      >
        <SymbolView
          name={record.icon}
          size={16}
          tintColorClassName="accent-foreground-muted"
          type="monochrome"
        />
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[13px] leading-[18px] text-foreground">
            <Text className="text-[13px] leading-[18px] font-t3-bold text-foreground">
              {record.label}
            </Text>
            {` · ${title}`}
          </Text>
          {meta.length ? (
            <Text numberOfLines={1} className="text-xs leading-4 text-foreground-muted">
              {meta.join(" · ")}
            </Text>
          ) : null}
        </View>
        <SymbolView
          name="chevron.right"
          size={16}
          tintColorClassName="accent-foreground-muted"
          type="monochrome"
        />
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${status.label}.${context ? ` ${context}.` : ""} Open thread.`}
      onPress={() => props.onOpen(environmentId, props.threadId)}
      className="rounded-2xl border border-border bg-card p-4 active:opacity-80"
    >
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <View className={`flex-row items-center gap-1.5 rounded-lg px-2 py-1.5 ${status.pill}`}>
          <SymbolView
            name={status.icon}
            size={16}
            tintColorClassName={status.tint}
            type="monochrome"
          />
          <Text className={`text-[13px] leading-[18px] font-t3-medium ${status.text}`}>
            {status.label}
          </Text>
        </View>
        <Text className="text-[13px] leading-[18px] text-foreground-muted">T3 task</Text>
      </View>
      <Text
        numberOfLines={2}
        className="mt-2.5 text-base leading-[22px] font-t3-medium text-foreground"
      >
        {title}
      </Text>
      {context ? (
        <Text numberOfLines={1} className="mt-1 text-[13px] leading-[18px] text-foreground-muted">
          {context}
        </Text>
      ) : null}
      <View className="mt-3 flex-row items-center border-t border-border pt-2.5">
        <Text className="flex-1 text-sm font-t3-medium text-primary-text">Open thread</Text>
        <SymbolView
          name="chevron.right"
          size={20}
          tintColorClassName="accent-foreground-muted"
          type="monochrome"
        />
      </View>
    </Pressable>
  );
}
