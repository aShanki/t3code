import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AppState,
  FlatList,
  Image,
  Linking,
  Pressable,
  ScrollView,
  View,
  type TextInputInstance,
} from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { parseThreadLinkHref } from "@t3tools/shared/threadLinks";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { SymbolView } from "../../../components/ui/AppSymbol";
import { AppBar } from "../../../components/ui/AppBar";
import { AppText as Text, AppTextInput as TextInput } from "../../../components/ui/AppText";
import { Button } from "../../../components/ui/Button";
import * as Dialog from "../../../components/ui/Dialog";
import { uuidv4 } from "../../../lib/uuid";
import { SelectableMarkdownText } from "../../../native/SelectableMarkdownText";
import type { RajeshChat } from "../../../persistence/mobile-preferences";
import { useSelectWorkspaceDetail } from "../../layout/workspace/useSelectWorkspaceDetail";
import { useMarkdownStyles } from "../../threads/ThreadFeed";
import { useSetRajeshChat } from "../assistant-chat-state";
import { useKeyboardOverlap } from "../use-keyboard-overlap";
import { TaskCard } from "../TaskCard";
import {
  DEFAULT_RAJESH_GATEWAY,
  listRajeshTasks,
  normalizeRajeshGateway,
  pollRajeshDevice,
  rajeshErrorStatus,
  readRajeshHistory,
  readRajeshT3Threads,
  readRajeshToken,
  readRajeshUpdates,
  sendRajeshMessage,
  startRajeshDevice,
  writeRajeshToken,
  type RajeshDeviceLogin,
  type RajeshFile,
} from "./rajesh-gateway";
import { pickRajeshFile } from "./rajesh-attachment";
import { resetRajeshDeviceKey } from "./rajesh-device-key";
import {
  buildRajeshChatEntries,
  buildRajeshChatRows,
  mergeRajeshMessages,
  rajeshCursor,
  rajeshReplyText,
  rajeshUserContent,
  type RajeshChatRow,
  type RajeshMessage,
  type RajeshT3Thread,
} from "./rajesh-transcript";

const LONG_POLL_MS = 25_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Rajesh could not be reached.";

function useOpenThread() {
  const selectDetail = useSelectWorkspaceDetail();
  return (environmentId: string, threadId: string) =>
    selectDetail({ name: "Thread", params: { environmentId, threadId, returnTab: "chat" } });
}

/** Pairs this device with Rajesh through the gateway's device-code flow. */
export function RajeshConnect(props: { readonly onCancel?: () => void }) {
  const setChat = useSetRajeshChat();
  const [gateway, setGateway] = useState(DEFAULT_RAJESH_GATEWAY);
  const [login, setLogin] = useState<{ baseUrl: string; device: RajeshDeviceLogin } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [editingGateway, setEditingGateway] = useState(DEFAULT_RAJESH_GATEWAY === "");
  const [copied, setCopied] = useState(false);

  const start = async () => {
    const baseUrl = normalizeRajeshGateway(gateway);
    if (baseUrl === null) {
      setMessage("Enter the https address of your Rajesh Code gateway.");
      return;
    }
    if (connecting) return;
    setMessage(null);
    setConnecting(true);
    // Each pairing gets a new Keystore key, so no earlier session's key is reused.
    const device = await resetRajeshDeviceKey(baseUrl)
      .then(() => startRajeshDevice(baseUrl))
      .catch((error: unknown) => {
        setMessage(errorText(error));
        return null;
      });
    setConnecting(false);
    if (device !== null) setLogin({ baseUrl, device });
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the gateway until Rajesh approves the shown device code
  useEffect(() => {
    if (login === null) return;
    // Set by cleanup, which the linter cannot see from inside the loop.
    const run = { stopped: false };
    void (async () => {
      while (!run.stopped && Date.now() < login.device.expiresAt) {
        await sleep(3_000);
        if (run.stopped) return;
        const result = await pollRajeshDevice(login.baseUrl, login.device).catch(() => null);
        if (result?.status !== "approved" || !result.token) continue;
        const { tasks } = await listRajeshTasks(login.baseUrl, result.token);
        const personal = tasks.find((task) => task.key.startsWith("discord:personal:"));
        if (personal === undefined) {
          setMessage(
            "This device was approved without your personal chat. Ask Rajesh to include it.",
          );
          setLogin(null);
          return;
        }
        await writeRajeshToken(login.baseUrl, result.token);
        setChat({ baseUrl: login.baseUrl, taskKey: personal.key });
        return;
      }
      if (!run.stopped) {
        setMessage("The code expired. Connect again to get a new code.");
        setLogin(null);
      }
    })().catch((error: unknown) => {
      if (!run.stopped) setMessage(errorText(error));
    });
    return () => {
      run.stopped = true;
    };
  }, [login, setChat]);

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerClassName="grow justify-center px-6 py-8"
    >
      <View className="w-full max-w-[420px] self-center">
        <RajeshMonogram size="large" />
        {login === null ? (
          <>
            <Text className="mt-5 text-2xl leading-[30px] font-t3-bold text-foreground">
              Chat with Rajesh
            </Text>
            <Text className="mt-2 text-base leading-6 text-foreground-secondary">
              Your personal assistant, in the same conversation as your Discord DM.
            </Text>
            <Text className="mt-3 text-sm leading-5 text-foreground-muted">
              Ask for coding work and open the tasks right here.
            </Text>
            {editingGateway ? (
              <>
                <Text className="mt-6 mb-2 text-[13px] leading-[18px] font-t3-medium text-foreground">
                  Gateway address
                </Text>
                <OutlinedInput radius="rounded-2xl">
                  {(focus) => (
                    <TextInput
                      {...focus}
                      accessibilityLabel="Rajesh Code gateway address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      value={gateway}
                      onChangeText={setGateway}
                      className="min-h-12 flex-1 rounded-none border-0 bg-transparent px-3 text-base text-foreground"
                    />
                  )}
                </OutlinedInput>
              </>
            ) : null}
            {message ? (
              <Text className="mt-2 text-sm leading-5 text-danger-foreground">{message}</Text>
            ) : null}
            <View className="mt-4">
              <Button
                tone="primary"
                fullWidth
                label={connecting ? "Connecting…" : "Connect Rajesh"}
                disabled={connecting}
                onPress={() => void start()}
              />
            </View>
            {editingGateway ? null : (
              <View className="mt-3">
                <Button
                  tone="text"
                  fullWidth
                  label="Change gateway"
                  onPress={() => setEditingGateway(true)}
                />
              </View>
            )}
            {props.onCancel ? (
              <View className="mt-1">
                <Button
                  tone="text"
                  fullWidth
                  label="Use a T3 thread instead"
                  onPress={props.onCancel}
                />
              </View>
            ) : null}
          </>
        ) : (
          <>
            <Text className="mt-5 text-2xl leading-[30px] font-t3-bold text-foreground">
              Approve this device
            </Text>
            <Text className="mt-2 text-base leading-6 text-foreground-secondary">
              Send this code to Rajesh in your personal Discord DM. Once he approves it, this
              phone's secure key is the only one that can use the session.
            </Text>
            <View className="mt-6 items-center rounded-2xl border border-border bg-card p-5">
              <Text className="text-[13px] leading-[18px] text-foreground-muted">Device code</Text>
              <Text
                selectable
                accessibilityLabel={login.device.code.split("").join(" ")}
                className="mt-2 text-[28px] leading-9 font-t3-bold tracking-[2px] text-foreground"
              >
                {login.device.code}
              </Text>
            </View>
            <View className="mt-3 flex-row items-center justify-center gap-2">
              <SymbolView
                name="clock"
                size={14}
                tintColorClassName="accent-foreground-muted"
                type="monochrome"
              />
              <Text className="text-sm leading-5 text-foreground-muted">Waiting for approval…</Text>
            </View>
            {message ? (
              <Text className="mt-2 text-sm leading-5 text-danger-foreground">{message}</Text>
            ) : null}
            <View className="mt-5 gap-3">
              <Button
                tone="primary"
                fullWidth
                label={copied ? "Copied" : "Copy message for Rajesh"}
                onPress={() =>
                  void Clipboard.setStringAsync(
                    `Approve my T3 Code Chat device ${login.device.code}`,
                  ).then(() => setCopied(true))
                }
              />
              <Button tone="secondary" fullWidth label="Cancel" onPress={() => setLogin(null)} />
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function RajeshMonogram(props: { readonly size: "small" | "large" }) {
  const large = props.size === "large";
  return (
    <Image
      accessible={false}
      source={require("../../../../assets/rajesh-chat-icon.png")}
      className={large ? "h-14 w-14" : "h-10 w-10"}
    />
  );
}

/** A visible input boundary that thickens on focus without moving the content. */
function OutlinedInput(props: {
  readonly radius: string;
  readonly children: (focus: { onFocus: () => void; onBlur: () => void }) => ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View
      className={`flex-row items-end bg-input ${props.radius} ${
        focused ? "border-2 border-focus p-[3px]" : "border border-foreground-muted p-1"
      }`}
    >
      {props.children({ onFocus: () => setFocused(true), onBlur: () => setFocused(false) })}
    </View>
  );
}

interface Feed {
  readonly ready: boolean;
  readonly messages: ReadonlyArray<RajeshMessage>;
  readonly threads: ReadonlyArray<RajeshT3Thread>;
  readonly status: string | null;
  readonly error: string | null;
  readonly unauthorized: boolean;
  /** When this state arrived; "Today" and "Yesterday" are relative to it, not a ticking clock. */
  readonly receivedAt: number;
}

const EMPTY_FEED: Feed = {
  ready: false,
  messages: [],
  threads: [],
  status: null,
  error: null,
  unauthorized: false,
  receivedAt: 0,
};

/** History once, then the long-poll, until aborted. Plain code: it runs outside rendering. */
async function runRajeshFeed(
  chat: RajeshChat,
  token: string,
  signal: AbortSignal,
  latest: { current: Feed },
  setFeed: (feed: Feed) => void,
) {
  const commit = (next: Feed) => {
    latest.current = { ...next, receivedAt: Date.now() };
    setFeed(latest.current);
  };
  const refreshThreads = async () => {
    const { threads } = await readRajeshT3Threads(chat.baseUrl, token, chat.taskKey);
    commit({ ...latest.current, threads });
  };
  let failures = 0;
  while (!signal.aborted) {
    try {
      const current = latest.current;
      if (!current.ready) {
        const history = await readRajeshHistory(chat.baseUrl, token, chat.taskKey);
        commit({
          ...current,
          ready: true,
          messages: mergeRajeshMessages(current.messages, history.messages),
          status: history.task.status,
          error: null,
        });
        await refreshThreads();
        continue;
      }
      const update = await readRajeshUpdates(chat.baseUrl, token, chat.taskKey, {
        after: rajeshCursor(current.messages),
        status: current.status,
        waitMs: LONG_POLL_MS,
        signal,
      });
      failures = 0;
      const statusChanged = update.status !== current.status;
      if (update.messages.length === 0 && !statusChanged && current.error === null) continue;
      commit({
        ...latest.current,
        messages: mergeRajeshMessages(latest.current.messages, update.messages),
        status: update.status,
        error: null,
      });
      // New launches show up with Rajesh's reply or when its run ends.
      if (statusChanged || update.messages.some((message) => message.bot)) await refreshThreads();
    } catch (error) {
      if (signal.aborted) return;
      // 401: the session ended; 403: it no longer grants this chat (for example, it predates
      // device-key binding). Either way only a new pairing helps.
      const status = rajeshErrorStatus(error);
      if (status === 401 || status === 403) {
        commit({ ...latest.current, unauthorized: true });
        return;
      }
      failures += 1;
      commit({ ...latest.current, error: errorText(error) });
      await sleep(Math.min(30_000, 1_000 * 2 ** failures));
    }
  }
}

/** History once, then a long-poll for new messages, only while this tab is shown and the app is active. */
function useRajeshFeed(chat: RajeshChat, token: string | null) {
  const [feed, setFeed] = useState<Feed>(EMPTY_FEED);
  const latest = useRef<Feed>(EMPTY_FEED);
  const [active, setActive] = useState(AppState.currentState === "active");

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mirrors AppState so the long-poll stops in the background
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => subscription.remove();
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the gateway long-poll, an external subscription, while visible
  useEffect(() => {
    if (token === null || !active) return;
    const controller = new AbortController();
    void runRajeshFeed(chat, token, controller.signal, latest, setFeed);
    return () => controller.abort();
  }, [chat, token, active]);

  return feed;
}

interface PendingSend {
  readonly requestId: string;
  readonly text: string;
  readonly file: RajeshFile | null;
  readonly sentAt: number;
  /** Set once retries stop; the bubble then offers a manual retry. */
  readonly error: string | null;
}

/** What a send shows as, read the same way as the message Rajesh records for it. */
const pendingContent = (send: PendingSend) =>
  rajeshUserContent({ id: send.requestId, text: send.text, author: "", bot: false, time: 0 });

const SEND_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000];

/** Sends until accepted. Safe to repeat: the gateway keys each send on its request ID. */
async function sendWithRetry(
  chat: RajeshChat,
  token: string,
  send: PendingSend,
): Promise<string | null> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await sendRajeshMessage(
        chat.baseUrl,
        token,
        chat.taskKey,
        send.requestId,
        send.text,
        send.file ?? undefined,
      );
      return null;
    } catch (error) {
      const status = rajeshErrorStatus(error);
      // Refusals other than timeouts and rate limits will not change on a retry.
      const final = status !== undefined && status < 500 && status !== 408 && status !== 429;
      const delay = SEND_RETRY_DELAYS_MS[attempt];
      console.warn("[rajesh] send failed", status ?? "network", errorText(error));
      if (final || delay === undefined) return errorText(error);
      await sleep(delay);
    }
  }
}

export function RajeshChatScreen(props: { readonly chat: RajeshChat }) {
  const { chat } = props;
  const insets = useSafeAreaInsets();
  const setChat = useSetRajeshChat();
  const openThread = useOpenThread();
  const styles = useMarkdownStyles();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [text, setText] = useState("");
  const [file, setFile] = useState<RajeshFile | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const input = useRef<TextInputInstance>(null);
  const keyboard = useKeyboardOverlap();
  const [pending, setPending] = useState<ReadonlyArray<PendingSend>>([]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the session token from secure storage once per gateway
  useEffect(() => {
    let current = true;
    void readRajeshToken(chat.baseUrl).then((value) => {
      if (current) setToken(value);
    });
    return () => {
      current = false;
    };
  }, [chat.baseUrl]);

  const feed = useRajeshFeed(chat, token ?? null);
  const deliver = async (send: PendingSend) => {
    if (!token) return;
    const mark = (error: string | null) =>
      setPending((all) =>
        all.map((item) => (item.requestId === send.requestId ? { ...item, error } : item)),
      );
    mark(null);
    mark(await sendWithRetry(chat, token, send));
  };
  const submit = () => {
    const message = text.trim();
    if ((message === "" && file === null) || !token) return;
    const send = {
      requestId: uuidv4(),
      text: replyTo === null ? message : rajeshReplyText(replyTo, message),
      file,
      sentAt: Date.now(),
      error: null,
    };
    setPending((all) => [...all, send]);
    setText("");
    setFile(null);
    setReplyTo(null);
    void deliver(send);
  };
  const startReply = (message: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    setReplyTo(message);
    input.current?.focus();
  };
  const attach = () =>
    void pickRajeshFile()
      .then((picked) => {
        if (picked !== null) setFile(picked);
      })
      .catch((error: unknown) =>
        Dialog.alert(
          "Could not attach file",
          error instanceof Error ? error.message : "Try another file.",
        ),
      );

  if (token === undefined) {
    return <View className="flex-1 bg-screen" />;
  }
  if (token === null || feed.unauthorized) {
    return (
      <View className="flex-1 bg-screen">
        <AppBar title="Chat" />
        <View className="w-full max-w-[420px] flex-1 justify-center self-center px-6">
          <RajeshMonogram size="large" />
          <Text className="mt-5 text-2xl leading-[30px] font-t3-bold text-foreground">
            Connect again
          </Text>
          <Text className="mt-2 text-base leading-6 text-foreground-secondary">
            This device's Rajesh session ended. Your conversation is still available in Discord.
          </Text>
          <View className="mt-6">
            <Button
              tone="primary"
              fullWidth
              label="Connect again"
              onPress={() => {
                void writeRajeshToken(chat.baseUrl, null);
                setChat(undefined);
              }}
            />
          </View>
        </View>
      </View>
    );
  }

  const rows = buildRajeshChatRows(
    buildRajeshChatEntries(feed.messages, feed.threads),
    feed.receivedAt,
  );
  // A sent message stays as a local bubble until Rajesh records it.
  const outstanding = pending.filter((send) => {
    const mine = pendingContent(send);
    return !feed.messages.some((message) => {
      if (message.bot || message.time < send.sentAt - 60_000) return false;
      const recorded = rajeshUserContent(message);
      return (
        recorded.text === mine.text &&
        recorded.replyTo === mine.replyTo &&
        recorded.files.length === (send.file ? 1 : 0)
      );
    });
  });
  // The gateway's status is only as fresh as the connection that reported it.
  const working = feed.status === "running" && feed.error === null;
  const timeline: ReadonlyArray<TimelineRow> = [
    ...rows,
    ...outstanding.map((send) => ({ kind: "pending" as const, id: send.requestId, send })),
    ...(working ? [{ kind: "working" as const, id: "working" }] : []),
  ];
  const spaced = timeline.map((row, index) => ({
    row,
    space: spaceBefore(timeline[index - 1], row),
  }));
  // Inverted so the newest row stays anchored above the composer.
  const listRows = [...spaced].reverse();
  const onLinkPress = (href: string) => {
    const link = parseThreadLinkHref(href);
    if (link?.environmentId) openThread(link.environmentId, link.threadId);
    else if (/^https?:\/\//i.test(href)) void Linking.openURL(href).catch(() => undefined);
  };
  const canSend = text.trim() !== "" || file !== null;

  return (
    <View
      onLayout={keyboard.onLayout}
      className="flex-1 bg-screen"
      style={{ paddingTop: insets.top, paddingBottom: keyboard.overlap }}
    >
      {feed.error && feed.ready ? (
        <View className="mx-4 mt-3 rounded-xl bg-warning p-3">
          <Text className="text-[13px] leading-[18px] text-warning-foreground">
            Connection interrupted. Reconnecting…
          </Text>
        </View>
      ) : null}
      {timeline.length === 0 ? (
        <ChatEmptyState ready={feed.ready} failed={feed.error !== null} />
      ) : (
        <FlatList
          inverted
          className="flex-1"
          data={listRows}
          keyExtractor={(item) => item.row.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 16 }}
          renderItem={({ item: { row, space } }) => (
            <View style={{ paddingTop: space }}>
              {row.kind === "separator" ? (
                <Text className="py-2 text-center text-[13px] leading-[18px] text-foreground-muted">
                  {row.label}
                </Text>
              ) : row.kind === "task" ? (
                <TaskCard
                  threadId={row.threadId}
                  environmentIds={[row.environmentId, row.environmentId]}
                  onOpen={openThread}
                />
              ) : row.kind === "working" ? (
                <View
                  accessible
                  accessibilityLabel="Rajesh is working"
                  accessibilityLiveRegion="polite"
                  className="self-start rounded-[20px] border border-border bg-card px-3.5 py-2.5"
                >
                  <Text className="text-sm leading-5 text-foreground-muted">
                    Rajesh is working…
                  </Text>
                </View>
              ) : row.kind === "pending" ? (
                <View className="max-w-[85%] self-end">
                  <UserBubble
                    {...pendingContent(row.send)}
                    files={row.send.file ? [row.send.file.name] : []}
                    textStyle={styles.user.nativeTextStyle}
                    onLinkPress={onLinkPress}
                  />
                  {row.send.error !== null ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Message not sent. Retry sending message."
                      onPress={() => void deliver(row.send)}
                      className="min-h-12 flex-row items-center justify-end gap-1.5 self-end"
                    >
                      <SymbolView
                        name="exclamationmark.circle"
                        size={16}
                        tintColorClassName="accent-danger-foreground"
                        type="monochrome"
                      />
                      <Text className="text-[13px] leading-[18px] text-danger-foreground">
                        Not sent · tap to retry
                      </Text>
                    </Pressable>
                  ) : (
                    <View className="mt-1 flex-row items-center justify-end gap-1">
                      <SymbolView
                        name="clock"
                        size={12}
                        tintColorClassName="accent-foreground-muted"
                        type="monochrome"
                      />
                      <Text className="text-[13px] leading-[18px] text-foreground-muted">
                        Sending…
                      </Text>
                    </View>
                  )}
                </View>
              ) : row.role === "assistant" ? (
                <SwipeToReply onReply={() => startReply(row.text)}>
                  <Pressable
                    onLongPress={() => copyMessage(row.text)}
                    className="max-w-[85%] self-start rounded-[20px] border border-border bg-card px-3.5 py-3"
                  >
                    <SelectableMarkdownText
                      markdown={row.text}
                      selectable={false}
                      textStyle={styles.assistant.nativeTextStyle}
                      onLinkPress={onLinkPress}
                    />
                  </Pressable>
                </SwipeToReply>
              ) : (
                <View className="max-w-[85%] self-end">
                  <UserBubble
                    text={row.text}
                    files={row.files}
                    replyTo={row.replyTo}
                    textStyle={styles.user.nativeTextStyle}
                    onLinkPress={onLinkPress}
                  />
                </View>
              )}
            </View>
          )}
        />
      )}
      <View className="bg-screen px-3 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
        {replyTo !== null ? (
          <View className="mb-2 flex-row items-center gap-2 rounded-2xl bg-grouped-card py-1 pl-3">
            <View className="w-0.5 self-stretch rounded-full bg-primary" />
            <View className="min-w-0 flex-1 py-1">
              <Text className="text-xs leading-4 font-t3-medium text-foreground-muted">
                Replying to Rajesh
              </Text>
              <Text numberOfLines={1} className="text-sm leading-5 text-foreground">
                {replyTo.replace(/\s+/g, " ")}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel reply"
              onPress={() => setReplyTo(null)}
              className="h-10 w-10 items-center justify-center"
            >
              <SymbolView
                name="xmark.circle.fill"
                size={18}
                tintColorClassName="accent-foreground-muted"
                type="monochrome"
              />
            </Pressable>
          </View>
        ) : null}
        {file ? (
          <View className="mb-2 flex-row items-center gap-2 self-start rounded-2xl bg-grouped-card py-1 pl-3">
            <SymbolView
              name="doc.text"
              size={16}
              tintColorClassName="accent-foreground-muted"
              type="monochrome"
            />
            <Text numberOfLines={1} className="max-w-[220px] text-sm leading-5 text-foreground">
              {file.name}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${file.name}`}
              onPress={() => setFile(null)}
              className="h-10 w-10 items-center justify-center"
            >
              <SymbolView
                name="xmark.circle.fill"
                size={18}
                tintColorClassName="accent-foreground-muted"
                type="monochrome"
              />
            </Pressable>
          </View>
        ) : null}
        <OutlinedInput radius="rounded-3xl">
          {(focus) => (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add attachment"
                onPress={attach}
                className="h-12 w-12 items-center justify-center"
              >
                <SymbolView
                  name="plus"
                  size={20}
                  tintColorClassName="accent-icon"
                  type="monochrome"
                />
              </Pressable>
              <TextInput
                {...focus}
                ref={input}
                accessibilityLabel="Message Rajesh"
                multiline
                maxLength={50_000}
                placeholder="Message Rajesh…"
                placeholderTextColorClassName="accent-placeholder"
                value={text}
                onChangeText={setText}
                textAlignVertical="center"
                className="max-h-36 min-h-12 min-w-0 flex-1 rounded-none border-0 bg-transparent px-3 py-2.5 text-base leading-6 text-foreground"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                accessibilityState={{ disabled: !canSend }}
                disabled={!canSend}
                onPress={submit}
                className="h-12 w-12 items-center justify-center"
              >
                <View
                  className={`h-11 w-11 items-center justify-center rounded-full ${canSend ? "bg-primary" : "bg-grouped-card"}`}
                >
                  <SymbolView
                    name="arrow.up"
                    size={22}
                    tintColorClassName={
                      canSend ? "accent-primary-foreground" : "accent-foreground-muted"
                    }
                    type="monochrome"
                  />
                </View>
              </Pressable>
            </>
          )}
        </OutlinedInput>
      </View>
    </View>
  );
}

function SentFile({ name }: { readonly name: string }) {
  return (
    <View className="flex-row items-center gap-2">
      <SymbolView
        name="doc.text"
        size={16}
        tintColorClassName="accent-user-bubble-foreground"
        type="monochrome"
      />
      <Text numberOfLines={1} className="shrink text-sm leading-5 text-user-bubble-foreground">
        {name}
      </Text>
    </View>
  );
}

/** Bubble text is not selectable, so the swipe owns its touches; a long press copies it all. */
function copyMessage(text: string) {
  if (text === "") return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  void Clipboard.setStringAsync(text);
}

type MarkdownTextProps = Pick<
  React.ComponentProps<typeof SelectableMarkdownText>,
  "textStyle" | "onLinkPress"
>;

function UserBubble(
  props: MarkdownTextProps & {
    readonly text: string;
    readonly files: ReadonlyArray<string>;
    readonly replyTo: string | null;
  },
) {
  return (
    <Pressable
      onLongPress={() => copyMessage(props.text)}
      className="gap-2 rounded-[20px] bg-user-bubble px-3.5 py-3"
    >
      {props.replyTo === null ? null : (
        <View className="border-l-2 border-primary pl-2">
          <Text className="text-xs leading-4 font-t3-medium text-user-bubble-foreground-muted">
            Rajesh
          </Text>
          <Text numberOfLines={2} className="text-sm leading-5 text-user-bubble-foreground-muted">
            {props.replyTo}
          </Text>
        </View>
      )}
      {props.text === "" ? null : (
        <SelectableMarkdownText
          markdown={props.text}
          selectable={false}
          textStyle={props.textStyle}
          onLinkPress={props.onLinkPress}
        />
      )}
      {props.files.map((name) => (
        <SentFile key={name} name={name} />
      ))}
    </Pressable>
  );
}

const REPLY_SWIPE = 56;

/** Drag a message right to reply to it. It follows the finger a short way, then returns. */
function SwipeToReply(props: { readonly onReply: () => void; readonly children: ReactNode }) {
  const translation = useSharedValue(0);
  const { onReply } = props;
  const gesture = usePanGesture({
    // Rightward only, and only once clearly horizontal, so the list keeps its vertical scroll.
    activeOffsetX: 12,
    failOffsetX: -12,
    failOffsetY: [-12, 12],
    onUpdate: (event) => {
      translation.set(Math.min(Math.max(event.translationX, 0), REPLY_SWIPE + 16));
    },
    onDeactivate: (event) => {
      if (!event.canceled && event.translationX >= REPLY_SWIPE) runOnJS(onReply)();
      translation.set(withTiming(0, { duration: 160 }));
    },
  });
  const messageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translation.value }],
  }));
  const hintStyle = useAnimatedStyle(() => ({
    opacity: Math.min(translation.value / REPLY_SWIPE, 1),
  }));
  return (
    <GestureDetector gesture={gesture}>
      <View
        accessibilityActions={[{ name: "activate", label: "Reply" }]}
        onAccessibilityAction={onReply}
        className="justify-center"
      >
        <Animated.View style={hintStyle} className="absolute left-1">
          <SymbolView
            name="arrow.uturn.backward"
            size={20}
            tintColorClassName="accent-foreground-muted"
            type="monochrome"
          />
        </Animated.View>
        <Animated.View style={messageStyle}>{props.children}</Animated.View>
      </View>
    </GestureDetector>
  );
}

type TimelineRow =
  | RajeshChatRow
  | { readonly kind: "pending"; readonly id: string; readonly send: PendingSend }
  | { readonly kind: "working"; readonly id: string };

/** Vertical rhythm: 8 within a speaker's run, 10–12 around task cards, 20 between speakers. */
function spaceBefore(previous: TimelineRow | undefined, row: TimelineRow): number {
  if (previous === undefined || previous.kind === "separator") return 0;
  if (row.kind === "separator") return 12;
  if (row.kind === "task") return previous.kind === "task" ? 10 : 12;
  if (previous.kind === "task") return 12;
  const speaker = (item: TimelineRow) =>
    item.kind === "pending"
      ? "user"
      : item.kind === "working"
        ? "assistant"
        : item.kind === "message"
          ? item.role
          : null;
  return speaker(previous) === speaker(row) ? 8 : 20;
}

function ChatEmptyState(props: { readonly ready: boolean; readonly failed: boolean }) {
  return (
    <View className="w-full max-w-[300px] flex-1 items-center justify-center self-center px-6">
      {props.failed ? (
        <>
          <SymbolView
            name="wifi.slash"
            size={32}
            tintColorClassName="accent-foreground-muted"
            type="monochrome"
          />
          <Text className="mt-4 text-center text-lg leading-6 font-t3-medium text-foreground">
            Couldn't load your chat
          </Text>
          <Text className="mt-1 text-center text-sm leading-5 text-foreground-muted">
            Reconnecting to Rajesh…
          </Text>
        </>
      ) : !props.ready ? (
        <>
          <SymbolView
            name="bubble.left"
            size={32}
            tintColorClassName="accent-foreground-muted"
            type="monochrome"
          />
          <Text className="mt-3 text-center text-sm leading-5 text-foreground-muted">
            Loading your chat…
          </Text>
        </>
      ) : (
        <>
          <RajeshMonogram size="large" />
          <Text className="mt-6 text-center text-[22px] leading-7 font-t3-bold text-foreground">
            What's on your mind?
          </Text>
          <Text className="mt-2 text-center text-sm leading-5 text-foreground-muted">
            Talk to Rajesh here or in Discord. Coding tasks will appear in this chat.
          </Text>
        </>
      )}
    </View>
  );
}
