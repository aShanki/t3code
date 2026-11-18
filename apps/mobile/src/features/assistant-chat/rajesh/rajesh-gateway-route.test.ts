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
import { rajeshDeviceProof } from "./rajesh-device-key";
import {
  listRajeshTasks,
  rajeshErrorStatus,
  rajeshFileLink,
  rajeshRoute,
  readRajeshHistory,
} from "./rajesh-gateway";

const PUBLIC = "https://code.flarial.xyz";
const TAILNET = "https://rajesh-gb-1.tail044b4.ts.net:3781";

const answer = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (typeof body === "string") throw new SyntaxError("Unexpected token <");
    return body;
  },
});

beforeEach(() => {
  state.events = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("sends the default gateway's requests only over the tailnet, signed for its public origin", async () => {
  const fetch = vi.fn().mockResolvedValue(answer(200, { tasks: [] }));
  vi.stubGlobal("fetch", fetch);
  expect(rajeshRoute(PUBLIC)).toBe(TAILNET);
  expect(rajeshRoute("https://other.example")).toBe("https://other.example");
  await listRajeshTasks(PUBLIC, "token");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![0]).toBe(`${TAILNET}/api/tasks`);
  expect(vi.mocked(rajeshDeviceProof)).toHaveBeenCalledWith(PUBLIC, "GET", "/api/tasks");
});

it("a file link points at the tailnet address", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(200, { url: "/api/download?ticket=t" })));
  expect(await rajeshFileLink(PUBLIC, "token", "a1")).toBe(`${TAILNET}/api/download?ticket=t`);
});

it("an unreachable tailnet says to check Tailscale and never looks like an ended session", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Network request failed")));
  const error = await listRajeshTasks(PUBLIC, "token").catch((e: unknown) => e);
  expect((error as Error).message).toBe("Rajesh could not be reached. Check that Tailscale is on.");
  expect(rajeshErrorStatus(error)).toBeUndefined();
});

it("a block page or captive portal is an outage, not a 401/403 that sends the app to pairing", async () => {
  for (const response of [
    answer(403, "<html>Website blocked</html>"),
    answer(401, "<html>Sign in to the Wi-Fi</html>"),
    answer(200, "<html>Sign in to the Wi-Fi</html>"),
    answer(403, { error: "This tailnet address is only for the owner's devices." }),
    answer(403, { error: "Use the public Rajesh Code address." }),
  ]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const error = await readRajeshHistory(PUBLIC, "token", "k", null).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(rajeshErrorStatus(error)).toBeUndefined();
  }
});

it("the gateway's own refusals and errors keep their status", async () => {
  for (const [status, body] of [
    [401, { error: "Pair this device to continue." }],
    [403, { error: "This device does not have access to that task." }],
    [502, "<html>Bad gateway</html>"],
  ] as const) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(status, body)));
    const error = await listRajeshTasks(PUBLIC, "token").catch((e: unknown) => e);
    expect(rajeshErrorStatus(error)).toBe(status);
  }
});
