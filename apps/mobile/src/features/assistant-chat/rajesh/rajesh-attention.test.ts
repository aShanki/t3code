import { describe, expect, it } from "vite-plus/test";

import {
  claimRajeshAttentionRequestId,
  clearRajeshAttentionDraft,
  createRajeshAttentionSummaryStore,
  mergeRajeshAttentionList,
  parseRajeshAttentionDrafts,
  parseRajeshAttentionItem,
  parseRajeshAttentionList,
  parseRajeshAttentionSummary,
  rajeshAttentionAge,
  rajeshAttentionBadge,
  rajeshAttentionOutcome,
  rajeshLinkOpensInbox,
  setRajeshAttentionDraftText,
  sortRajeshAttention,
  upsertRajeshAttentionItem,
  type RajeshAttentionItem,
} from "./rajesh-attention";

const raw = (fields: Record<string, unknown> = {}) => ({
  id: "att_1",
  kind: "decision",
  severity: "normal",
  status: "open",
  title: "Approve deploy of api-v2?",
  body: "It passed staging.",
  created: 1_000,
  updated: 1_000,
  count: 1,
  source: { label: "T3 task · Deploy" },
  actions: { reply: true, dismiss: true },
  ...fields,
});

const item = (fields: Record<string, unknown> = {}) => parseRajeshAttentionItem(raw(fields))!;

describe("parsing", () => {
  it("reads an item as the gateway sends it", () => {
    const parsed = parseRajeshAttentionItem(
      raw({
        kind: "approval",
        severity: "urgent",
        count: 3,
        source: {
          label: "T3 task · Fix Outlook links",
          t3: { environmentId: "env", threadId: "thread", title: "Fix", machine: "Mac mini" },
          requestMessageId: "app:1",
        },
      }),
    );
    expect(parsed).toMatchObject({
      id: "att_1",
      kind: "approval",
      urgent: true,
      status: "open",
      count: 3,
      source: {
        label: "T3 task · Fix Outlook links",
        t3: { environmentId: "env", threadId: "thread", machine: "Mac mini" },
      },
      reply: null,
      resolution: null,
      canReply: true,
      canDismiss: true,
    });
  });

  it("keeps unknown kinds and odd fields showable, and drops what is not an item", () => {
    expect(item({ kind: "someday", count: 0, body: undefined, source: undefined })).toMatchObject({
      kind: "alert",
      count: 1,
      body: "",
      source: { label: "", t3: null },
    });
    expect(parseRajeshAttentionItem(null)).toBeNull();
    expect(parseRajeshAttentionItem({ title: "no id" })).toBeNull();
  });

  it("offers no actions on a closed item, and follows the gateway's actions on an open one", () => {
    expect(item({ status: "replied", reply: { text: "Yes", time: 2_000 } })).toMatchObject({
      canReply: false,
      canDismiss: false,
      reply: { text: "Yes", time: 2_000 },
    });
    expect(item({ actions: { reply: false, dismiss: true } })).toMatchObject({
      canReply: false,
      canDismiss: true,
    });
  });

  it("reads a list, and an empty one from a gateway without the inbox", () => {
    const list = parseRajeshAttentionList({ items: [raw(), { bad: true }], open: 1, rev: "r1" });
    expect(list.items.map((entry) => entry.id)).toEqual(["att_1"]);
    expect(list).toMatchObject({ open: 1, rev: "r1" });
    expect(parseRajeshAttentionList({})).toEqual({ items: [], open: 0, rev: null });
  });

  it("reads the long-poll's summary only when it is there", () => {
    expect(parseRajeshAttentionSummary({ open: 2, rev: "r2" })).toEqual({ open: 2, rev: "r2" });
    expect(parseRajeshAttentionSummary(undefined)).toBeNull();
    expect(parseRajeshAttentionSummary({ open: "2", rev: "r2" })).toBeNull();
  });
});

describe("merging", () => {
  it("an answer to a reply replaces the held item, but an older copy does not", () => {
    const held = [item(), item({ id: "att_2" })];
    const replied = item({
      status: "replied",
      updated: 2_000,
      reply: { text: "Ship it", time: 2_000 },
    });
    const after = upsertRajeshAttentionItem(held, replied);
    expect(after.map((entry) => entry.status)).toEqual(["replied", "open"]);
    expect(upsertRajeshAttentionItem(after, item())).toBe(after);
    expect(upsertRajeshAttentionItem([], item()).map((entry) => entry.id)).toEqual(["att_1"]);
  });

  it("a list fetched before a reply landed does not reopen the item", () => {
    const replied = item({ status: "replied", updated: 2_000 });
    const merged = mergeRajeshAttentionList([replied], [item(), item({ id: "att_3" })]);
    expect(merged.map((entry) => [entry.id, entry.status])).toEqual([
      ["att_1", "replied"],
      ["att_3", "open"],
    ]);
    // Items the list no longer has are gone, such as ones closed elsewhere.
    expect(mergeRajeshAttentionList([item({ id: "gone" })], [])).toEqual([]);
  });

  it("sorts open items first, each group newest first", () => {
    const sorted = sortRajeshAttention([
      item({ id: "old-open", updated: 1_000 }),
      item({ id: "closed", status: "dismissed", updated: 5_000 }),
      item({ id: "new-open", updated: 3_000 }),
    ]);
    expect(sorted.open.map((entry) => entry.id)).toEqual(["new-open", "old-open"]);
    expect(sorted.closed.map((entry) => entry.id)).toEqual(["closed"]);
  });
});

describe("presentation", () => {
  it("badges the open count, hidden at zero and capped at 9+", () => {
    expect(rajeshAttentionBadge(0)).toBeNull();
    expect(rajeshAttentionBadge(-1)).toBeNull();
    expect(rajeshAttentionBadge(1)).toBe("1");
    expect(rajeshAttentionBadge(9)).toBe("9");
    expect(rajeshAttentionBadge(10)).toBe("9+");
  });

  it("says how long ago in short units", () => {
    const now = 10 * 86_400_000;
    expect(rajeshAttentionAge(now - 10_000, now)).toBe("now");
    expect(rajeshAttentionAge(now - 5 * 60_000, now)).toBe("5m ago");
    expect(rajeshAttentionAge(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(rajeshAttentionAge(now - 2 * 86_400_000, now)).toBe("2d ago");
  });

  it("says what happened to a closed item", () => {
    const outcome = (fields: Record<string, unknown>) =>
      rajeshAttentionOutcome(item(fields) as RajeshAttentionItem);
    expect(outcome({ status: "replied", reply: { text: "Yes", time: 1 } })).toBe(
      "You replied: Yes",
    );
    expect(outcome({ status: "dismissed" })).toBe("Dismissed");
    expect(
      outcome({ status: "resolved", resolution: { note: "Deployed", time: 1, by: "t3" } }),
    ).toBe("Resolved by T3: Deployed");
    expect(outcome({ status: "resolved", resolution: { note: "", time: 1, by: "rajesh" } })).toBe(
      "Resolved by Rajesh",
    );
    expect(outcome({})).toBeNull();
  });

  it("knows a link that opens the inbox", () => {
    expect(rajeshLinkOpensInbox("/chat?inbox=att_1")).toBe(true);
    expect(rajeshLinkOpensInbox("chat?inbox=1")).toBe(true);
    expect(rajeshLinkOpensInbox("/chat")).toBe(false);
    expect(rajeshLinkOpensInbox("/chat?other=1#inbox")).toBe(false);
  });
});

describe("reply drafts", () => {
  it("a retry reuses the first send's request ID until it is accepted", () => {
    let made = 0;
    const makeId = () => `req-${++made}`;
    let drafts = setRajeshAttentionDraftText({}, "att_1", "Ship it");
    const first = claimRajeshAttentionRequestId(drafts, "att_1", makeId);
    expect(first.requestId).toBe("req-1");
    drafts = first.drafts;
    // The send failed; the text is edited and sent again under the same ID.
    drafts = setRajeshAttentionDraftText(drafts, "att_1", "Ship it now");
    const retry = claimRajeshAttentionRequestId(drafts, "att_1", makeId);
    expect(retry.requestId).toBe("req-1");
    expect(retry.drafts["att_1"]).toEqual({ text: "Ship it now", requestId: "req-1" });
    // Accepted: the next reply on the item is a new one.
    drafts = clearRajeshAttentionDraft(retry.drafts, "att_1");
    expect(drafts).toEqual({});
    expect(claimRajeshAttentionRequestId(drafts, "att_1", makeId).requestId).toBe("req-2");
  });

  it("keeps each item's draft apart", () => {
    const drafts = setRajeshAttentionDraftText(
      setRajeshAttentionDraftText({}, "a", "one"),
      "b",
      "two",
    );
    expect(clearRajeshAttentionDraft(drafts, "a")).toEqual({ b: { text: "two", requestId: null } });
    expect(clearRajeshAttentionDraft(drafts, "missing")).toBe(drafts);
  });

  it("reads back only well-formed saved drafts", () => {
    expect(
      parseRajeshAttentionDrafts({
        a: { text: "hi", requestId: "r" },
        b: { text: "no id" },
        c: { requestId: "r" },
      }),
    ).toEqual({ a: { text: "hi", requestId: "r" }, b: { text: "no id", requestId: null } });
    expect(parseRajeshAttentionDrafts("nope")).toEqual({});
  });
});

it("the summary store tells listeners only of a change", () => {
  const store = createRajeshAttentionSummaryStore();
  let calls = 0;
  const stop = store.subscribe(() => calls++);
  store.set({ open: 1, rev: "r1" });
  store.set({ open: 1, rev: "r1" });
  store.set({ open: 0, rev: "r1" });
  stop();
  store.set({ open: 2, rev: "r2" });
  expect(calls).toBe(2);
  expect(store.get()).toEqual({ open: 2, rev: "r2" });
});
