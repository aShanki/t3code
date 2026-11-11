import { beginForegroundHandoff } from "../../../lib/foreground-handoff";
import type { RajeshFile } from "./rajesh-gateway";

/** The gateway accepts one file per message, up to this size. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** One file from Android's picker, read into memory; null if the picker was dismissed. */
export async function pickRajeshFile(): Promise<RajeshFile | null> {
  const { getDocumentAsync } = await import("expo-document-picker");
  const endHandoff = beginForegroundHandoff();
  // A cache copy, because the picker's provider URIs are not always readable directly.
  const result = await getDocumentAsync({ multiple: false, copyToCacheDirectory: true }).finally(
    endHandoff,
  );
  const asset = result.canceled ? undefined : result.assets[0];
  if (asset === undefined) return null;
  const { File } = await import("expo-file-system");
  const copy = new File(asset.uri);
  try {
    if (copy.size > MAX_FILE_BYTES) throw new Error("Rajesh chat accepts files up to 8 MB.");
    return {
      name: asset.name.trim() || "file",
      ...(asset.mimeType ? { mime: asset.mimeType } : {}),
      data: await copy.base64(),
    };
  } finally {
    copy.delete();
  }
}
