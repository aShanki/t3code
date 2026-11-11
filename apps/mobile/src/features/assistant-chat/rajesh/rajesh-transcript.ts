/** A message as the Rajesh Code gateway returns it. */
export interface RajeshMessage {
  readonly id: string;
  readonly text: string;
  readonly displayText?: string;
  readonly author: string;
  readonly bot: boolean;
  readonly time: number;
}

/** A T3 thread Rajesh launched for this chat (gateway `/t3`). */
export interface RajeshT3Thread {
  readonly environmentId: string;
  readonly threadId: string;
  readonly state: string;
  readonly created: number;
}

export type RajeshChatEntry =
  | {
      readonly kind: "message";
      readonly id: string;
      readonly role: "user" | "assistant";
      readonly text: string;
      /** Names of the files sent with a user message. */
      readonly files: ReadonlyArray<string>;
      /** The excerpt of Rajesh's message that a user message replies to. */
      readonly replyTo: string | null;
      readonly time: number;
    }
  | {
      readonly kind: "task";
      readonly id: string;
      readonly environmentId: string;
      readonly threadId: string;
      readonly time: number;
    };

export interface RajeshCursor {
  readonly time: number;
  readonly id: string;
}

const compare = (a: RajeshCursor, b: RajeshCursor) =>
  a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Adds newly fetched messages to the known ones, by id, in gateway order (time, then id). */
export function mergeRajeshMessages(
  known: ReadonlyArray<RajeshMessage>,
  incoming: ReadonlyArray<RajeshMessage>,
): ReadonlyArray<RajeshMessage> {
  if (incoming.length === 0) return known;
  const byId = new Map(known.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(compare);
}

export function rajeshCursor(messages: ReadonlyArray<RajeshMessage>): RajeshCursor {
  const last = messages.at(-1);
  return last === undefined ? { time: 0, id: "" } : { time: last.time, id: last.id };
}

const ECHO_WINDOW_MS = 10 * 60 * 1000;
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
// Discord user and role mentions mean nothing outside Discord.
const readable = (text: string) => text.replace(/<@[!&]?\d+>/g, "").trim();

const USER_FILE = /\n?\[User attachment: ([^\]\n]+)\]/g;
const REPLY = /^> Replying to Rajesh: “([^\n]*)”\n*/;
const EXCERPT_LENGTH = 160;

/**
 * A reply as it is sent. The gateway takes text only, so the message replied to travels as a
 * quoted excerpt that Rajesh, Discord and this app can all read.
 */
export function rajeshReplyText(repliedTo: string, text: string): string {
  const line = normalize(repliedTo);
  const excerpt = line.length > EXCERPT_LENGTH ? `${line.slice(0, EXCERPT_LENGTH)}…` : line;
  return `> Replying to Rajesh: “${excerpt}”\n\n${text}`;
}

/** A user message split into its reply excerpt, its own text and the names of its files. */
export function rajeshUserContent(message: RajeshMessage): {
  readonly text: string;
  readonly files: ReadonlyArray<string>;
  readonly replyTo: string | null;
} {
  const body = (message.displayText ?? message.text).replace(USER_FILE, "");
  const reply = REPLY.exec(body);
  return {
    text: readable(reply ? body.slice(reply[0].length) : body),
    files: [...message.text.matchAll(USER_FILE)].map(
      (match) => match[1]!.split("/").pop() || "file",
    ),
    replyTo: reply ? reply[1]! : null,
  };
}

// The bot's progress posts: its tool log in any state, and its queue notice.
const ACTIVITY =
  /^(?:\d+ more tool calls \.\.\.\n)?(?:\S+\s+)?Tool activity\b|^Queued\. Waiting for an available task slot\.$/;

/**
 * The chat as Rajesh's Discord conversation shows it. Each bot reply is stored twice, as its
 * delivery (`out:…`) and as the Discord message that echoes it (possibly split in chunks); only
 * the delivery is shown.
 */
export function buildRajeshChatEntries(
  messages: ReadonlyArray<RajeshMessage>,
  threads: ReadonlyArray<RajeshT3Thread>,
): ReadonlyArray<RajeshChatEntry> {
  const deliveries = messages.filter((message) => message.bot && message.id.startsWith("out:"));
  const isEcho = (message: RajeshMessage) =>
    message.bot &&
    !message.id.startsWith("out:") &&
    deliveries.some(
      (delivery) =>
        Math.abs(delivery.time - message.time) <= ECHO_WINDOW_MS &&
        normalize(delivery.text).includes(normalize(message.text)),
    );
  const entries: RajeshChatEntry[] = [];
  for (const message of messages) {
    if (isEcho(message)) continue;
    const { text, files, replyTo } = message.bot
      ? { text: readable(message.displayText ?? message.text), files: [], replyTo: null }
      : rajeshUserContent(message);
    if (text === "" && files.length === 0) continue;
    // Progress is shown as the working indicator, not as messages.
    if (message.bot && (text === "NO_REPLY" || ACTIVITY.test(text))) continue;
    entries.push({
      kind: "message",
      id: message.id,
      role: message.bot ? "assistant" : "user",
      text,
      files,
      replyTo,
      time: message.time,
    });
  }
  for (const thread of threads) {
    entries.push({
      kind: "task",
      id: `task:${thread.environmentId}:${thread.threadId}`,
      environmentId: thread.environmentId,
      threadId: thread.threadId,
      time: thread.created,
    });
  }
  return entries.sort((a, b) => a.time - b.time);
}

export type RajeshChatRow =
  | { readonly kind: "separator"; readonly id: string; readonly label: string }
  | RajeshChatEntry;

const GROUP_GAP_MS = 30 * 60 * 1000;

const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** "Today · 9:41 AM", "Yesterday · 6:10 PM", else the local date and time. */
export function rajeshSeparatorLabel(time: number, nowMs: number, locale?: string): string {
  const date = new Date(time);
  const now = new Date(nowMs);
  const clock = date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (sameLocalDay(date, now)) return `Today · ${clock}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameLocalDay(date, yesterday)) return `Yesterday · ${clock}`;
  const day = date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${day} · ${clock}`;
}

/**
 * Display rows in chronological order, with a time separator before a new local day or a gap
 * of 30 minutes between messages. Task cards do not start a separator.
 */
export function buildRajeshChatRows(
  entries: ReadonlyArray<RajeshChatEntry>,
  nowMs: number,
  locale?: string,
): ReadonlyArray<RajeshChatRow> {
  const rows: RajeshChatRow[] = [];
  let previousMessage: Extract<RajeshChatEntry, { kind: "message" }> | undefined;
  for (const entry of entries) {
    if (entry.kind === "task") {
      rows.push(entry);
      continue;
    }
    if (
      previousMessage === undefined ||
      !sameLocalDay(new Date(previousMessage.time), new Date(entry.time)) ||
      entry.time - previousMessage.time >= GROUP_GAP_MS
    ) {
      rows.push({
        kind: "separator",
        id: `separator:${entry.id}`,
        label: rajeshSeparatorLabel(entry.time, nowMs, locale),
      });
    }
    rows.push(entry);
    previousMessage = entry;
  }
  return rows;
}
