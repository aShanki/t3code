import { AsyncResult, Atom } from "effect/reactivity";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";

import { isPersonalFork } from "../../../lib/personalFork";
import type { RajeshChat } from "../../../persistence/mobile-preferences";
import { appAtomRegistry } from "../../../state/atom-registry";
import { mobilePreferencesAtom } from "../../../state/preferences";
import {
  setAndroidChatPush,
  supportsAndroidChatPush,
} from "../../agent-awareness/androidNotifications";
import {
  rajeshErrorStatus,
  readRajeshToken,
  registerRajeshPush,
  unregisterRajeshPush,
} from "./rajesh-gateway";

/**
 * - `unpaired`: the Chat tab is not connected to Rajesh, so there is nothing to push.
 * - `blocked`: Android notifications are turned off for the app.
 * - `unavailable`: the device or the gateway could not set push up; retried when the app opens.
 */
export type RajeshPushStatus = "off" | "unpaired" | "blocked" | "connecting" | "on" | "unavailable";

export const rajeshPushStatusAtom = Atom.make<RajeshPushStatus>("connecting").pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:rajesh-push:status"),
);

/** What the stored preferences ask for: the chat to push, or why there is none. */
function rajeshPushTarget(preferences: {
  readonly rajeshChat?: RajeshChat | undefined;
  readonly rajeshPushEnabled?: boolean | undefined;
}): RajeshChat | "off" | "unpaired" {
  if (preferences.rajeshPushEnabled === false) return "off";
  return preferences.rajeshChat ?? "unpaired";
}

const sameChat = (a: RajeshChat, b: RajeshChat) =>
  a.baseUrl === b.baseUrl && a.taskKey === b.taskKey;

/**
 * Keeps the Rajesh gateway holding this device's Firebase token while the chat is paired and
 * push is on, so Rajesh's messages and task updates arrive with the app closed. The native
 * notification service shows them; nothing here runs when a push arrives.
 */
export function installRajeshPush(): () => void {
  if (Platform.OS !== "android" || !isPersonalFork || !supportsAndroidChatPush()) return () => {};

  let target: RajeshChat | "off" | "unpaired" | null = null;
  let registered: { readonly chat: RajeshChat; readonly pushToken: string } | null = null;
  let permissionAsked = false;
  let running = false;
  let again = false;
  const setStatus = (status: RajeshPushStatus) => appAtomRegistry.set(rajeshPushStatusAtom, status);

  const syncOnce = async (): Promise<RajeshPushStatus | null> => {
    const wanted = target;
    if (wanted === null) return null;
    const chat = typeof wanted === "string" ? null : wanted;
    // The native switch works offline: a push for a chat turned off here is never shown.
    setAndroidChatPush(chat !== null);
    if (registered !== null && (chat === null || !sameChat(chat, registered.chat))) {
      const old = registered;
      registered = null;
      const session = await readRajeshToken(old.chat.baseUrl);
      if (session !== null) {
        await unregisterRajeshPush(old.chat.baseUrl, session, old.pushToken).catch(() => undefined);
      }
    }
    if (chat === null) return wanted === "off" ? "off" : "unpaired";

    let permission = await Notifications.getPermissionsAsync();
    if (
      !permission.granted &&
      permission.canAskAgain &&
      !permissionAsked &&
      AppState.currentState === "active"
    ) {
      permissionAsked = true;
      permission = await Notifications.requestPermissionsAsync();
    }
    if (!permission.granted) return "blocked";
    const session = await readRajeshToken(chat.baseUrl);
    if (session === null) return "unpaired";
    const pushToken = (await Notifications.getDevicePushTokenAsync()).data;
    if (typeof pushToken !== "string") return "unavailable";
    if (registered?.pushToken !== pushToken) {
      await registerRajeshPush(chat.baseUrl, session, chat.taskKey, pushToken);
      registered = { chat, pushToken };
    }
    return "on";
  };

  const sync = () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    void (async () => {
      do {
        again = false;
        const status = await syncOnce().catch((error: unknown) =>
          rajeshErrorStatus(error) === 401 ? ("unpaired" as const) : ("unavailable" as const),
        );
        if (status !== null && !again) setStatus(status);
      } while (again);
      running = false;
    })();
  };

  const stopPreferences = appAtomRegistry.subscribe(
    mobilePreferencesAtom,
    (preferences) => {
      if (!AsyncResult.isSuccess(preferences)) return;
      const next = rajeshPushTarget(preferences.value);
      const unchanged =
        typeof next === "string" || typeof target !== "object" || target === null
          ? next === target
          : sameChat(next, target);
      if (unchanged) return;
      target = next;
      if (typeof next !== "string") setStatus("connecting");
      sync();
    },
    { immediate: true },
  );
  // Firebase replaces tokens now and then, and a failed attempt is retried when the app opens.
  const tokens = Notifications.addPushTokenListener(sync);
  const appState = AppState.addEventListener("change", (state) => {
    if (state === "active" && appAtomRegistry.get(rajeshPushStatusAtom) !== "on") sync();
  });

  return () => {
    stopPreferences();
    tokens.remove();
    appState.remove();
  };
}
