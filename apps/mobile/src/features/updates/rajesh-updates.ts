import * as Application from "expo-application";
import { requireOptionalNativeModule } from "expo";
import { AppState, Platform } from "react-native";
import * as Dialog from "../../components/ui/Dialog";
import { parseRajeshRelease } from "./rajesh-release";

interface NativeUpdater {
  installedVersion(): Promise<number>;
  installRelease(sha256: string, versionCode: number): Promise<void>;
}

const native = requireOptionalNativeModule<NativeUpdater>("T3DeviceKeys");
export const isRajeshUpdater =
  Platform.OS === "android" && Application.applicationId === "tech.ashank.t3code.chat";
let checking = false;
let installing = false;

export async function checkRajeshUpdate(manual = false): Promise<void> {
  if (!isRajeshUpdater || checking || installing) return;
  checking = true;
  try {
    if (!native) throw new Error("The update service is unavailable in this build.");
    const currentVersion = await native.installedVersion();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const response = await fetch("https://api.github.com/repos/aShanki/t3code/releases/latest", {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
    if (response.status === 404) {
      if (manual) Dialog.alert("Updates", "No release is available yet.");
      return;
    }
    if (!response.ok) throw new Error(`Update check failed (${response.status}).`);
    const release = parseRajeshRelease(await response.json(), currentVersion);
    if (!release) {
      if (manual) Dialog.alert("Updates", "No compatible newer release is available.");
      return;
    }
    Dialog.confirm({
      title: "Update available",
      message:
        "Download and install the latest Rajesh chat release? Android will ask you to confirm installation.",
      confirmText: "Download",
      onConfirm: () => {
        if (installing) return;
        installing = true;
        Dialog.alert(
          "Downloading update",
          "Android will open the installer after the download is verified.",
        );
        void native
          .installRelease(release.sha256, release.versionCode)
          .catch((error: unknown) => {
            Dialog.alert(
              "Could not install update",
              error instanceof Error ? error.message : "Try again.",
            );
          })
          .finally(() => {
            installing = false;
          });
      },
    });
  } catch (error) {
    if (manual)
      Dialog.alert(
        "Could not check for updates",
        error instanceof Error ? error.message : "Try again.",
      );
  } finally {
    checking = false;
  }
}

export function installRajeshUpdateChecks(): () => void {
  if (!isRajeshUpdater || __DEV__) return () => undefined;
  void checkRajeshUpdate();
  let backgroundedAt: number | undefined;
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "background") backgroundedAt = Date.now();
    if (state === "active" && backgroundedAt !== undefined) {
      if (Date.now() - backgroundedAt >= 15 * 60 * 1000) void checkRajeshUpdate();
      backgroundedAt = undefined;
    }
  });
  return () => subscription.remove();
}
