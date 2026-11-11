import * as SecureStore from "expo-secure-store";

import { clearRajeshChatCache } from "./rajesh-chat-cache";
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

/** Signing out (a null token) also forgets the chat kept on the device. */
export function writeRajeshToken(baseUrl: string, token: string | null): Promise<void> {
  if (token === null) clearRajeshChatCache(baseUrl);
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

// History is a few kilobytes in the chat view, so a silent connection is given up on, and
// retried, sooner. Uploads and the long-poll set their own deadlines.
const REQUEST_TIMEOUT_MS = 15_000;

async function call<T>(
  baseUrl: string,
  path: string,
  init: {
    readonly token?: string;
    readonly body?: unknown;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  } = {},
): Promise<T> {
  const method = init.body === undefined ? "GET" : "POST";
  // A session is bound to this device's Keystore key; each request proves possession of it.
  const proof = init.token ? await rajeshDeviceProof(baseUrl, method, path) : undefined;
  // A connection that dies silently never answers. Without a deadline the request would hang,
  // and the chat would keep showing whatever it last heard, such as Rajesh still working.
  const request = new AbortController();
  const abort = () => request.abort();
  if (init.signal?.aborted) abort();
  init.signal?.addEventListener("abort", abort);
  const deadline = setTimeout(abort, init.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(proof ? { DPoP: proof } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: request.signal,
  }).finally(() => {
    clearTimeout(deadline);
    init.signal?.removeEventListener("abort", abort);
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

/**
 * The latest messages, without the tool activity the chat does not show. With the version of a
 * copy already held, an unchanged chat answers `unchanged` instead. Gateways that predate the
 * chat view send the full history and no version.
 */
export const readRajeshHistory = (
  baseUrl: string,
  token: string,
  key: string,
  known: string | null,
) =>
  call<{
    readonly task: RajeshTaskSummary;
    readonly messages?: ReadonlyArray<RajeshMessage>;
    readonly version?: string;
    readonly unchanged?: boolean;
  }>(baseUrl, `${taskPath(key)}?view=chat${known ? `&known=${encodeURIComponent(known)}` : ""}`, {
    token,
  });

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
    { token, signal: input.signal, timeoutMs: input.waitMs + 10_000 },
  );

export const readRajeshT3Threads = (
  baseUrl: string,
  token: string,
  key: string,
  known: string | null,
) =>
  call<{
    readonly threads?: ReadonlyArray<RajeshT3Thread>;
    readonly version?: string;
    readonly unchanged?: boolean;
  }>(baseUrl, `${taskPath(key)}/t3${known ? `?known=${encodeURIComponent(known)}` : ""}`, {
    token,
  });

/**
 * A single-use link, valid for a minute, to one file the session may read. The link carries no
 * credentials, so a plain download can fetch it.
 */
export const rajeshFileLink = async (baseUrl: string, token: string, attachmentId: string) =>
  baseUrl +
  (
    await call<{ readonly url: string }>(
      baseUrl,
      `/api/artifacts/${encodeURIComponent(attachmentId)}/ticket`,
      { token, body: {} },
    )
  ).url;

/** A file as the gateway takes it: base64 contents, one per message. */
export interface RajeshFile {
  readonly name: string;
  readonly mime?: string;
  readonly data: string;
}

/** Idempotent per request ID: a retry after a lost reply is not sent twice. */
export const sendRajeshMessage = (
  baseUrl: string,
  token: string,
  key: string,
  requestId: string,
  text: string,
  file?: RajeshFile,
) =>
  call<{ readonly accepted: boolean }>(baseUrl, `${taskPath(key)}/messages`, {
    token,
    body: { requestId, text, ...(file ? { files: [file] } : {}) },
    // An upload of several megabytes over a slow connection needs longer than a plain request.
    ...(file ? { timeoutMs: 120_000 } : {}),
  });

export const stopRajesh = (baseUrl: string, token: string, key: string, requestId: string) =>
  call<{ readonly accepted: boolean }>(baseUrl, `${taskPath(key)}/stop`, {
    token,
    body: { requestId },
  });

export const logoutRajesh = (baseUrl: string, token: string) =>
  call<{ readonly ok: boolean }>(baseUrl, "/api/logout", { token, body: {} });
