import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";

import type { AssistantChat, RajeshChat } from "../../persistence/mobile-preferences";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import type { QueuedThreadMessage } from "../../state/thread-outbox";

/** `undefined` while preferences load, `null` when no chat is set up. */
export function useAssistantChat(): AssistantChat | null | undefined {
  const preferences = useAtomValue(mobilePreferencesAtom);
  if (!AsyncResult.isSuccess(preferences)) return undefined;
  return preferences.value.assistantChat ?? null;
}

export function useRememberAssistantChat() {
  const update = useAtomSet(updateMobilePreferencesAtom);
  return (message: QueuedThreadMessage) =>
    update({
      assistantChat: {
        environmentId: String(message.environmentId),
        threadId: String(message.threadId),
        primerMessageId: String(message.messageId),
      },
    });
}

/** `undefined` while preferences load, `null` when Chat is not connected to Rajesh. */
export function useRajeshChat(): RajeshChat | null | undefined {
  const preferences = useAtomValue(mobilePreferencesAtom);
  if (!AsyncResult.isSuccess(preferences)) return undefined;
  return preferences.value.rajeshChat ?? null;
}

export function useSetRajeshChat() {
  const update = useAtomSet(updateMobilePreferencesAtom);
  return (chat: RajeshChat | undefined) => update({ rajeshChat: chat });
}

/** Unlinks the chat; its thread stays in Threads. */
export function useForgetAssistantChat() {
  const update = useAtomSet(updateMobilePreferencesAtom);
  // Patches merge over stored values, so the key is cleared explicitly rather than omitted.
  return () => update({ assistantChat: undefined });
}
