import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { Pressable, View } from "react-native";

import type { AppSymbolName } from "../../components/ui/AppSymbol";
import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { useProject, useThreadShell } from "../../state/entities";
import { useRemoteConnectionStatus } from "../../state/use-remote-environment-registry";
import { resolveThreadListV2Status } from "../threads/threadListV2";

type TaskStatus = ReturnType<typeof resolveThreadListV2Status> | "opening";

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
  opening: {
    label: "Opening…",
    icon: "clock",
    pill: "bg-grouped-card",
    text: "text-foreground-muted",
    tint: "accent-foreground-muted",
  },
};

/** A T3 thread the assistant started. The whole card opens the native thread. */
export function TaskCard(props: {
  readonly threadId: string;
  /** Candidates in order: the machine the launch named, then the chat's. */
  readonly environmentIds: readonly [string | null, string];
  readonly onOpen: (environmentId: string, threadId: string) => void;
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
  const status = TASK_STATUS[shell ? resolveThreadListV2Status(shell) : "opening"];
  const title = shell?.title ?? "New task";
  const context = [project?.title, machine].filter(Boolean).join(" · ");
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
        <View className="mt-1.5 flex-row items-center gap-1.5">
          <SymbolView
            name="folder"
            size={14}
            tintColorClassName="accent-foreground-muted"
            type="monochrome"
          />
          <Text
            numberOfLines={1}
            className="min-w-0 flex-1 text-[13px] leading-[18px] text-foreground-muted"
          >
            {context}
          </Text>
        </View>
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
