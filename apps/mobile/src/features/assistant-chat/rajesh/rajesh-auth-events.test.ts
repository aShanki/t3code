import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ events: [] as string[] }));
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1, getItemAsync: vi.fn() }));
vi.mock("./rajesh-chat-cache", () => ({ clearRajeshChatCache: vi.fn() }));
vi.mock("./rajesh-device-key", () => ({
  rajeshDeviceKeyThumbprint: vi.fn(),
  rajeshDeviceProof: vi.fn().mockResolvedValue("test-proof"),
}));
vi.mock("./rajesh-auth-diagnostics", () => ({
  recordRajeshAuthEvent: (event: string) => state.events.push(event),
}));
import * as SecureStore from "expo-secure-store";
import { listRajeshTasks, readRajeshToken } from "./rajesh-gateway";

beforeEach(() => {
  state.events = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("distinguishes a missing token from a secure storage failure", async () => {
  vi.mocked(SecureStore.getItemAsync)
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(new Error("private error"));
  expect(await readRajeshToken("https://example.test")).toBeNull();
  expect(await readRajeshToken("https://example.test")).toBeNull();
  expect(state.events).toEqual(["token_missing", "token_read_error"]);
});

it("records only a fixed status label when the gateway rejects a session", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "private response" }),
    }),
  );
  await expect(listRajeshTasks("https://example.test", "private-token")).rejects.toMatchObject({
    status: 401,
  });
  expect(state.events).toEqual(["http_401"]);
});
