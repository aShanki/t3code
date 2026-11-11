import * as SecureStore from "expo-secure-store";

import { rajeshDeviceKeyThumbprint, rajeshDeviceProof } from "./rajesh-device-key";
import type { RajeshCursor, RajeshMessage, RajeshT3Thread } from "./rajesh-transcript";

/** The gateway a build pairs with by default. Builds that name none ask for the address. */
export const DEFAULT_RAJESH_GATEWAY = process.env.EXPO_PUBLIC_RAJESH_GATEWAY ?? "";

const deviceOnly = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const tokenKey = (baseUrl: string) =>
  `t3code.rajesh.session.${baseUrl.replace(/[^A-Za-z0-9.-]/g, "_")}`;

export function readRajeshToken(baseUrl: string): Promise<string | null> {
  return SecureStore.getItemAsync(tokenKey(baseUrl), deviceOnly).catch(() => null);
}

export function writeRajeshToken(baseUrl: string, token: string | null): Promise<void> {
  return token === null
    ? SecureStore.deleteItemAsync(tokenKey(baseUrl), deviceOnly)
    : SecureStore.setItemAsync(tokenKey(baseUrl), token, deviceOnly);
}

/** The gateway's HTTP status for a failed call, if it answered. */
export function rajeshErrorStatus(error: unknown): number | undefined {
  const status = error instanceof Error ? Reflect.get(error, "status") : undefined;
  return typeof status === "number" ? status : undefined;
}

export function normalizeRajeshGateway(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    // Session tokens travel in a header; only loopback (for local testing) may skip TLS.
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function call<T>(
  baseUrl: string,
  path: string,
  init: { readonly token?: string; readonly body?: unknown; readonly signal?: AbortSignal } = {},
): Promise<T> {
  const method = init.body === undefined ? "GET" : "POST";
  // A session is bound to this device's Keystore key; each request proves possession of it.
  const proof = init.token ? await rajeshDeviceProof(baseUrl, method, path) : undefined;
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(proof ? { DPoP: proof } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    ...(init.signal ? { signal: init.signal } : {}),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(
      new Error(
        typeof data?.error === "string" ? data.error : `Rajesh returned ${response.status}.`,
      ),
      { status: response.status },
    );
  }
  return data as T;
}

export interface RajeshDeviceLogin {
  readonly id: string;
  readonly code: string;
  readonly secret: string;
  readonly expiresAt: number;
}

/** Starts pairing bound to this device's key. */
export const startRajeshDevice = async (baseUrl: string) =>
  call<RajeshDeviceLogin>(baseUrl, "/api/device/start", {
    body: { jkt: await rajeshDeviceKeyThumbprint(baseUrl) },
  });

export const pollRajeshDevice = (baseUrl: string, login: RajeshDeviceLogin) =>
  call<{ readonly status: string; readonly token?: string }>(baseUrl, "/api/device/poll", {
    body: { id: login.id, secret: login.secret, native: true },
  });

export interface RajeshTaskSummary {
  readonly key: string;
  readonly title: string;
  readonly status: string;
  readonly canWrite: boolean;
}

export const listRajeshTasks = (baseUrl: string, token: string) =>
  call<{ readonly tasks: ReadonlyArray<RajeshTaskSummary> }>(baseUrl, "/api/tasks", { token });

const taskPath = (key: string) => `/api/tasks/${encodeURIComponent(key)}`;

export const readRajeshHistory = (
  baseUrl: string,
  token: string,
  key: string,
  before?: RajeshCursor,
) =>
  call<{ readonly task: RajeshTaskSummary; readonly messages: ReadonlyArray<RajeshMessage> }>(
    baseUrl,
    taskPath(key) +
      (before ? `?beforeTime=${before.time}&beforeId=${encodeURIComponent(before.id)}` : ""),
    { token },
  );

/** Messages after the cursor; waits up to `waitMs` for one, or for the run status to change. */
export const readRajeshUpdates = (
  baseUrl: string,
  token: string,
  key: string,
  input: {
    readonly after: RajeshCursor;
    readonly status: string | null;
    readonly waitMs: number;
    readonly signal: AbortSignal;
  },
) =>
  call<{ readonly messages: ReadonlyArray<RajeshMessage>; readonly status: string }>(
    baseUrl,
    `${taskPath(key)}/updates?afterTime=${input.after.time}&afterId=${encodeURIComponent(input.after.id)}&waitMs=${input.waitMs}` +
      (input.status === null ? "" : `&status=${encodeURIComponent(input.status)}`),
    { token, signal: input.signal },
  );

export const readRajeshT3Threads = (baseUrl: string, token: string, key: string) =>
  call<{ readonly threads: ReadonlyArray<RajeshT3Thread> }>(baseUrl, `${taskPath(key)}/t3`, {
    token,
  });

/** Idempotent per request ID: a retry after a lost reply is not sent twice. */
export const sendRajeshMessage = (
  baseUrl: string,
  token: string,
  key: string,
  requestId: string,
  text: string,
) =>
  call<{ readonly accepted: boolean }>(baseUrl, `${taskPath(key)}/messages`, {
    token,
    body: { requestId, text },
  });

export const stopRajesh = (baseUrl: string, token: string, key: string, requestId: string) =>
  call<{ readonly accepted: boolean }>(baseUrl, `${taskPath(key)}/stop`, {
    token,
    body: { requestId },
  });

export const logoutRajesh = (baseUrl: string, token: string) =>
  call<{ readonly ok: boolean }>(baseUrl, "/api/logout", { token, body: {} });
