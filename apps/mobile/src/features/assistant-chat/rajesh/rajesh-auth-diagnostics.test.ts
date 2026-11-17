import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const storage = vi.hoisted(() => ({ value: "" }));
vi.mock("expo-file-system", () => ({
  Paths: { document: "/documents" },
  Directory: class {
    create() {}
  },
  File: class {
    parentDirectory = { create() {} };
    get exists() {
      return storage.value !== "";
    }
    textSync() {
      return storage.value;
    }
    writeSync(value: string) {
      storage.value = value;
    }
  },
}));
import { exportRajeshAuthDiagnostics, recordRajeshAuthEvent } from "./rajesh-auth-diagnostics";

describe("Rajesh connection diagnostics", () => {
  beforeEach(() => {
    storage.value = "";
  });
  it("retains only bounded, allowlisted events and times", () => {
    storage.value = JSON.stringify([
      { time: 1, event: "http_401", token: "secret" },
      { time: 2, event: "secret" },
    ]);
    for (let n = 0; n < 105; n++) recordRajeshAuthEvent("proof_error");
    const output = exportRajeshAuthDiagnostics();
    const data = JSON.parse(output);
    expect(data.events).toHaveLength(100);
    expect(data.events.every((entry: { event: string }) => entry.event === "proof_error")).toBe(
      true,
    );
    expect(output).not.toContain("secret");
  });
  it("strips unexpected fields and tolerates corrupt storage", () => {
    storage.value = JSON.stringify([{ time: 1, event: "http_401", token: "secret" }]);
    expect(exportRajeshAuthDiagnostics()).toBe(
      '{"format":1,"events":[{"time":1,"event":"http_401"}]}',
    );
    storage.value = "broken";
    expect(JSON.parse(exportRajeshAuthDiagnostics()).events).toEqual([]);
  });
});
