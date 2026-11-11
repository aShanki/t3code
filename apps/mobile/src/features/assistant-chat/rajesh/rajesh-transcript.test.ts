import { describe, expect, it } from "vite-plus/test";

import {
  buildRajeshChatEntries,
  buildRajeshChatRows,
  rajeshSeparatorLabel,
  mergeRajeshMessages,
  rajeshCursor,
  type RajeshMessage,
} from "./rajesh-transcript";

const message = (id: string, time: number, text: string, bot = false): RajeshMessage => ({
  id,
  time,
  text,
  bot,
  author: bot ? "Rajesh" : "Test user (333333333333333333)",
});

describe("Rajesh transcript", () => {
  it("folds bot tool logs and hides the no-reply sentinel without hiding user text", () => {
    const entries = buildRajeshChatEntries(
      [
        message("a", 1, "🛠️ Tool activity\n✓ mcpToolCall: example", true),
        message("b", 2, "NO_REPLY", true),
        message("c", 3, "NO_REPLY"),
        message("d", 4, "Here is the result", true),
      ],
      [],
    );
    expect(entries.map((entry) => [entry.kind, entry.kind === "task" ? "" : entry.text])).toEqual([
      ["activity", "🛠️ Tool activity\n✓ mcpToolCall: example"],
      ["message", "NO_REPLY"],
      ["message", "Here is the result"],
    ]);
  });
  it("shows a sent file by name instead of the gateway's upload path", () => {
    const entries = buildRajeshChatEntries(
      [
        message("a", 1, "Look at this\n[User attachment: /srv/uploads/ab12/site_plan.pdf]"),
        message("b", 2, "\n[User attachment: /srv/uploads/cd34/photo.jpg]"),
        message("c", 3, "[User attachment: /srv/uploads/ef56/notes.txt]", true),
      ],
      [],
    );
    expect(
      entries.map((entry) => (entry.kind === "message" ? [entry.text, entry.files] : entry.kind)),
    ).toEqual([
      ["Look at this", ["site_plan.pdf"]],
      ["", ["photo.jpg"]],
      ["[User attachment: /srv/uploads/ef56/notes.txt]", []],
    ]);
  });
  it("merges updates by id in gateway order and advances the cursor", () => {
    const known = [message("discord:personal:1", 10, "Plan my day")];
    const merged = mergeRajeshMessages(known, [
      message("out:b", 30, "Here is the plan", true),
      message("app:a", 20, "Also fix the site"),
      message("discord:personal:1", 10, "Plan my day"),
    ]);
    expect(merged.map((entry) => entry.id)).toEqual(["discord:personal:1", "app:a", "out:b"]);
    expect(rajeshCursor(merged)).toEqual({ time: 30, id: "out:b" });
    expect(rajeshCursor([])).toEqual({ time: 0, id: "" });
    expect(mergeRajeshMessages(known, [])).toBe(known);
  });

  it("shows each reply once, drops Discord-only markup, and places task cards by launch time", () => {
    const entries = buildRajeshChatEntries(
      [
        message("discord:personal:1", 10, "<@111111111111111111> fix the login bug"),
        message("out:reply", 40, "Started a T3 task for the login bug. I'll report back.", true),
        // The Discord echo of that delivery, split into two chunks.
        message("discord:personal:2", 41, "Started a T3 task for the login bug.", true),
        message("discord:personal:3", 42, "I'll report back.", true),
        // A bot message with no delivery row, such as an older reply, still shows.
        message("discord:personal:4", 50, "Earlier note", true),
      ],
      [{ environmentId: "env", threadId: "thread", state: "launched", created: 30 }],
    );
    expect(
      entries.map((entry) => [entry.kind, entry.kind === "task" ? entry.threadId : entry.text]),
    ).toEqual([
      ["message", "fix the login bug"],
      ["task", "thread"],
      ["message", "Started a T3 task for the login bug. I'll report back."],
      ["message", "Earlier note"],
    ]);
  });
});

describe("Rajesh chat rows", () => {
  const at = (iso: string) => new Date(iso).getTime();
  const now = at("2026-11-11T15:00:00");
  it("separates days and long gaps, and names Rajesh once per run of replies", () => {
    const rows = buildRajeshChatRows(
      [
        {
          kind: "message",
          id: "a",
          role: "user",
          text: "hi",
          files: [],
          time: at("2026-11-10T18:10:00"),
        },
        {
          kind: "message",
          id: "b",
          role: "assistant",
          text: "hello",
          files: [],
          time: at("2026-11-10T18:11:00"),
        },
        {
          kind: "message",
          id: "c",
          role: "user",
          text: "plan",
          files: [],
          time: at("2026-11-11T09:41:00"),
        },
        {
          kind: "message",
          id: "d",
          role: "assistant",
          text: "one",
          files: [],
          time: at("2026-11-11T09:42:00"),
        },
        {
          kind: "task",
          id: "t",
          environmentId: "e",
          threadId: "x",
          time: at("2026-11-11T09:42:30"),
        },
        {
          kind: "message",
          id: "e",
          role: "assistant",
          text: "two",
          files: [],
          time: at("2026-11-11T09:43:00"),
        },
        {
          kind: "message",
          id: "f",
          role: "assistant",
          text: "later",
          files: [],
          time: at("2026-11-11T10:30:00"),
        },
      ],
      now,
      "en-US",
    );
    expect(
      rows.map((row) =>
        row.kind === "separator"
          ? row.label
          : row.kind === "task"
            ? "task"
            : `${row.id}${row.kind === "message" && row.showSpeaker ? "*" : ""}`,
      ),
    ).toEqual([
      "Yesterday · 6:10 PM",
      "a",
      "b*",
      "Today · 9:41 AM",
      "c",
      "d*",
      "task",
      "e",
      "Today · 10:30 AM",
      "f*",
    ]);
  });

  it("labels older days with their date", () => {
    expect(rajeshSeparatorLabel(at("2026-11-01T08:05:00"), now, "en-US")).toBe("Nov 1 · 8:05 AM");
    expect(rajeshSeparatorLabel(at("2025-12-31T23:00:00"), now, "en-US")).toBe(
      "Dec 31, 2025 · 11:00 PM",
    );
  });
});
