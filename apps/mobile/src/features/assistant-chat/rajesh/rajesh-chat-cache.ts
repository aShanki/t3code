import { Directory, File, Paths } from "expo-file-system";

import type { RajeshMessage, RajeshT3Thread } from "./rajesh-transcript";

/** The last synced chat, shown at launch while the gateway confirms or replaces it. */
export interface RajeshChatSnapshot {
  readonly taskKey: string;
  readonly messages: ReadonlyArray<RajeshMessage>;
  readonly threads: ReadonlyArray<RajeshT3Thread>;
  /** The gateway's version of `messages`; null from gateways that predate versions. */
  readonly version: string | null;
  readonly threadsVersion: string | null;
}

const FORMAT = 1;
/** The gateway's history window; older messages are not shown at launch either. */
const KEEP_MESSAGES = 200;

// The cache directory is excluded from Android backups and can be cleared by the system.
const cacheFile = (baseUrl: string) =>
  new File(
    new Directory(Paths.cache, "rajesh-chat"),
    `${baseUrl.replace(/[^A-Za-z0-9.-]/g, "_")}.json`,
  );

export async function readRajeshChatCache(
  baseUrl: string,
  taskKey: string,
): Promise<RajeshChatSnapshot | null> {
  try {
    const file = cacheFile(baseUrl);
    if (!file.exists) return null;
    const value = JSON.parse(await file.text());
    if (value?.format !== FORMAT || value.taskKey !== taskKey || !Array.isArray(value.messages))
      return null;
    return {
      taskKey,
      messages: value.messages,
      threads: Array.isArray(value.threads) ? value.threads : [],
      version: typeof value.version === "string" ? value.version : null,
      threadsVersion: typeof value.threadsVersion === "string" ? value.threadsVersion : null,
    };
  } catch {
    return null;
  }
}

export function writeRajeshChatCache(baseUrl: string, snapshot: RajeshChatSnapshot): void {
  try {
    const file = cacheFile(baseUrl);
    file.parentDirectory.create({ idempotent: true, intermediates: true });
    // A write cut short leaves JSON that does not parse, which reads as no cache.
    file.writeSync(
      JSON.stringify({
        format: FORMAT,
        ...snapshot,
        messages: snapshot.messages.slice(-KEEP_MESSAGES),
      }),
    );
  } catch (error) {
    console.warn("[rajesh] could not save the chat for offline launch", error);
  }
}

export function clearRajeshChatCache(baseUrl: string): void {
  try {
    const file = cacheFile(baseUrl);
    if (file.exists) file.delete();
  } catch {}
}
