import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import * as Notifications from "expo-notifications";
import { useState } from "react";
import { Linking } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

/** A personal fork's notifications: raised on this device instead of pushed by T3's relay. */
export function LocalNotificationsSettings() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const save = useAtomSet(updateMobilePreferencesAtom);
  const enabled =
    AsyncResult.isSuccess(preferences) && preferences.value.localAgentAlertsEnabled !== false;
  const [blocked, setBlocked] = useState(false);
  const setEnabled = (value: boolean) => {
    save({ localAgentAlertsEnabled: value });
    if (!value) return;
    void Notifications.getPermissionsAsync()
      .then((status) =>
        status.granted || !status.canAskAgain ? status : Notifications.requestPermissionsAsync(),
      )
      .then((status) => setBlocked(!status.granted))
      .catch(() => setBlocked(true));
  };
  return (
    <SettingsScreen title="Notifications">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-5 pt-4"
      >
        <SettingsSection title="Agent activity">
          <SettingsSwitchRow
            icon="bell.badge"
            label="Agent alerts"
            subtitle="Approvals, questions, and finished or failed threads, as T3 Code notifies them. While on, a silent notification keeps this app connected in the background."
            value={AsyncResult.isSuccess(preferences) ? enabled : null}
            onValueChange={setEnabled}
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
          This build cannot receive T3 Connect push notifications, so alerts arrive only while
          Android keeps the app running.
        </Text>
      </ScrollView>
    </SettingsScreen>
  );
}
