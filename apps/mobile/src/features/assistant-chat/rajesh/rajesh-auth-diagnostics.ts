import { Directory, File, Paths } from "expo-file-system";

// Only fixed event names and timestamps are retained. Never pass errors or request data here.
const events = [
  "token_missing",
  "token_read_error",
  "token_saved",
  "token_removed",
  "key_reset",
  "proof_error",
  "http_401",
  "http_403",
] as const;
export type RajeshAuthEvent = (typeof events)[number];
type Entry = { time: number; event: RajeshAuthEvent };
const file = () => new File(new Directory(Paths.document, "rajesh-diagnostics"), "auth.json");
const read = (): Entry[] => {
  try {
    const f = file();
    if (!f.exists) return [];
    const data: unknown = JSON.parse(f.textSync());
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (entry): entry is Entry =>
          typeof entry?.time === "number" &&
          Number.isFinite(entry.time) &&
          events.includes(entry?.event),
      )
      .map(({ time, event }) => ({ time, event }))
      .slice(-100);
  } catch {
    return [];
  }
};

export function recordRajeshAuthEvent(event: RajeshAuthEvent): void {
  try {
    const f = file();
    const entries = [...read(), { time: Date.now(), event }].slice(-100);
    f.parentDirectory.create({ idempotent: true, intermediates: true });
    f.writeSync(JSON.stringify(entries));
  } catch {
    /* Diagnostics must never prevent chat use. */
  }
}

/** Safe to copy explicitly: no tokens, URLs, keys, request data, or messages. */
export function exportRajeshAuthDiagnostics(): string {
  return JSON.stringify({ format: 1, events: read() });
}
