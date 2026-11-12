/** Where a task was started: asked for in a Rajesh app, asked for in Discord, or started in T3. */
export type TaskOrigin = "app" | "discord" | "t3";
const TASK_ORIGINS: ReadonlyArray<string> = ["app", "discord", "t3"];

/**
 * What a task card says under the task's name. Each part is null when nobody has said it: the
 * card leaves it out, and has no detail line when it knows none.
 */
export interface TaskDetails {
  readonly project: string | null;
  readonly machine: string | null;
  readonly model: string | null;
  readonly origin: TaskOrigin | null;
}

/** A value from the gateway or a saved chat, which may be of any version. */
export const knownText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export const knownOrigin = (value: unknown): TaskOrigin | null =>
  TASK_ORIGINS.includes(String(value)) ? (value as TaskOrigin) : null;

/** A model as a card names it: "personal/claude-fable-5-2" reads "Fable 5.2". */
export function taskModelLabel(model: unknown): string | null {
  const id = (knownText(model) ?? "")
    .split("/")
    .pop()!
    .replace(/\[[^\]]*\]$/, "");
  const words: string[] = [];
  for (const part of id.split("-").filter(Boolean)) {
    const previous = words.at(-1);
    // A trailing release date says nothing on a card.
    if (/^\d{8}$/.test(part)) continue;
    // "5-2" is version 5.2.
    if (/^\d{1,2}$/.test(part) && previous !== undefined && /^\d{1,2}$/.test(previous)) {
      words[words.length - 1] = `${previous}.${part}`;
    } else words.push(part);
  }
  if (words[0] === "claude" && words.length > 1) words.shift();
  if (words.length === 0) return null;
  const named = words.map((word) =>
    word === "gpt" ? "GPT" : word.charAt(0).toUpperCase() + word.slice(1),
  );
  // "GPT-6.1 Sol", as its maker writes it.
  if (named[0] === "GPT" && named.length > 1) named.splice(0, 2, `GPT-${named[1]}`);
  return named.join(" ");
}

const ORIGIN_LABELS: Readonly<Record<TaskOrigin, string>> = {
  app: "via app",
  discord: "via Discord",
  t3: "started in T3",
};

// T3's name for the space a task with no project runs in; it says nothing on a card.
const NO_PROJECT = "No project";

/** The project as a card names it, or null when there is none to name. */
export const taskProjectLabel = (project: unknown): string | null =>
  knownText(project) === NO_PROJECT ? null : knownText(project);

/** A card's detail line: project, machine, model, origin. Unknown parts are left out. */
export function taskMeta(details: TaskDetails): ReadonlyArray<string> {
  return [
    taskProjectLabel(details.project),
    knownText(details.machine),
    taskModelLabel(details.model),
    details.origin === null ? null : (ORIGIN_LABELS[details.origin] ?? null),
  ].filter((part): part is string => part !== null);
}
