import { describe, expect, it } from "vite-plus/test";

import { knownOrigin, taskMeta, taskModelLabel } from "./task-details";

describe("task card details", () => {
  it("names a model by its name and version, whatever account or date its ID carries", () => {
    expect(taskModelLabel("claude-fable-5-2")).toBe("Fable 5.2");
    expect(taskModelLabel("personal/claude-fable-5-2")).toBe("Fable 5.2");
    expect(taskModelLabel("claude-opus-5-5[1m]")).toBe("Opus 5.5");
    expect(taskModelLabel("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
    expect(taskModelLabel("gpt-6.1-sol")).toBe("GPT-6.1 Sol");
    expect(taskModelLabel("gemini-3-pro")).toBe("Gemini 3 Pro");
    expect(taskModelLabel("claude")).toBe("Claude");
    expect(taskModelLabel(" ")).toBeNull();
    expect(taskModelLabel(undefined)).toBeNull();
  });
  it("lists machine, model and origin in that order and leaves out what is unknown", () => {
    expect(taskMeta({ machine: "rajesh-gb-1", model: "claude-fable-5-2", origin: "app" })).toEqual([
      "rajesh-gb-1",
      "Fable 5.2",
      "via app",
    ]);
    expect(taskMeta({ machine: "Mac mini", model: null, origin: "discord" })).toEqual([
      "Mac mini",
      "via Discord",
    ]);
    expect(taskMeta({ machine: null, model: "gpt-6.1-sol", origin: "t3" })).toEqual([
      "GPT-6.1 Sol",
      "started in T3",
    ]);
    expect(taskMeta({ machine: " ", model: null, origin: knownOrigin("moon") })).toEqual([]);
  });
});
