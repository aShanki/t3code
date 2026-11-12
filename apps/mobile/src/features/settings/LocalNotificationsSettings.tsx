import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import * as Notifications from "expo-notifications";
import { useState } from "react";
import { Linking } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { supportsAndroidChatPush } from "../agent-awareness/androidNotifications";
import { rajeshPushStatusAtom, type RajeshPushStatus } from "../assistant-chat/rajesh/rajesh-push";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

const PUSH_STATUS_TEXT: Record<RajeshPushStatus, string | null> = {
  off: null,
  on: "Push is set up on this device.",
  connecting: "Setting up push…",
  unpaired: "Connect to Rajesh in the Chat tab to receive push notifications.",
  blocked: null,
  unavailable:
    "Push could not be set up. It needs Google Play services and a connection to Rajesh, and is tried again each time the app opens.",
};

/** A personal fork's notifications: pushed by its own Rajesh gateway, or raised on this device. */
export function LocalNotificationsSettings() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const save = useAtomSet(updateMobilePreferencesAtom);
  const loaded = AsyncResult.isSuccess(preferences);
  const alertsEnabled = loaded && preferences.value.localAgentAlertsEnabled !== false;
  const pushEnabled = loaded && preferences.value.rajeshPushEnabled !== false;
  const pushStatus = useAtomValue(rajeshPushStatusAtom);
  const [denied, setDenied] = useState(false);
  const blocked = denied || (pushEnabled && pushStatus === "blocked");
  const askPermission = () =>
    void Notifications.getPermissionsAsync()
      .then((status) =>
        status.granted || !status.canAskAgain ? status : Notifications.requestPermissionsAsync(),
      )
      .then((status) => setDenied(!status.granted))
      .catch(() => setDenied(true));
  const pushText = pushEnabled ? PUSH_STATUS_TEXT[pushStatus] : null;
  return (
    <SettingsScreen title="Notifications">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-5 pt-4"
      >
        {supportsAndroidChatPush() ? (
          <SettingsSection title="Rajesh">
            <SettingsSwitchRow
              icon="questionmark.bubble"
              label="Push notifications"
              subtitle="Rajesh's messages and task updates: finished, failed, questions and approvals. Delivered even when the app is closed."
              value={loaded ? pushEnabled : null}
              onValueChange={(value) => {
                save({ rajeshPushEnabled: value });
                if (value) askPermission();
              }}
            />
          </SettingsSection>
        ) : null}
        {pushText ? <Text className="text-sm text-foreground-muted">{pushText}</Text> : null}
        <SettingsSection title="Agent activity">
          <SettingsSwitchRow
            icon="bell.badge"
            label="Agent alerts"
            subtitle="Approvals, questions, and finished or failed threads, raised by this device the moment they happen. While on, a silent notification keeps this app connected in the background."
            value={loaded ? alertsEnabled : null}
            onValueChange={(value) => {
              save({ localAgentAlertsEnabled: value });
              if (value) askPermission();
            }}
          />
        </SettingsSection>
        {blocked ? (
          <>
            <Text className="text-sm text-foreground-muted">
              Notifications are turned off for this app in Android settings.
            </Text>
            <Button label="Open settings" onPress={() => void Linking.openSettings()} />
          </>
        ) : null}
        <Text className="text-sm text-foreground-muted">
          Agent alerts come from the app's own connections, so they stop when Android closes the
          app. Push notifications do not.
        </Text>
      </ScrollView>
    </SettingsScreen>
  );
}
