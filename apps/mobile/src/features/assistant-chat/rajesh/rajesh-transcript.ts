import { knownOrigin, knownText, type TaskDetails, type TaskOrigin } from "../task-details";

/** A file the gateway links to a message. `url` is set only for Discord's own CDN copies. */
export interface RajeshAttachment {
  readonly id: string;
  readonly name: string;
  readonly mime: string;
  readonly url?: string;
}

/** How a task stood when Rajesh wrote about it. */
export type RajeshTaskEvent = "done" | "question" | "approval" | "failed" | "stopped";
const TASK_EVENTS: ReadonlyArray<string> = ["done", "question", "approval", "failed", "stopped"];

/** The T3 thread one of Rajesh's replies reports on (gateway `t3` on a message). */
export interface RajeshTaskUpdate {
  readonly environmentId: string;
  readonly threadId: string;
  readonly event: RajeshTaskEvent;
  readonly title?: string;
  readonly machine?: string;
  readonly model?: string;
  readonly origin?: TaskOrigin;
}

/** A message as the Rajesh Code gateway returns it. */
export interface RajeshMessage {
  readonly id: string;
  readonly text: string;
  readonly displayText?: string;
  readonly author: string;
  readonly bot: boolean;
  readonly time: number;
  readonly attachments?: ReadonlyArray<RajeshAttachment>;
  readonly t3?: RajeshTaskUpdate;
}

/** A file shown on a message; `attachment` is null when the gateway offers no copy of it. */
export interface RajeshFileRef {
  readonly name: string;
  readonly attachment: RajeshAttachment | null;
}

/** A T3 thread Rajesh launched for this chat (gateway `/t3`). */
export interface RajeshT3Thread {
  readonly environmentId: string;
  readonly threadId: string;
  readonly state: string;
  /** A thread the owner started in T3; Rajesh picked it up once it had ended. */
  readonly adopted?: boolean;
  /** The task's name now, where the bot has read the thread or reported on it. */
  readonly title?: string;
  readonly machine?: string;
  readonly model?: string;
  readonly origin?: TaskOrigin;
  readonly created: number;
}

/** What a task card marks: the task starting, ending unreported, or one of Rajesh's updates. */
export type RajeshTaskMoment = "started" | "ended" | RajeshTaskEvent;

export type RajeshChatEntry =
  | {
      readonly kind: "message";
      readonly id: string;
      readonly role: "user" | "assistant";
      readonly text: string;
      readonly files: ReadonlyArray<RajeshFileRef>;
      /** The excerpt of Rajesh's message that a user message replies to. */
      readonly replyTo: string | null;
      readonly time: number;
    }
  | (TaskDetails & {
      readonly kind: "task";
      readonly id: string;
      readonly environmentId: string;
      readonly threadId: string;
      readonly time: number;
      readonly moment: RajeshTaskMoment;
      /** The update this card belongs to; null for the card a task gets when it starts. */
      readonly messageId: string | null;
      /** The task's name as Rajesh knew it, for a device that has not loaded the thread. */
      readonly title: string | null;
      /** Whether this is the task's newest card. Earlier ones are a one-line record. */
      readonly latest: boolean;
    });

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
  readonly files: ReadonlyArray<RajeshFileRef>;
  readonly replyTo: string | null;
} {
  const body = (message.displayText ?? message.text).replace(USER_FILE, "");
  const reply = REPLY.exec(body);
  const attachments = [...(message.attachments ?? [])];
  const files: RajeshFileRef[] = [...message.text.matchAll(USER_FILE)].map((match) => {
    const name = match[1]!.split("/").pop() || "file";
    const index = attachments.findIndex((attachment) => attachment.name === name);
    const [attachment] = index < 0 ? [null] : attachments.splice(index, 1);
    return { name, attachment: attachment ?? null };
  });
  // Files sent from Discord arrive as attachments with no marker in the text.
  for (const attachment of attachments) files.push({ name: attachment.name, attachment });
  return {
    text: readable(reply ? body.slice(reply[0].length) : body),
    files,
    replyTo: reply ? reply[1]! : null,
  };
}

/** Rajesh's words with the "Attached file: name" label dropped for files shown as files. */
function rajeshBotContent(message: RajeshMessage) {
  const files = (message.attachments ?? []).map((attachment) => ({
    name: attachment.name,
    attachment,
  }));
  const names = new Set(files.map((file) => file.name));
  const text = readable(message.displayText ?? message.text)
    .split("\n")
    .filter((line) => !(line.startsWith("Attached file: ") && names.has(line.slice(15).trim())))
    .join("\n")
    .trim();
  return { text, files, replyTo: null };
}

// The bot's progress posts: its tool log in any state, and its queue notice.
const ACTIVITY =
  /^(?:\d+ more tool calls \.\.\.\n)?(?:\S+\s+)?Tool activity\b|^Queued\. Waiting for an available task slot\.$/;

// Chats saved on the device and gateways of other versions are read as they come.
function taskUpdate(message: RajeshMessage): RajeshTaskUpdate | null {
  const update: Partial<RajeshTaskUpdate> | undefined = message.t3;
  return message.bot &&
    typeof update?.environmentId === "string" &&
    typeof update.threadId === "string" &&
    TASK_EVENTS.includes(String(update.event))
    ? (update as RajeshTaskUpdate)
    : null;
}

const taskDetails = (said: Partial<RajeshTaskUpdate & RajeshT3Thread>) => ({
  title: knownText(said.title),
  machine: knownText(said.machine),
  model: knownText(said.model),
  origin: knownOrigin(said.origin),
});

const DETAILS_WAIT_MS = 10 * 60 * 1000;
/**
 * Whether a task started in the last ten minutes still has no name or model. The bot reads a
 * new thread a few seconds after launching it, so the task list is worth asking for again.
 */
export function rajeshAwaitsTaskDetails(
  threads: ReadonlyArray<RajeshT3Thread>,
  nowMs: number,
): boolean {
  return threads.some(
    (thread) =>
      nowMs - thread.created < DETAILS_WAIT_MS &&
      (knownText(thread.title) === null || knownText(thread.model) === null),
  );
}

type RajeshTaskEntry = Extract<RajeshChatEntry, { kind: "task" }>;
const sameTask = (a: RajeshTaskEntry, b: RajeshChatEntry | undefined) =>
  b?.kind === "task" && a.environmentId === b.environmentId && a.threadId === b.threadId;

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
  // A sent file's echo carries the same managed attachment as its delivery, not the same text.
  const deliveredFiles = new Set(
    deliveries.flatMap((delivery) => (delivery.attachments ?? []).map((file) => file.id)),
  );
  const isEcho = (message: RajeshMessage) =>
    message.bot &&
    !message.id.startsWith("out:") &&
    ((message.attachments ?? []).some((file) => deliveredFiles.has(file.id)) ||
      deliveries.some(
        (delivery) =>
          Math.abs(delivery.time - message.time) <= ECHO_WINDOW_MS &&
          normalize(delivery.text).includes(normalize(message.text)),
      ));
  const entries: RajeshChatEntry[] = [];
  for (const message of messages) {
    if (isEcho(message)) continue;
    const { text, files, replyTo } = message.bot
      ? rajeshBotContent(message)
      : rajeshUserContent(message);
    // Progress is shown as the working indicator, not as messages, and NO_REPLY is silence.
    const hidden =
      (text === "" && files.length === 0) ||
      (message.bot && (text === "NO_REPLY" || ACTIVITY.test(text)));
    if (!hidden) {
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
    // A task update still shows its card when Rajesh had nothing to say about it.
    const update = taskUpdate(message);
    if (update) {
      entries.push({
        kind: "task",
        id: `task:${message.id}`,
        environmentId: update.environmentId,
        threadId: update.threadId,
        time: message.time,
        moment: update.event,
        messageId: message.id,
        ...taskDetails(update),
        latest: false,
      });
    }
  }
  for (const thread of threads) {
    entries.push({
      kind: "task",
      id: `task:${thread.environmentId}:${thread.threadId}`,
      environmentId: thread.environmentId,
      threadId: thread.threadId,
      time: thread.created,
      moment: thread.adopted ? "ended" : "started",
      messageId: null,
      ...taskDetails(thread),
      latest: false,
    });
  }
  // The sort is stable, so an update's card stays directly under its message.
  entries.sort((a, b) => a.time - b.time);
  // A card with no message of its own (a start, or an update Rajesh stayed silent on) directly
  // above the same task's next card would show the task twice in a row. A silent update is
  // only dropped for a card that says the same thing.
  const shown = entries.filter((entry, index) => {
    if (entry.kind !== "task") return true;
    const silent = entry.messageId !== null && entries[index - 1]?.id !== entry.messageId;
    const next = entries[index + 1]?.kind === "message" ? entries[index + 2] : entries[index + 1];
    return !(
      next?.kind === "task" &&
      sameTask(entry, next) &&
      (entry.messageId === null || (silent && entry.moment === next.moment))
    );
  });
  // Every card of a task says the same about it: what the task list says now, else what its
  // newest update said. A card dropped above still counts.
  const tasks = new Map<string, ReturnType<typeof taskDetails>>();
  const learn = (entry: RajeshChatEntry) => {
    if (entry.kind !== "task") return;
    const task = `${entry.environmentId}:${entry.threadId}`;
    const details = tasks.get(task);
    tasks.set(task, {
      title: details?.title ?? entry.title,
      machine: details?.machine ?? entry.machine,
      model: details?.model ?? entry.model,
      origin: details?.origin ?? entry.origin,
    });
  };
  for (const entry of entries) if (entry.kind === "task" && entry.messageId === null) learn(entry);
  for (let index = entries.length - 1; index >= 0; index--) learn(entries[index]!);
  // Only a task's newest card is `latest`, so its status now is shown once.
  const seen = new Set<string>();
  for (let index = shown.length - 1; index >= 0; index--) {
    const entry = shown[index]!;
    if (entry.kind !== "task") continue;
    const task = `${entry.environmentId}:${entry.threadId}`;
    shown[index] = { ...entry, ...tasks.get(task), latest: !seen.has(task) };
    seen.add(task);
  }
  return shown;
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
