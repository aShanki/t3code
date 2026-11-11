import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ThreadId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { parseThreadLinkHref } from "@t3tools/shared/threadLinks";
import { useState } from "react";
import { FlatList, Linking, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { makeQueuedMessageMetadata } from "../../lib/commandMetadata";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { SelectableMarkdownText } from "../../native/SelectableMarkdownText";
import type { AssistantChat } from "../../persistence/mobile-preferences";
import { useProjects, useThreadShell } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { enqueueThreadOutboxMessage, type QueuedThreadMessage } from "../../state/thread-outbox";
import {
  environmentThreadDetails,
  threadEnvironment,
  useEnvironmentThread,
} from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  createNewTaskDraft,
  setComposerDraftText,
  waitForComposerDraftsLoaded,
} from "../../state/use-composer-drafts";
import {
  useRemoteConnectionStatus,
  useRemoteEnvironmentRuntime,
} from "../../state/use-remote-environment-registry";
import { useThreadOutboxMessages } from "../../state/use-thread-outbox";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { openSettings } from "../settings/settings-navigation";
import { useMarkdownStyles } from "../threads/ThreadFeed";
import { resolveThreadListV2Status } from "../threads/threadListV2";
import {
  ASSISTANT_CHAT_PRIMER,
  buildAssistantChatEntries,
  type AssistantChatEntry,
} from "./assistant-chat-entries";
import { useAssistantChat, useForgetAssistantChat, useRajeshChat } from "./assistant-chat-state";
import { RajeshChatScreen, RajeshConnect } from "./rajesh/RajeshChatScreen";
import { TaskCard } from "./TaskCard";
import { useKeyboardOverlap } from "./use-keyboard-overlap";

/** The Chat tab: one persistent assistant thread shown as a conversation. */
export function ChatTabScreen() {
  const chat = useAssistantChat();
  const rajesh = useRajeshChat();
  const [useT3Thread, setUseT3Thread] = useState(false);
  if (chat === undefined || rajesh === undefined) {
    return (
      <View className="flex-1 bg-screen">
        <AppBar title="Chat" />
        <View className="flex-1 items-center justify-center">
          <AppActivityIndicator />
        </View>
      </View>
    );
  }
  if (rajesh !== null)
    return <RajeshChatScreen key={rajesh.baseUrl + rajesh.taskKey} chat={rajesh} />;
  if (chat === null && !useT3Thread) {
    return (
      <View className="flex-1 bg-screen">
        <AppBar title="Chat" />
        <RajeshConnect onCancel={() => setUseT3Thread(true)} />
      </View>
    );
  }
  return chat === null ? (
    <AssistantChatSetup />
  ) : (
    <AssistantChatConversation key={`${chat.environmentId}:${chat.threadId}`} chat={chat} />
  );
}

function useOpenThread() {
  const selectDetail = useSelectWorkspaceDetail();
  return (environmentId: string, threadId: string) =>
    selectDetail({ name: "Thread", params: { environmentId, threadId, returnTab: "chat" } });
}

function AssistantChatSetup() {
  const navigation = useNavigation();
  const selectDetail = useSelectWorkspaceDetail();
  const openScratch = useAtomCommand(projectEnvironment.openScratch, { reportFailure: false });
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const projects = useProjects();
  const environments = connectedEnvironments.filter(
    (environment) => environment.isEnabled && environment.connectionState === "connected",
  );
  const [starting, setStarting] = useState<EnvironmentId | null>(null);

  const start = async (environmentId: EnvironmentId) => {
    setStarting(environmentId);
    const draft = await prepareAssistantDraft(environmentId);
    setStarting(null);
    if (draft === null) return;
    // The draft screen picks the model; sending it makes the thread this tab's chat.
    selectDetail({
      name: "Thread",
      params: {
        draft: {
          environmentId,
          projectId: draft.projectId,
          title: "Assistant",
          draftId: draft.draftId,
          purpose: "assistant-chat",
        },
        returnTab: "chat",
      },
    });
  };

  const prepareAssistantDraft = async (environmentId: EnvironmentId) => {
    // The chat needs a working folder, not a codebase: prefer No project, else any project here.
    // The draft screen still lets the user pick another project and the model.
    const scratch = await openScratch({ environmentId, input: {} });
    const fallback = projects.find((project) => project.environmentId === environmentId);
    if (scratch._tag === "Failure" && (isAtomCommandInterrupted(scratch) || !fallback)) {
      if (!isAtomCommandInterrupted(scratch)) {
        const failure = squashAtomCommandFailure(scratch);
        Dialog.alert(
          "Could not start the chat",
          failure instanceof Error ? failure.message : "This machine cannot start a thread here.",
        );
      }
      return null;
    }
    const projectId = scratch._tag === "Success" ? scratch.value.id : fallback!.id;
    const loaded = await waitForComposerDraftsLoaded().then(
      () => true,
      () => false,
    );
    if (!loaded) {
      Dialog.alert("Could not start the chat", "Drafts could not be loaded.");
      return null;
    }
    const draftId = createNewTaskDraft({ environmentId, projectId });
    setComposerDraftText(draftId, ASSISTANT_CHAT_PRIMER);
    return { projectId, draftId };
  };

  return (
    <View className="flex-1 bg-screen">
      <AppBar title="Chat" />
      <View className="flex-1 justify-center gap-4 px-6">
        <Text className="text-xl font-t3-bold text-foreground">Your assistant chat</Text>
        <Text className="text-base text-foreground-secondary">
          One persistent conversation with an agent on your T3 Code server. Ask it for work and it
          starts each task as its own thread, shown here as a card that opens the thread.
        </Text>
        {environments.length === 0 ? (
          <>
            <Text className="text-sm text-foreground-muted">
              Connect to a T3 Code environment first.
            </Text>
            <Button
              label="Manage environments"
              onPress={() => openSettings(navigation, "SettingsEnvironments")}
            />
          </>
        ) : (
          environments.map((environment) => (
            <Button
              key={environment.environmentId}
              tone="contrast"
              label={
                starting === environment.environmentId
                  ? "Opening…"
                  : environments.length === 1
                    ? "Start assistant chat"
                    : `Start on ${environment.environmentLabel}`
              }
              disabled={starting !== null}
              onPress={() => void start(environment.environmentId)}
            />
          ))
        )}
      </View>
    </View>
  );
}

function AssistantChatConversation(props: { readonly chat: AssistantChat }) {
  const environmentId = EnvironmentId.make(props.chat.environmentId);
  const threadId = ThreadId.make(props.chat.threadId);
  const ref = scopeThreadRef(environmentId, threadId);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardOverlap();
  const forget = useForgetAssistantChat();
  const openThread = useOpenThread();
  const state = useEnvironmentThread(environmentId, threadId);
  const items = useAtomValue(environmentThreadDetails.timelineVisibleTurnItemsAtom(ref));
  const shell = useThreadShell(ref);
  const connected = useRemoteEnvironmentRuntime(environmentId)?.connectionState === "connected";
  const queued = useThreadOutboxMessages()[scopedThreadKey(environmentId, threadId)] ?? [];
  const loadEarlierHistory = useAtomCommand(threadEnvironment.loadEarlierHistory, {
    label: "load earlier chat history",
    reportFailure: false,
  });
  const entries = buildAssistantChatEntries(items, props.chat.primerMessageId);
  // The list is inverted so it stays pinned to the newest message.
  const rows: ReadonlyArray<ChatRow> = [
    ...queued.map((message) => ({ kind: "queued" as const, id: message.messageId, message })),
    ...[...entries].reverse(),
  ];
  const status = shell ? resolveThreadListV2Status(shell) : null;
  const working = status === "working" || status === "waiting";
  const needsAttention = status === "approval" || status === "input";
  const startNewChat = () =>
    Dialog.confirm({
      title: "Start a new assistant chat?",
      message: "This chat stays in Threads. The Chat tab will show the new one.",
      confirmText: "Start new",
      onConfirm: () => void forget(),
    });

  if (state.status === "deleted") {
    return (
      <View className="flex-1 bg-screen">
        <AppBar title="Chat" />
        <View className="flex-1 justify-center gap-4 px-6">
          <Text className="text-base text-foreground-secondary">
            This chat's thread was deleted.
          </Text>
          <Button tone="contrast" label="Start a new chat" onPress={() => void forget()} />
        </View>
      </View>
    );
  }

  return (
    <View
      onLayout={keyboard.onLayout}
      className="flex-1 bg-screen"
      style={{ paddingBottom: keyboard.overlap }}
    >
      <AppBar title="Chat" />
      <View className="flex-row items-center gap-2 border-b border-border-subtle px-4 py-1.5">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open the full assistant thread"
          onPress={() => openThread(environmentId, threadId)}
          className="min-w-0 flex-1 py-1"
        >
          <Text numberOfLines={1} className="text-sm font-t3-medium text-foreground">
            {shell?.title ?? "Assistant"}
          </Text>
          <Text className="text-xs text-foreground-muted">Open full thread</Text>
        </Pressable>
        <Button size="compact" tone="text" label="New chat" onPress={startNewChat} />
      </View>
      <FlatList
        inverted
        className="flex-1"
        data={rows}
        keyExtractor={(row) => row.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}
        renderItem={({ item: row }) =>
          row.kind === "queued" ? (
            <QueuedMessageRow message={row.message} connected={connected} />
          ) : row.kind === "task" ? (
            <TaskCard
              threadId={row.threadId}
              environmentIds={[row.environmentId, props.chat.environmentId]}
              onOpen={openThread}
            />
          ) : (
            <MessageRow chatRef={ref} entry={row} onOpenThread={openThread} />
          )
        }
        ListHeaderComponent={
          needsAttention ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => openThread(environmentId, threadId)}
              className="rounded-2xl border border-border bg-card px-4 py-3"
            >
              <Text className="text-sm font-t3-medium text-foreground">
                {status === "approval" ? "The assistant needs approval" : "The assistant asked you"}
              </Text>
              <Text className="text-xs text-foreground-muted">Open the thread to respond</Text>
            </Pressable>
          ) : working ? (
            <View className="flex-row items-center gap-2 py-1">
              <AppActivityIndicator size="small" />
              <Text className="text-sm text-foreground-muted">Working…</Text>
            </View>
          ) : undefined
        }
        ListFooterComponent={
          state.history.hasMoreHistory || state.history.error !== null ? (
            <View className="items-center py-2">
              <Button
                size="compact"
                tone="text"
                label={state.history.loading ? "Loading…" : "Load earlier messages"}
                disabled={state.history.loading}
                onPress={() => void loadEarlierHistory({ environmentId, input: { threadId } })}
              />
            </View>
          ) : state.status === "empty" || state.status === "synchronizing" ? (
            rows.length === 0 ? (
              <View className="items-center py-8">
                <AppActivityIndicator />
              </View>
            ) : undefined
          ) : undefined
        }
      />
      <ChatComposer
        environmentId={environmentId}
        threadId={threadId}
        busy={working || needsAttention}
        bottomInset={insets.bottom}
      />
    </View>
  );
}

type ChatRow =
  | AssistantChatEntry
  | { readonly kind: "queued"; readonly id: string; readonly message: QueuedThreadMessage };

function chatLinkPressHandler(
  environmentId: string,
  onOpenThread: (environmentId: string, threadId: string) => void,
) {
  return (href: string) => {
    const link = parseThreadLinkHref(href);
    if (link) {
      onOpenThread(link.environmentId ?? environmentId, link.threadId);
      return;
    }
    if (/^https?:\/\//i.test(href)) void Linking.openURL(href).catch(() => {});
  };
}

function MessageRow(props: {
  readonly chatRef: ScopedThreadRef;
  readonly entry: Extract<AssistantChatEntry, { kind: "message" }>;
  readonly onOpenThread: (environmentId: string, threadId: string) => void;
}) {
  const { entry } = props;
  const styles = useMarkdownStyles();
  const onLinkPress = chatLinkPressHandler(props.chatRef.environmentId, props.onOpenThread);
  const [expanded, setExpanded] = useState(false);
  // Streaming text arrives on its own atom so only this row re-renders per chunk.
  const liveText = useAtomValue(
    environmentThreadDetails.assistantMessageTextAtom(props.chatRef, entry.id),
  );
  const text = entry.role === "assistant" ? (liveText ?? entry.text) : entry.text;

  if (entry.primer) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        className="self-center rounded-full bg-subtle px-3 py-1"
      >
        <Text className="text-xs text-foreground-muted">
          {expanded ? text : "Assistant instructions · tap to show"}
        </Text>
      </Pressable>
    );
  }
  if (entry.role === "assistant") {
    return (
      <View className="pr-6">
        <SelectableMarkdownText
          markdown={text}
          textStyle={styles.assistant.nativeTextStyle}
          onLinkPress={onLinkPress}
        />
      </View>
    );
  }
  const sender = entry.senderThreadId;
  return (
    <View className="max-w-[85%] self-end gap-1">
      {sender ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => props.onOpenThread(props.chatRef.environmentId, sender)}
        >
          <Text className="text-right text-xs text-foreground-muted">From a task · open</Text>
        </Pressable>
      ) : null}
      <View className="rounded-[20px] bg-user-bubble px-4 py-2.5">
        <SelectableMarkdownText
          markdown={text}
          textStyle={styles.user.nativeTextStyle}
          onLinkPress={onLinkPress}
        />
      </View>
    </View>
  );
}

function QueuedMessageRow(props: {
  readonly message: QueuedThreadMessage;
  readonly connected: boolean;
}) {
  return (
    <View className="max-w-[85%] self-end gap-1 opacity-70">
      <View className="rounded-[20px] bg-user-bubble px-4 py-2.5">
        <Text className="text-base text-user-bubble-foreground">{props.message.text}</Text>
      </View>
      <Text className="text-right text-xs text-foreground-muted">
        {props.connected ? "Sending…" : "Waiting for connection"}
      </Text>
    </View>
  );
}

function ChatComposer(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly busy: boolean;
  readonly bottomInset: number;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const send = async () => {
    const message = text.trim();
    if (message === "" || sending) return;
    setSending(true);
    const metadata = makeQueuedMessageMetadata();
    // The outbox persists the message and delivers it once the environment reconnects.
    const error = await enqueueThreadOutboxMessage({
      environmentId: props.environmentId,
      threadId: props.threadId,
      messageId: MessageId.make(metadata.messageId),
      commandId: CommandId.make(metadata.commandId),
      text: message,
      attachments: [],
      createdAt: metadata.createdAt,
      dispatchMode: props.busy ? "queue" : "auto",
    }).then(
      () => null,
      (cause: unknown) => cause,
    );
    setSending(false);
    if (error === null) {
      setText("");
      return;
    }
    Dialog.alert(
      "Could not send",
      error instanceof Error ? error.message : "The message could not be saved.",
    );
  };
  return (
    <View
      className="flex-row items-end gap-2 border-t border-border-subtle bg-screen px-3 pt-2"
      style={{ paddingBottom: Math.max(props.bottomInset, 8) }}
    >
      <TextInput
        accessibilityLabel="Message the assistant"
        multiline
        maxLength={120000}
        placeholder={props.busy ? "Queue a message…" : "Message the assistant…"}
        placeholderTextColorClassName="accent-foreground-muted"
        value={text}
        onChangeText={setText}
        className="max-h-36 min-h-11 min-w-0 flex-1 rounded-[22px] bg-subtle px-4 py-2.5 text-base text-foreground"
      />
      <Button
        label="Send"
        tone="contrast"
        disabled={sending || text.trim() === ""}
        onPress={() => void send()}
      />
    </View>
  );
}
