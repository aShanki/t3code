import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import { createdThreadIdsFromToolItem } from "@t3tools/shared/toolOutput";

export type AssistantChatEntry =
  | {
      readonly kind: "message";
      readonly id: string;
      readonly role: "user" | "assistant";
      readonly text: string;
      readonly streaming: boolean;
      /** The instructions that started the chat; shown collapsed. */
      readonly primer: boolean;
      /** A message another thread sent here, such as a task reporting back. */
      readonly senderThreadId: string | null;
    }
  | {
      readonly kind: "task";
      readonly id: string;
      readonly threadId: string;
      /** The machine a launch named; null means the chat's own. */
      readonly environmentId: string | null;
    };

/**
 * The chat transcript: conversation messages plus one card per thread the assistant started.
 * Tool calls, reasoning and other work stay in the full thread view.
 */
export function buildAssistantChatEntries(
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
  primerMessageId: string | undefined,
): ReadonlyArray<AssistantChatEntry> {
  const entries: AssistantChatEntry[] = [];
  // A retried launch returns the same thread, and a launch in this project also records
  // `thread_created`; one card per thread either way.
  const seenThreads = new Set<string>();
  const addTask = (threadId: string | null | undefined, environmentId: string | null = null) => {
    if (!threadId || seenThreads.has(threadId)) return;
    seenThreads.add(threadId);
    entries.push({ kind: "task", id: `task:${threadId}`, threadId, environmentId });
  };
  for (const { item } of items) {
    switch (item.type) {
      case "user_message":
        if (item.text.trim() === "" && item.attachments.length === 0) break;
        entries.push({
          kind: "message",
          id: item.id,
          role: "user",
          text: item.text,
          streaming: false,
          primer: item.messageId === primerMessageId,
          senderThreadId: item.senderThreadId ?? null,
        });
        break;
      case "assistant_message":
        if (item.text.trim() === "" && !item.streaming) break;
        entries.push({
          kind: "message",
          id: item.id,
          role: "assistant",
          text: item.text,
          streaming: item.streaming,
          primer: false,
          senderThreadId: null,
        });
        break;
      case "dynamic_tool":
        if (item.status === "failed" || item.status === "cancelled") break;
        for (const threadId of createdThreadIdsFromToolItem(item)) {
          addTask(threadId, launchEnvironmentId(item.input));
        }
        break;
      case "thread_created":
        addTask(item.targetThreadId);
        break;
      case "subagent":
        if (item.origin === "app_owned") addTask(item.childThreadId);
        break;
      default:
        break;
    }
  }
  return entries;
}

function launchEnvironmentId(input: unknown): string | null {
  if (typeof input !== "object" || input === null || !("environmentId" in input)) return null;
  const environmentId = input.environmentId;
  return typeof environmentId === "string" && environmentId.trim() !== "" ? environmentId : null;
}

/** Instructions for a new assistant chat, sent as its first message so they stay visible. */
export const ASSISTANT_CHAT_PRIMER = [
  "You are my main personal assistant in T3 Code. This thread is my persistent chat with you.",
  "",
  "- Answer questions and keep replies short.",
  "- When I ask for coding or project work, start a separate T3 Code task for each request with `t3_thread_launch` instead of doing the work here. Find the right project with `t3_project_list`, and ask me when it is unclear.",
  "- Give each task a short, specific title. After launching, reply with one line saying what started.",
  "- To check on tasks, use `t3_thread_list` and `t3_thread_read`; to pass on follow-ups, use `t3_thread_send`.",
  "",
  "Reply with a one-line greeting to confirm.",
].join("\n");
