import {
  MessageId,
  NodeId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { buildAssistantChatEntries } from "./assistant-chat-entries";

const threadId = ThreadId.make("assistant");
const runId = RunId.make("run-1");
const timestamp = DateTime.makeUnsafe("2026-11-11T00:00:00.000Z");

function base(id: string, ordinal: number) {
  return {
    id: TurnItemId.make(id),
    threadId,
    runId,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed" as const,
    title: null,
    startedAt: timestamp,
    completedAt: timestamp,
    updatedAt: timestamp,
  };
}

const projected = (items: ReadonlyArray<OrchestrationV2TurnItem>) =>
  items.map((item, position): OrchestrationV2ProjectedTurnItem => ({
    position,
    visibility: "local",
    sourceThreadId: threadId,
    sourceItemId: item.id,
    item,
  }));

const user = (id: string, ordinal: number, text: string, senderThreadId?: string) =>
  ({
    ...base(id, ordinal),
    type: "user_message",
    messageId: MessageId.make(`message-${id}`),
    createdBy: "user",
    creationSource: "mobile",
    inputIntent: "turn_start",
    text,
    attachments: [],
    ...(senderThreadId ? { senderThreadId: ThreadId.make(senderThreadId) } : {}),
  }) as OrchestrationV2TurnItem;

const assistant = (id: string, ordinal: number, text: string, streaming = false) =>
  ({
    ...base(id, ordinal),
    type: "assistant_message",
    messageId: MessageId.make(`message-${id}`),
    text,
    streaming,
  }) as OrchestrationV2TurnItem;

const tool = (
  id: string,
  ordinal: number,
  toolName: string,
  output: unknown,
  status: "completed" | "failed" = "completed",
  input: unknown = { title: "Fix login" },
) =>
  ({
    ...base(id, ordinal),
    status,
    type: "dynamic_tool",
    toolName,
    input,
    output,
  }) as OrchestrationV2TurnItem;

describe("buildAssistantChatEntries", () => {
  it("keeps the conversation and turns thread launches into one card per thread", () => {
    const entries = buildAssistantChatEntries(
      projected([
        user("primer", 0, "Be my assistant"),
        assistant("hello", 1, "Ready."),
        user("ask", 2, "Fix the login bug"),
        { ...base("reasoning", 3), type: "reasoning", text: "thinking", streaming: false },
        tool("list", 4, "mcp__t3-code__t3_project_list", { projects: [] }),
        tool("launch", 5, "mcp__t3-code__t3_thread_launch", { threadId: "task-1" }),
        // A retry with the same clientRequestId returns the same thread.
        tool("retry", 6, "t3-code.t3_thread_launch", { threadId: "task-1" }),
        {
          ...base("created", 7),
          type: "thread_created",
          targetThreadId: ThreadId.make("task-1"),
          targetRunId: null,
          targetProviderInstanceId: ProviderInstanceId.make("codex"),
          targetModel: "gpt",
        } as OrchestrationV2TurnItem,
        tool(
          "batch",
          8,
          "t3-code.create_threads",
          { threads: [{ threadId: "task-2" }, { threadId: "task-3" }] },
          "completed",
          { environmentId: "mac-mini", threads: [] },
        ),
        assistant("done", 9, "Started three tasks.", true),
      ]),
      "message-primer",
    );
    expect(entries).toEqual([
      expect.objectContaining({ kind: "message", role: "user", primer: true }),
      expect.objectContaining({ kind: "message", role: "assistant", text: "Ready." }),
      expect.objectContaining({ kind: "message", role: "user", primer: false }),
      { kind: "task", id: "task:task-1", threadId: "task-1", environmentId: null },
      { kind: "task", id: "task:task-2", threadId: "task-2", environmentId: "mac-mini" },
      { kind: "task", id: "task:task-3", threadId: "task-3", environmentId: "mac-mini" },
      expect.objectContaining({ kind: "message", role: "assistant", streaming: true }),
    ]);
  });

  it("shows app-owned delegated tasks and task reports, and skips failed launches", () => {
    const entries = buildAssistantChatEntries(
      projected([
        tool("failed", 0, "t3_thread_launch", { threadId: "never" }, "failed"),
        tool("error", 1, "t3_thread_launch", { isError: true, content: [] }),
        {
          ...base("delegated", 2),
          type: "subagent",
          subagentId: NodeId.make("node-1"),
          origin: "app_owned",
          driver: "codex",
          providerInstanceId: ProviderInstanceId.make("codex"),
          childThreadId: ThreadId.make("child-1"),
          prompt: "Review it",
          result: null,
        } as unknown as OrchestrationV2TurnItem,
        user("report", 3, "Task finished", "child-1"),
        assistant("empty", 4, "  "),
      ]),
      undefined,
    );
    expect(entries).toEqual([
      { kind: "task", id: "task:child-1", threadId: "child-1", environmentId: null },
      expect.objectContaining({ kind: "message", role: "user", senderThreadId: "child-1" }),
    ]);
  });
});
