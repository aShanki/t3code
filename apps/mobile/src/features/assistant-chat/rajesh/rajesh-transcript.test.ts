import { describe, expect, it } from "vite-plus/test";

import {
  buildRajeshChatEntries,
  buildRajeshChatRows,
  rajeshReplyText,
  rajeshSeparatorLabel,
  rajeshUserContent,
  mergeRajeshMessages,
  rajeshAwaitsTaskDetails,
  rajeshCursor,
  type RajeshMessage,
  type RajeshT3Thread,
} from "./rajesh-transcript";

const message = (id: string, time: number, text: string, bot = false): RajeshMessage => ({
  id,
  time,
  text,
  bot,
  author: bot ? "Rajesh" : "Test user (333333333333333333)",
});

describe("Rajesh transcript", () => {
  it("hides the bot's progress posts and no-reply sentinel, keeping what people wrote", () => {
    const entries = buildRajeshChatEntries(
      [
        message("a", 1, "🛠️ Tool activity\n✓ mcpToolCall: example", true),
        message("b", 2, "3 more tool calls ...\n✅ Tool activity\n✓ exec: ls", true),
        message("c", 3, "❌ Tool activity\n✗ exec: false", true),
        message("d", 4, "Queued. Waiting for an available task slot.", true),
        message("e", 5, "NO_REPLY", true),
        message("f", 6, "NO_REPLY"),
        message("g", 7, "Tool activity is hidden now"),
        message("h", 8, "Here is the result", true),
      ],
      [],
    );
    expect(entries.map((entry) => (entry.kind === "message" ? entry.text : entry.kind))).toEqual([
      "NO_REPLY",
      "Tool activity is hidden now",
      "Here is the result",
    ]);
  });
  it("sends a reply as a quoted excerpt and reads it back", () => {
    const long = `First line\nsecond   line ${"x".repeat(200)}`;
    const sent = rajeshReplyText(long, "Do the second one");
    expect(sent.split("\n")[0]).toBe(
      `> Replying to Rajesh: “First line second line ${"x".repeat(137)}…”`,
    );
    const [entry] = buildRajeshChatEntries(
      [message("a", 1, `${sent}\n[User attachment: /srv/uploads/ab12/plan.pdf]`)],
      [],
    );
    expect(entry).toMatchObject({
      text: "Do the second one",
      files: [{ name: "plan.pdf", attachment: null }],
      replyTo: `First line second line ${"x".repeat(137)}…`,
    });
    expect(rajeshUserContent(message("b", 2, "> a quote I typed\n\nmine")).replyTo).toBeNull();
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
      ["Look at this", [{ name: "site_plan.pdf", attachment: null }]],
      ["", [{ name: "photo.jpg", attachment: null }]],
      ["[User attachment: /srv/uploads/ef56/notes.txt]", []],
    ]);
  });
  it("links files to the gateway's copies and shows a sent file once", () => {
    const report = { id: "upload:r", name: "report.html", mime: "text/html" };
    const plan = { id: "input:p", name: "plan.pdf", mime: "application/pdf" };
    const shot = {
      id: "discord-attachment:s",
      name: "shot.png",
      mime: "image/png",
      url: "https://cdn.discordapp.com/attachments/1/2/shot.png",
    };
    const entries = buildRajeshChatEntries(
      [
        {
          ...message("a", 1, "Plan\n[User attachment: /srv/uploads/ab12/plan.pdf]"),
          attachments: [plan],
        },
        { ...message("b", 2, "From Discord"), attachments: [shot] },
        // History reports a captionless delivery with an empty display text.
        {
          ...message("out:upload:r", 3, "Attached file: report.html", true),
          displayText: "",
          attachments: [report],
        },
        {
          ...message(
            "discord:personal:9",
            4,
            "[attachment: report.html] https://cdn.discordapp.com/x",
            true,
          ),
          displayText: "",
          attachments: [report],
        },
        // Live updates label it instead.
        {
          ...message("out:upload:q", 5, "{}", true),
          displayText: "Here it is\nAttached file: report.html",
          attachments: [report],
        },
      ],
      [],
    );
    expect(
      entries.map((entry) =>
        entry.kind === "message" ? [entry.id, entry.text, entry.files] : entry.kind,
      ),
    ).toEqual([
      ["a", "Plan", [{ name: "plan.pdf", attachment: plan }]],
      ["b", "From Discord", [{ name: "shot.png", attachment: shot }]],
      ["out:upload:r", "", [{ name: "report.html", attachment: report }]],
      ["out:upload:q", "Here it is", [{ name: "report.html", attachment: report }]],
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
  it("puts a task's card under each update about it, with only the newest one live", () => {
    const update = (
      id: string,
      time: number,
      event: string,
      threadId = "thread",
    ): RajeshMessage => ({
      ...message(id, time, `Update ${id}`, true),
      t3: { environmentId: "env", threadId, event, title: "Fix the login" } as RajeshMessage["t3"],
    });
    const entries = buildRajeshChatEntries(
      [
        message("app:1", 10, "fix the login bug"),
        message("out:started", 21, "Started the login fix.", true),
        update("out:asked", 40, "question"),
        // The Discord echo of an update carries no card of its own.
        message("discord:personal:2", 41, "Update out:asked", true),
        // An update Rajesh kept to itself hides its text but still shows the task's card.
        { ...update("out:quiet", 50, "done"), text: "NO_REPLY" },
        update("out:other", 60, "failed", "other"),
        update("out:done", 70, "done"),
        // A user message cannot claim a card, and an unknown event is not guessed at.
        { ...update("app:2", 80, "done"), bot: false },
        update("out:future", 90, "paused"),
      ],
      [
        { environmentId: "env", threadId: "thread", state: "launched", created: 20 },
        { environmentId: "env", threadId: "idle", state: "launched", created: 30 },
      ],
    );
    expect(
      entries.map((entry) =>
        entry.kind === "task"
          ? [entry.id, entry.threadId, entry.moment, entry.latest, entry.title]
          : entry.id,
      ),
    ).toEqual([
      "app:1",
      ["task:env:thread", "thread", "started", false, "Fix the login"],
      "out:started",
      ["task:env:idle", "idle", "started", true, null],
      "out:asked",
      ["task:out:asked", "thread", "question", false, "Fix the login"],
      ["task:out:quiet", "thread", "done", false, "Fix the login"],
      "out:other",
      ["task:out:other", "other", "failed", true, "Fix the login"],
      "out:done",
      ["task:out:done", "thread", "done", true, "Fix the login"],
      "app:2",
      "out:future",
    ]);
  });
  it("drops a start card that sits directly above the same task's update", () => {
    const report: RajeshMessage = {
      ...message("out:report", 31, "Your own thread finished.", true),
      t3: { environmentId: "env", threadId: "mine", event: "done" },
    };
    const threads = [
      { environmentId: "env", threadId: "mine", state: "adopted", adopted: true, created: 29 },
    ];
    expect(
      buildRajeshChatEntries([report], threads).map((entry) =>
        entry.kind === "task" ? [entry.moment, entry.latest] : entry.id,
      ),
    ).toEqual(["out:report", ["done", true]]);
    // With anything else in between, the earlier card stays as the record of when it ended.
    expect(
      buildRajeshChatEntries(
        [message("discord:personal:9", 30, "Checking it.", true), report],
        threads,
      ).map((entry) => (entry.kind === "task" ? [entry.moment, entry.latest] : entry.id)),
    ).toEqual([["ended", false], "discord:personal:9", "out:report", ["done", true]]);
    // A silent report (NO_REPLY) still marks the task, and replaces the start card above it.
    expect(
      buildRajeshChatEntries([{ ...report, text: "NO_REPLY" }], threads).map((entry) =>
        entry.kind === "task" ? [entry.moment, entry.latest] : entry.id,
      ),
    ).toEqual([["done", true]]);
    // Silent reports in a row, or one directly above a written one, say the same thing once;
    // a silent report that says something else stays.
    const silent = (id: string, time: number, event: string): RajeshMessage => ({
      ...message(id, time, "NO_REPLY", true),
      t3: { environmentId: "env", threadId: "mine", event } as RajeshMessage["t3"],
    });
    expect(
      buildRajeshChatEntries(
        [
          silent("out:q1", 31, "done"),
          silent("out:q2", 32, "done"),
          silent("out:q3", 33, "question"),
          silent("out:q4", 34, "done"),
          { ...report, time: 35 },
        ],
        [],
      ).map((entry) => (entry.kind === "task" ? [entry.id, entry.moment] : entry.id)),
    ).toEqual([
      ["task:out:q2", "done"],
      ["task:out:q3", "question"],
      "out:report",
      ["task:out:report", "done"],
    ]);
  });
  it("gives every card of a task what the task list or any update says about it", () => {
    const said = (id: string, time: number, t3: object): RajeshMessage => ({
      ...message(id, time, `Update ${id}`, true),
      t3: { environmentId: "env", threadId: "thread", event: "done", ...t3 } as RajeshMessage["t3"],
    });
    const listed = { environmentId: "env", threadId: "thread", state: "launched", created: 20 };
    const details = (messages: RajeshMessage[], threads: RajeshT3Thread[]) =>
      buildRajeshChatEntries(messages, threads).flatMap((entry) =>
        entry.kind === "task"
          ? [[entry.moment, entry.title, entry.machine, entry.model, entry.origin]]
          : [],
      );
    // The task list names the task as it is now; a dropped start card still lends what it knows.
    expect(
      details(
        [said("out:done", 30, { title: "Old name", machine: "rajesh-gb-1" })],
        [{ ...listed, title: " Fix the build ", model: "claude-fable-5-2", origin: "app" }],
      ),
    ).toEqual([["done", "Fix the build", "rajesh-gb-1", "claude-fable-5-2", "app"]]);
    // Without the list, the newest update that names a detail supplies it to earlier cards.
    expect(
      details(
        [
          said("out:asked", 30, { event: "question", model: "gpt-6.1-sol" }),
          message("app:1", 31, "yes"),
          said("out:done", 40, { title: "Tidy the docs", machine: "Mac mini", origin: "t3" }),
        ],
        [],
      ),
    ).toEqual([
      ["question", "Tidy the docs", "Mac mini", "gpt-6.1-sol", "t3"],
      ["done", "Tidy the docs", "Mac mini", "gpt-6.1-sol", "t3"],
    ]);
    // An older gateway says none of it, and values of the wrong kind are ignored.
    expect(details([said("out:done", 30, { machine: 7, model: " ", origin: "moon" })], [])).toEqual(
      [["done", null, null, null, null]],
    );
  });
  it("asks for the task list again only while a new task has no name or model", () => {
    const started = { environmentId: "env", threadId: "thread", state: "launched", created: 1000 };
    expect(rajeshAwaitsTaskDetails([started], 60_000)).toBe(true);
    expect(rajeshAwaitsTaskDetails([{ ...started, title: "Fix the build" }], 60_000)).toBe(true);
    expect(
      rajeshAwaitsTaskDetails([{ ...started, title: "Fix the build", model: "m" }], 60_000),
    ).toBe(false);
    expect(rajeshAwaitsTaskDetails([started], 1000 + 10 * 60_000)).toBe(false);
  });
});

describe("Rajesh chat rows", () => {
  const at = (iso: string) => new Date(iso).getTime();
  const now = at("2026-11-11T15:00:00");
  it("separates days and long gaps", () => {
    const rows = buildRajeshChatRows(
      [
        {
          kind: "message",
          id: "a",
          role: "user",
          text: "hi",
          files: [],
          replyTo: null,
          time: at("2026-11-10T18:10:00"),
        },
        {
          kind: "message",
          id: "b",
          role: "assistant",
          text: "hello",
          files: [],
          replyTo: null,
          time: at("2026-11-10T18:11:00"),
        },
        {
          kind: "message",
          id: "c",
          role: "user",
          text: "plan",
          files: [],
          replyTo: null,
          time: at("2026-11-11T09:41:00"),
        },
        {
          kind: "message",
          id: "d",
          role: "assistant",
          text: "one",
          files: [],
          replyTo: null,
          time: at("2026-11-11T09:42:00"),
        },
        {
          kind: "task",
          id: "t",
          environmentId: "e",
          threadId: "x",
          time: at("2026-11-11T09:42:30"),
          moment: "started",
          messageId: null,
          title: null,
          machine: null,
          model: null,
          origin: null,
          latest: true,
        },
        {
          kind: "message",
          id: "e",
          role: "assistant",
          text: "two",
          files: [],
          replyTo: null,
          time: at("2026-11-11T09:43:00"),
        },
        {
          kind: "message",
          id: "f",
          role: "assistant",
          text: "later",
          files: [],
          replyTo: null,
          time: at("2026-11-11T10:30:00"),
        },
      ],
      now,
      "en-US",
    );
    expect(
      rows.map((row) =>
        row.kind === "separator" ? row.label : row.kind === "task" ? "task" : row.id,
      ),
    ).toEqual([
      "Yesterday · 6:10 PM",
      "a",
      "b",
      "Today · 9:41 AM",
      "c",
      "d",
      "task",
      "e",
      "Today · 10:30 AM",
      "f",
    ]);
  });

  it("labels older days with their date", () => {
    expect(rajeshSeparatorLabel(at("2026-11-01T08:05:00"), now, "en-US")).toBe("Nov 1 · 8:05 AM");
    expect(rajeshSeparatorLabel(at("2025-12-31T23:00:00"), now, "en-US")).toBe(
      "Dec 31, 2025 · 11:00 PM",
    );
  });
});
