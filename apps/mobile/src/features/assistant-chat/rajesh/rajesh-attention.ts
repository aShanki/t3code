/**
 * The attention inbox: what Rajesh is waiting on the owner for, kept apart from the chat feed.
 * Plain data and rules only; the gateway calls live in `rajesh-gateway.ts` and the sheet in
 * `RajeshAttentionInbox.tsx`.
 */

export type RajeshAttentionKind = "decision" | "input" | "approval" | "alert";
export type RajeshAttentionStatus = "open" | "replied" | "dismissed" | "resolved";

export interface RajeshAttentionItem {
  readonly id: string;
  readonly kind: RajeshAttentionKind;
  readonly urgent: boolean;
  readonly status: RajeshAttentionStatus;
  readonly title: string;
  readonly body: string;
  readonly created: number;
  readonly updated: number;
  /** Times the same item was raised again; at least 1. */
  readonly count: number;
  readonly source: {
    readonly label: string;
    /** The T3 thread it came from, which an approval is answered in. */
    readonly t3: {
      readonly environmentId: string;
      readonly threadId: string;
      readonly machine: string | null;
    } | null;
  };
  readonly reply: { readonly text: string; readonly time: number } | null;
  readonly resolution: { readonly note: string; readonly time: number; readonly by: string } | null;
  readonly canReply: boolean;
  readonly canDismiss: boolean;
}

/** The inbox as the long-poll reports it: how many items are open, and a version to wait on. */
export interface RajeshAttentionSummary {
  readonly open: number;
  readonly rev: string;
}

const KINDS: ReadonlySet<string> = new Set(["decision", "input", "approval", "alert"]);
const STATUSES: ReadonlySet<string> = new Set(["open", "replied", "dismissed", "resolved"]);

const text = (value: unknown) => (typeof value === "string" ? value : "");
const time = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** One item from the gateway, or null when it is not one this app can show. */
export function parseRajeshAttentionItem(value: unknown): RajeshAttentionItem | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, any>;
  if (typeof item.id !== "string" || item.id === "" || typeof item.title !== "string") return null;
  const status: RajeshAttentionStatus = STATUSES.has(item.status) ? item.status : "open";
  const t3 = item.source?.t3;
  const open = status === "open";
  return {
    id: item.id,
    // A kind added later still shows, as the plainest one.
    kind: KINDS.has(item.kind) ? item.kind : "alert",
    urgent: item.severity === "urgent",
    status,
    title: item.title,
    body: text(item.body),
    created: time(item.created),
    updated: time(item.updated) || time(item.created),
    count: typeof item.count === "number" && item.count > 1 ? Math.floor(item.count) : 1,
    source: {
      label: text(item.source?.label),
      t3:
        typeof t3?.environmentId === "string" && typeof t3?.threadId === "string"
          ? {
              environmentId: t3.environmentId,
              threadId: t3.threadId,
              machine: typeof t3.machine === "string" && t3.machine !== "" ? t3.machine : null,
            }
          : null,
    },
    reply:
      typeof item.reply?.text === "string"
        ? { text: item.reply.text, time: time(item.reply.time) }
        : null,
    resolution:
      item.resolution && typeof item.resolution === "object"
        ? {
            note: text(item.resolution.note),
            time: time(item.resolution.time),
            by: text(item.resolution.by),
          }
        : null,
    // Without the gateway's word, an open item offers both and a closed one neither.
    canReply: open && item.actions?.reply !== false,
    canDismiss: open && item.actions?.dismiss !== false,
  };
}

/** The list endpoint's answer. A gateway without the inbox answers an empty one. */
export function parseRajeshAttentionList(value: unknown): {
  readonly items: ReadonlyArray<RajeshAttentionItem>;
  readonly open: number;
  readonly rev: string | null;
} {
  const data = (typeof value === "object" && value !== null ? value : {}) as Record<string, any>;
  const items = Array.isArray(data.items)
    ? data.items.flatMap((entry: unknown) => {
        const item = parseRajeshAttentionItem(entry);
        return item === null ? [] : [item];
      })
    : [];
  return {
    items,
    open:
      typeof data.open === "number"
        ? data.open
        : items.filter((item: RajeshAttentionItem) => item.status === "open").length,
    rev: typeof data.rev === "string" ? data.rev : null,
  };
}

/** The long-poll's `attention` field; null from gateways that predate the inbox. */
export function parseRajeshAttentionSummary(value: unknown): RajeshAttentionSummary | null {
  if (typeof value !== "object" || value === null) return null;
  const { open, rev } = value as Record<string, unknown>;
  if (typeof open !== "number" || typeof rev !== "string") return null;
  return { open: Math.max(0, Math.floor(open)), rev };
}

/**
 * The latest summary, shared by the long-poll (which waits on its version) and the inbox (which
 * shows its count and refetches when the version moves). Readable outside rendering.
 */
export function createRajeshAttentionSummaryStore() {
  let summary: RajeshAttentionSummary | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => summary,
    set: (next: RajeshAttentionSummary | null) => {
      if (next?.open === summary?.open && next?.rev === summary?.rev) return;
      summary = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type RajeshAttentionSummaryStore = ReturnType<typeof createRajeshAttentionSummaryStore>;

/**
 * The gateway's newer copy of one item replaces the held one. An answer to a reply or dismiss
 * can arrive after a list fetched before it, so a copy older than the one held is ignored.
 */
export function upsertRajeshAttentionItem(
  items: ReadonlyArray<RajeshAttentionItem>,
  item: RajeshAttentionItem,
): ReadonlyArray<RajeshAttentionItem> {
  const index = items.findIndex((held) => held.id === item.id);
  if (index < 0) return [item, ...items];
  if (items[index]!.updated > item.updated) return items;
  return items.map((held, at) => (at === index ? item : held));
}

/**
 * A fetched list replaces the held one, except for items this device changed more recently
 * than the list knows of (such as one just replied to while the fetch was in flight).
 */
export function mergeRajeshAttentionList(
  held: ReadonlyArray<RajeshAttentionItem>,
  fetched: ReadonlyArray<RajeshAttentionItem>,
): ReadonlyArray<RajeshAttentionItem> {
  const newer = new Map(held.map((item) => [item.id, item]));
  return fetched.map((item) => {
    const mine = newer.get(item.id);
    return mine !== undefined && mine.updated > item.updated ? mine : item;
  });
}

/** Open items, then closed ones, each newest first. */
export function sortRajeshAttention(items: ReadonlyArray<RajeshAttentionItem>): {
  readonly open: ReadonlyArray<RajeshAttentionItem>;
  readonly closed: ReadonlyArray<RajeshAttentionItem>;
} {
  const newest = (a: RajeshAttentionItem, b: RajeshAttentionItem) =>
    b.updated - a.updated || b.created - a.created;
  return {
    open: items.filter((item) => item.status === "open").sort(newest),
    closed: items.filter((item) => item.status !== "open").sort(newest),
  };
}

/** The icon's badge text: none at zero, and no more than "9+". */
export function rajeshAttentionBadge(open: number): string | null {
  if (!(open > 0)) return null;
  return open > 9 ? "9+" : String(Math.floor(open));
}

export const RAJESH_ATTENTION_KIND_LABELS: Readonly<Record<RajeshAttentionKind, string>> = {
  decision: "Decision",
  input: "Needs input",
  approval: "Approval",
  alert: "Alert",
};

/** How long ago, in the chat's short units: "now", "5m ago", "3h ago", "2d ago". */
export function rajeshAttentionAge(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** What a closed item's card says happened to it. */
export function rajeshAttentionOutcome(item: RajeshAttentionItem): string | null {
  if (item.reply !== null) return `You replied: ${item.reply.text}`;
  if (item.status === "dismissed") return "Dismissed";
  if (item.status === "resolved") {
    const note = item.resolution?.note.trim() ?? "";
    const by =
      item.resolution?.by === "owner" ? "You" : item.resolution?.by === "t3" ? "T3" : "Rajesh";
    return note === "" ? `Resolved by ${by}` : `Resolved by ${by}: ${note}`;
  }
  return null;
}

/**
 * The reply typed on an item, and the request ID a send of it goes out under. The ID is made
 * on the first send and kept until the gateway accepts one, so a retry after a lost answer is
 * recognized as the same reply instead of being delivered twice.
 */
export interface RajeshAttentionDraft {
  readonly text: string;
  readonly requestId: string | null;
}

export type RajeshAttentionDrafts = Readonly<Record<string, RajeshAttentionDraft>>;

export function setRajeshAttentionDraftText(
  drafts: RajeshAttentionDrafts,
  id: string,
  value: string,
): RajeshAttentionDrafts {
  return { ...drafts, [id]: { text: value, requestId: drafts[id]?.requestId ?? null } };
}

/** The drafts with a request ID for `id`'s send, and that ID; an earlier send's ID is reused. */
export function claimRajeshAttentionRequestId(
  drafts: RajeshAttentionDrafts,
  id: string,
  makeId: () => string,
): { readonly drafts: RajeshAttentionDrafts; readonly requestId: string } {
  const held = drafts[id];
  if (held?.requestId) return { drafts, requestId: held.requestId };
  const requestId = makeId();
  return { drafts: { ...drafts, [id]: { text: held?.text ?? "", requestId } }, requestId };
}

/** Forgets an item's draft once its reply is accepted or the item is closed. */
export function clearRajeshAttentionDraft(
  drafts: RajeshAttentionDrafts,
  id: string,
): RajeshAttentionDrafts {
  if (!(id in drafts)) return drafts;
  const { [id]: _, ...rest } = drafts;
  return rest;
}

/** Drafts read back from the device, keeping only well-formed ones. */
export function parseRajeshAttentionDrafts(value: unknown): RajeshAttentionDrafts {
  if (typeof value !== "object" || value === null) return {};
  const drafts: Record<string, RajeshAttentionDraft> = {};
  for (const [id, draft] of Object.entries(value as Record<string, any>)) {
    if (typeof draft?.text !== "string") continue;
    drafts[id] = {
      text: draft.text,
      requestId: typeof draft.requestId === "string" ? draft.requestId : null,
    };
  }
  return drafts;
}

/** A chat link that asks for the inbox to open, as a push for an attention item does. */
export function rajeshLinkOpensInbox(path: string): boolean {
  const query = path.split("#")[0]?.split("?")[1];
  return query !== undefined && new URLSearchParams(query).has("inbox");
}
