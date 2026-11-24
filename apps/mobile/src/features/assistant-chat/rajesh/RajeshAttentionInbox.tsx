import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { SymbolView } from "../../../components/ui/AppSymbol";
import type { AppSymbolName } from "../../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../../components/ui/AppText";
import { Button } from "../../../components/ui/Button";
import { Sheet } from "../../../components/ui/Sheet";
import { uuidv4 } from "../../../lib/uuid";
import type { RajeshChat } from "../../../persistence/mobile-preferences";
import { cancelAndroidAgentCard } from "../../agent-awareness/androidNotifications";
import {
  RAJESH_ATTENTION_KIND_LABELS,
  claimRajeshAttentionRequestId,
  clearRajeshAttentionDraft,
  mergeRajeshAttentionList,
  parseRajeshAttentionItem,
  parseRajeshAttentionList,
  rajeshAttentionAge,
  rajeshAttentionBadge,
  rajeshAttentionOutcome,
  setRajeshAttentionDraftText,
  sortRajeshAttention,
  upsertRajeshAttentionItem,
  type RajeshAttentionDrafts,
  type RajeshAttentionItem,
  type RajeshAttentionKind,
  type RajeshAttentionSummaryStore,
} from "./rajesh-attention";
import { readRajeshAttentionDrafts, writeRajeshAttentionDrafts } from "./rajesh-chat-cache";
import {
  dismissRajeshAttention,
  rajeshErrorBody,
  rajeshErrorStatus,
  readRajeshAttention,
  replyRajeshAttention,
} from "./rajesh-gateway";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Rajesh could not be reached.";

/** An item's push card, cleared once the item no longer needs the owner. */
const inboxSlot = (id: string) => `inbox:${id}`;

export type RajeshAttention = ReturnType<typeof useRajeshAttention>;

/**
 * The inbox's items, fetched when its version moves or the sheet opens, and the replies being
 * typed on them. Lives with the chat screen, so a draft outlasts the sheet being closed.
 */
export function useRajeshAttention(
  chat: RajeshChat,
  token: string | null,
  summaries: RajeshAttentionSummaryStore,
  sheetOpen: boolean,
) {
  const summary = useSyncExternalStore(summaries.subscribe, summaries.get);
  const [items, setItems] = useState<ReadonlyArray<RajeshAttentionItem>>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drafts, setDraftsState] = useState<RajeshAttentionDrafts>({});
  const [busy, setBusy] = useState<Readonly<Record<string, "reply" | "dismiss">>>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  /** Dismissed here and not yet confirmed: shown as dismissed, restored if the gateway refuses. */
  const [dismissing, setDismissing] = useState<ReadonlySet<string>>(new Set());
  const latestDrafts = useRef<RajeshAttentionDrafts>({});
  const dismissIds = useRef(new Map<string, string>());
  const fetched = useRef<{
    readonly rev: string | null;
    readonly scope: "open" | "recent";
    readonly reloads: number;
  } | null>(null);
  const [reloads, setReloads] = useState(0);

  const setDrafts = (update: (drafts: RajeshAttentionDrafts) => RajeshAttentionDrafts) => {
    const next = update(latestDrafts.current);
    if (next === latestDrafts.current) return;
    latestDrafts.current = next;
    setDraftsState(next);
    writeRajeshAttentionDrafts(chat.baseUrl, next);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- restores reply drafts saved on the device once per gateway
  useEffect(() => {
    let current = true;
    void readRajeshAttentionDrafts(chat.baseUrl).then((saved) => {
      if (!current || Object.keys(latestDrafts.current).length > 0) return;
      latestDrafts.current = saved;
      setDraftsState(saved);
    });
    return () => {
      current = false;
    };
  }, [chat.baseUrl]);

  const scope = sheetOpen ? "recent" : "open";
  const rev = summary?.rev ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- fetches the inbox from the gateway when its version moves or the sheet opens
  useEffect(() => {
    if (token === null) return;
    const last = fetched.current;
    // A recent list holds every open item too, so closing the sheet needs no fetch of its own.
    if (
      last !== null &&
      rev !== null &&
      last.rev === rev &&
      last.reloads === reloads &&
      (last.scope === scope || last.scope === "recent")
    )
      return;
    const controller = new AbortController();
    void readRajeshAttention(chat.baseUrl, token, chat.taskKey, scope, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        const list = parseRajeshAttentionList(value);
        fetched.current = { rev: list.rev ?? rev, scope, reloads };
        setItems((held) => mergeRajeshAttentionList(held, list.items));
        setLoaded(true);
        setLoadError(null);
        if (list.rev !== null) summaries.set({ open: list.open, rev: list.rev });
        for (const item of list.items) {
          if (item.status !== "open") cancelAndroidAgentCard(inboxSlot(item.id));
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // A gateway that predates the inbox has no such route: nothing needs the owner there.
        if (rajeshErrorStatus(error) === 404) {
          fetched.current = { rev, scope, reloads };
          setLoaded(true);
          setLoadError(null);
          return;
        }
        setLoadError(errorText(error));
      });
    return () => controller.abort();
  }, [chat.baseUrl, chat.taskKey, token, rev, scope, reloads, summaries]);

  const settle = (item: RajeshAttentionItem) => {
    const before = items.find((held) => held.id === item.id);
    setItems((held) => upsertRajeshAttentionItem(held, item));
    if (item.status === "open") return;
    setDrafts((all) => clearRajeshAttentionDraft(all, item.id));
    cancelAndroidAgentCard(inboxSlot(item.id));
    // The long-poll brings the gateway's count shortly; until then the badge drops at once.
    const now = summaries.get();
    if (before?.status === "open" && now !== null) {
      summaries.set({ open: Math.max(0, now.open - 1), rev: now.rev });
    }
  };
  const setError = (id: string, error: string | null) =>
    setErrors((all) => {
      const next = { ...all };
      if (error === null) delete next[id];
      else next[id] = error;
      return next;
    });
  const setBusyFor = (id: string, action: "reply" | "dismiss" | null) =>
    setBusy((all) => {
      const next = { ...all };
      if (action === null) delete next[id];
      else next[id] = action;
      return next;
    });
  /** A refusal that carries the item as it now stands, such as one already closed elsewhere. */
  const settleFromRefusal = (error: unknown) => {
    const body = rajeshErrorBody(error);
    const item = parseRajeshAttentionItem(
      typeof body === "object" && body !== null ? Reflect.get(body, "item") : undefined,
    );
    if (item !== null) setItems((held) => upsertRajeshAttentionItem(held, item));
    if (item === null || rajeshErrorStatus(error) === 404) setReloads((count) => count + 1);
  };

  const reply = async (id: string) => {
    const text = latestDrafts.current[id]?.text.trim() ?? "";
    if (token === null || text === "" || busy[id] !== undefined) return;
    // The first send makes the request ID; every retry repeats it until one is accepted.
    let requestId = "";
    setDrafts((all) => {
      const claimed = claimRajeshAttentionRequestId(all, id, uuidv4);
      requestId = claimed.requestId;
      return claimed.drafts;
    });
    setBusyFor(id, "reply");
    setError(id, null);
    try {
      const result = await replyRajeshAttention(
        chat.baseUrl,
        token,
        chat.taskKey,
        id,
        requestId,
        text,
      );
      const item = parseRajeshAttentionItem(result.item);
      setDrafts((all) => clearRajeshAttentionDraft(all, id));
      if (item !== null) settle(item);
      else setReloads((count) => count + 1);
    } catch (error) {
      const status = rajeshErrorStatus(error);
      // The typed reply stays, with its request ID, for a retry or to copy elsewhere.
      setError(
        id,
        status === 409
          ? "This was already closed, so the reply was not sent."
          : status === 404
            ? "Rajesh no longer has this item."
            : errorText(error),
      );
      if (status === 409 || status === 404) settleFromRefusal(error);
    }
    setBusyFor(id, null);
  };

  const dismiss = async (id: string) => {
    if (token === null || busy[id] !== undefined) return;
    const requestId = dismissIds.current.get(id) ?? uuidv4();
    dismissIds.current.set(id, requestId);
    setBusyFor(id, "dismiss");
    setError(id, null);
    setDismissing((all) => new Set(all).add(id));
    try {
      const result = await dismissRajeshAttention(chat.baseUrl, token, chat.taskKey, id, requestId);
      dismissIds.current.delete(id);
      const item = parseRajeshAttentionItem(result.item);
      if (item !== null) settle(item);
      else setReloads((count) => count + 1);
    } catch (error) {
      setError(id, `Could not dismiss: ${errorText(error)}`);
      if (rajeshErrorStatus(error) === 404) settleFromRefusal(error);
    }
    setDismissing((all) => {
      const next = new Set(all);
      next.delete(id);
      return next;
    });
    setBusyFor(id, null);
  };

  // Until the gateway answers, a dismissed item shows as dismissed and leaves the open list.
  const shown = items.map((item) =>
    dismissing.has(item.id) && item.status === "open"
      ? { ...item, status: "dismissed" as const, canReply: false, canDismiss: false }
      : item,
  );
  const sorted = sortRajeshAttention(shown);
  return {
    ...sorted,
    /** From the long-poll or the last fetch; null from gateways that predate the inbox. */
    count: summary === null ? null : Math.max(0, summary.open - dismissing.size),
    urgent: sorted.open.some((item) => item.urgent),
    loaded,
    loadError,
    drafts,
    busy,
    errors,
    setDraft: (id: string, text: string) =>
      setDrafts((all) => setRajeshAttentionDraftText(all, id, text)),
    /** Closes a reply box; text a failed send left stays for a retry. */
    discardDraft: (id: string) =>
      setDrafts((all) => (all[id]?.requestId ? all : clearRajeshAttentionDraft(all, id))),
    reply,
    dismiss,
    retryLoad: () => setReloads((count) => count + 1),
  };
}

/** The inbox's icon in the chat's top-right corner, with the open count. */
export function RajeshAttentionButton(props: {
  readonly count: number | null;
  readonly urgent: boolean;
  readonly top: number;
  readonly onPress: () => void;
}) {
  const badge = rajeshAttentionBadge(props.count ?? 0);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        badge === null ? "Needs you: nothing open" : `Needs you: ${props.count} open`
      }
      onPress={props.onPress}
      style={{ top: props.top }}
      className="absolute right-3 z-10 h-12 w-12 items-center justify-center"
    >
      <View className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card">
        <SymbolView
          name="tray"
          size={18}
          tintColorClassName="accent-foreground"
          type="monochrome"
        />
      </View>
      {badge === null ? null : (
        <View
          className={`absolute top-0 right-0 h-5 min-w-5 items-center justify-center rounded-full px-1 ${
            props.urgent ? "bg-danger" : "bg-primary"
          }`}
        >
          <Text
            className={`text-[11px] leading-4 font-t3-bold ${
              props.urgent ? "text-danger-foreground" : "text-primary-foreground"
            }`}
          >
            {badge}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const KIND_ICONS: Readonly<Record<RajeshAttentionKind, AppSymbolName>> = {
  decision: "questionmark.bubble",
  input: "text.bubble",
  approval: "exclamationmark.shield",
  alert: "exclamationmark.triangle",
};

/** The list of what needs the owner, over the chat; the chat keeps updating underneath. */
export function RajeshAttentionSheet(props: {
  readonly attention: RajeshAttention;
  readonly onClose: () => void;
  readonly onOpenThread: (environmentId: string, threadId: string) => void;
}) {
  const { attention } = props;
  const [showRecent, setShowRecent] = useState(false);
  // A reply left unsent when the sheet closed is open again on its card.
  const [replying, setReplying] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        Object.entries(attention.drafts)
          .filter(([, draft]) => draft.text !== "")
          .map(([id]) => id),
      ),
  );
  const setReplyOpen = (id: string, open: boolean) =>
    setReplying((all) => {
      const next = new Set(all);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  // Ages are as of opening the sheet, not a ticking clock.
  const [now] = useState(Date.now);
  const card = (item: RajeshAttentionItem) => (
    <AttentionCard
      key={item.id}
      item={item}
      now={now}
      draft={attention.drafts[item.id]?.text ?? ""}
      replying={replying.has(item.id)}
      busy={attention.busy[item.id] ?? null}
      error={attention.errors[item.id] ?? null}
      onReplyOpen={(open) => {
        if (!open) attention.discardDraft(item.id);
        setReplyOpen(item.id, open);
      }}
      onChangeDraft={(text) => attention.setDraft(item.id, text)}
      onSend={() => void attention.reply(item.id)}
      onDismiss={() => void attention.dismiss(item.id)}
      onOpenThread={
        item.source.t3 === null
          ? null
          : () => {
              const { environmentId, threadId } = item.source.t3!;
              props.onClose();
              props.onOpenThread(environmentId, threadId);
            }
      }
    />
  );
  return (
    <Sheet title="Needs you" onClose={props.onClose}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-3 px-4 pt-2 pb-8"
      >
        {attention.loadError !== null ? (
          <View className="flex-row items-center gap-2 rounded-xl bg-warning p-3">
            <Text className="flex-1 text-[13px] leading-[18px] text-warning-foreground">
              {attention.loadError}
            </Text>
            <Button tone="text" size="compact" label="Retry" onPress={attention.retryLoad} />
          </View>
        ) : null}
        {attention.open.length === 0 ? (
          <View className="items-center py-10">
            <SymbolView
              name="tray"
              size={28}
              tintColorClassName="accent-foreground-muted"
              type="monochrome"
            />
            <Text className="mt-3 text-center text-sm leading-5 text-foreground-muted">
              {attention.loaded || attention.loadError !== null
                ? "Nothing needs you right now."
                : "Loading…"}
            </Text>
          </View>
        ) : (
          attention.open.map(card)
        )}
        {attention.closed.length === 0 ? null : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: showRecent }}
              onPress={() => setShowRecent(!showRecent)}
              className="min-h-11 flex-row items-center gap-1.5 pt-2"
            >
              <Text className="text-[13px] leading-[18px] font-t3-medium text-foreground-muted">
                Recent ({attention.closed.length})
              </Text>
              <SymbolView
                name={showRecent ? "chevron.up" : "chevron.down"}
                size={14}
                tintColorClassName="accent-foreground-muted"
                type="monochrome"
              />
            </Pressable>
            {showRecent ? attention.closed.map(card) : null}
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

function AttentionCard(props: {
  readonly item: RajeshAttentionItem;
  readonly now: number;
  readonly draft: string;
  readonly replying: boolean;
  readonly busy: "reply" | "dismiss" | null;
  readonly error: string | null;
  readonly onReplyOpen: (open: boolean) => void;
  readonly onChangeDraft: (text: string) => void;
  readonly onSend: () => void;
  readonly onDismiss: () => void;
  readonly onOpenThread: (() => void) | null;
}) {
  const { item } = props;
  const [expanded, setExpanded] = useState(false);
  const open = item.status === "open";
  const outcome = rajeshAttentionOutcome(item);
  // Without measuring, a long or many-line body is the one worth a "Show more".
  const long = item.body.length > 240 || item.body.split("\n").length > 4;
  const meta = [item.source.label, rajeshAttentionAge(item.updated || item.created, props.now)]
    .filter((part) => part !== "")
    .join(" · ");
  // Kept open after a refused send, so the typed text is never lost.
  const composing = props.replying && (item.canReply || props.draft !== "");
  return (
    <View
      className={`rounded-2xl border bg-card p-4 ${
        open && item.urgent ? "border-danger-foreground" : "border-border"
      } ${open ? "" : "opacity-80"}`}
    >
      <View className="flex-row flex-wrap items-center gap-2">
        <View
          className={`flex-row items-center gap-1.5 rounded-lg px-2 py-1.5 ${
            open ? "bg-warning" : "bg-grouped-card"
          }`}
        >
          <SymbolView
            name={KIND_ICONS[item.kind]}
            size={14}
            tintColorClassName={open ? "accent-warning-foreground" : "accent-foreground-muted"}
            type="monochrome"
          />
          <Text
            className={`text-[13px] leading-[18px] font-t3-medium ${
              open ? "text-warning-foreground" : "text-foreground-muted"
            }`}
          >
            {RAJESH_ATTENTION_KIND_LABELS[item.kind]}
          </Text>
        </View>
        {open && item.urgent ? (
          <Text className="text-[13px] leading-[18px] font-t3-medium text-danger-foreground">
            Urgent
          </Text>
        ) : null}
        {item.count > 1 ? (
          <Text className="text-[13px] leading-[18px] text-foreground-muted">×{item.count}</Text>
        ) : null}
      </View>
      <Text selectable className="mt-2.5 text-base leading-[22px] font-t3-medium text-foreground">
        {item.title}
      </Text>
      {meta === "" ? null : (
        <Text numberOfLines={1} className="mt-1 text-[13px] leading-[18px] text-foreground-muted">
          {meta}
        </Text>
      )}
      {item.body === "" ? null : (
        <>
          <Text
            selectable
            numberOfLines={expanded ? undefined : 4}
            className="mt-2 text-sm leading-5 text-foreground"
          >
            {item.body}
          </Text>
          {long ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setExpanded(!expanded)}
              className="min-h-8 justify-center"
            >
              <Text className="text-[13px] leading-[18px] font-t3-medium text-primary-text">
                {expanded ? "Show less" : "Show more"}
              </Text>
            </Pressable>
          ) : null}
        </>
      )}
      {open && item.kind === "approval" ? (
        <Text className="mt-2 text-[13px] leading-[18px] text-foreground-muted">
          {`Approve this in T3 on ${item.source.t3?.machine ?? "the machine running the task"}.`}
        </Text>
      ) : null}
      {outcome === null ? null : (
        <Text selectable className="mt-2 text-sm leading-5 text-foreground-secondary">
          {outcome}
        </Text>
      )}
      {props.error === null ? null : (
        <View className="mt-2 flex-row items-center gap-1.5">
          <SymbolView
            name="exclamationmark.circle"
            size={14}
            tintColorClassName="accent-danger-foreground"
            type="monochrome"
          />
          <Text className="flex-1 text-[13px] leading-[18px] text-danger-foreground">
            {props.error}
          </Text>
        </View>
      )}
      {composing ? (
        <View className="mt-3 gap-2">
          <TextInput
            accessibilityLabel={`Reply to ${item.title}`}
            multiline
            autoFocus={props.draft === ""}
            maxLength={20_000}
            placeholder="Reply to Rajesh…"
            placeholderTextColorClassName="accent-placeholder"
            value={props.draft}
            onChangeText={props.onChangeDraft}
            editable={props.busy !== "reply"}
            textAlignVertical="top"
            className="max-h-40 min-h-20 rounded-xl border border-foreground-muted bg-input px-3 py-2.5 text-base leading-6 text-foreground"
          />
          <View className="flex-row justify-end gap-2">
            <Button
              tone="text"
              size="compact"
              label="Cancel"
              disabled={props.busy === "reply"}
              onPress={() => props.onReplyOpen(false)}
            />
            <Button
              tone="primary"
              size="compact"
              label={props.busy === "reply" ? "Sending…" : props.error ? "Retry" : "Send"}
              loading={props.busy === "reply"}
              disabled={props.busy !== null || !item.canReply || props.draft.trim() === ""}
              onPress={props.onSend}
            />
          </View>
        </View>
      ) : null}
      {(item.canReply && !composing) || item.canDismiss || props.onOpenThread !== null ? (
        <View className="mt-3 flex-row flex-wrap items-center gap-2 border-t border-border pt-2.5">
          {item.canReply && !composing ? (
            <Button
              tone="secondary"
              size="compact"
              icon="arrow.uturn.backward"
              label="Reply"
              disabled={props.busy !== null}
              onPress={() => props.onReplyOpen(true)}
            />
          ) : null}
          {item.canDismiss ? (
            <Button
              tone="text"
              size="compact"
              label="Dismiss"
              disabled={props.busy !== null}
              onPress={props.onDismiss}
            />
          ) : null}
          {props.onOpenThread === null ? null : (
            <Button tone="text" size="compact" label="Open thread" onPress={props.onOpenThread} />
          )}
        </View>
      ) : null}
    </View>
  );
}
