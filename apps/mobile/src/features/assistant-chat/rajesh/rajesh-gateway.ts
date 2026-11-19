import * as SecureStore from "expo-secure-store";

import { clearRajeshChatCache } from "./rajesh-chat-cache";
import { rajeshDeviceKeyThumbprint, rajeshDeviceProof } from "./rajesh-device-key";
import { recordRajeshAuthEvent } from "./rajesh-auth-diagnostics";
import type { RajeshCursor, RajeshMessage, RajeshT3Thread } from "./rajesh-transcript";

/** The gateway a build pairs with by default. Builds that name none ask for the address. */
export const DEFAULT_RAJESH_GATEWAY = process.env.EXPO_PUBLIC_RAJESH_GATEWAY ?? "";

const deviceOnly = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const tokenKey = (baseUrl: string) =>
  `t3code.rajesh.session.${baseUrl.replace(/[^A-Za-z0-9.-]/g, "_")}`;

export function readRajeshToken(baseUrl: string): Promise<string | null> {
  return SecureStore.getItemAsync(tokenKey(baseUrl), deviceOnly)
    .then((value) => {
      if (value === null) recordRajeshAuthEvent("token_missing");
      return value;
    })
    .catch(() => {
      recordRajeshAuthEvent("token_read_error");
      return null;
    });
}

/** Signing out (a null token) also forgets the chat kept on the device. */
export function writeRajeshToken(baseUrl: string, token: string | null): Promise<void> {
  if (token === null) clearRajeshChatCache(baseUrl);
  return token === null
    ? SecureStore.deleteItemAsync(tokenKey(baseUrl), deviceOnly).then(() => {
        recordRajeshAuthEvent("token_removed");
      })
    : SecureStore.setItemAsync(tokenKey(baseUrl), token, deviceOnly).then(() => {
        recordRajeshAuthEvent("token_saved");
      });
}

/** The gateway's HTTP status for a failed call, if it answered. */
export function rajeshErrorStatus(error: unknown): number | undefined {
  const status = error instanceof Error ? Reflect.get(error, "status") : undefined;
  return typeof status === "number" ? status : undefined;
}

/**
 * Where requests for a gateway travel when not to its public origin, which proofs stay signed for.
 * The default gateway is reached only through its tailnet-only relay: its public address was
 * blocked on the owner's work networks and is switched off. Without Tailscale, Rajesh is offline.
 */
const RAJESH_ROUTES: Readonly<Record<string, string>> = {
  "https://code.flarial.xyz": "https://rajesh-gb-1.tail044b4.ts.net:3781",
};

/** The address requests for `baseUrl` are sent to. */
export const rajeshRoute = (baseUrl: string): string => RAJESH_ROUTES[baseUrl] ?? baseUrl;

const unreachable = (baseUrl: string, cause?: unknown) =>
  new Error(
    rajeshRoute(baseUrl) === baseUrl
      ? "Rajesh could not be reached."
      : "Rajesh could not be reached. Check that Tailscale is on.",
    { cause },
  );

/** Refusals from the way in, not from the gateway judging this device. */
const ROUTE_REFUSALS = new Set([
  "Use the public Rajesh Code address.",
  "This tailnet address is only for the owner's devices.",
]);

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
  const proof = init.token
    ? await rajeshDeviceProof(baseUrl, method, path).catch((error: unknown) => {
        recordRajeshAuthEvent("proof_error");
        throw error;
      })
    : undefined;
  // A connection that dies silently never answers. Without a deadline the request would hang,
  // and the chat would keep showing whatever it last heard, such as Rajesh still working.
  const request = new AbortController();
  const abort = () => request.abort();
  if (init.signal?.aborted) abort();
  init.signal?.addEventListener("abort", abort);
  const deadline = setTimeout(abort, init.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const response = await fetch(rajeshRoute(baseUrl) + path, {
    method,
    headers: {
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(proof ? { DPoP: proof } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: request.signal,
  })
    .catch((error: unknown) => {
      if (init.signal?.aborted || !(error instanceof TypeError)) throw error;
      // Refused, reset or unresolvable: the way in is down, not the session.
      throw unreachable(baseUrl, error);
    })
    .finally(() => {
      clearTimeout(deadline);
      init.signal?.removeEventListener("abort", abort);
    });
  const notJson = Symbol("not JSON");
  const parsed: any = await response.json().catch(() => notJson);
  const data: any = parsed === notJson ? {} : parsed;
  // Only the gateway's own JSON refusal may end a session. A web filter's block page or a
  // captive portal answering in its place (even with a 200) is an outage.
  const fromGateway = parsed !== notJson && typeof data?.error === "string";
  if (response.ok && parsed === notJson) throw unreachable(baseUrl);
  if (!response.ok && response.status < 500 && (!fromGateway || ROUTE_REFUSALS.has(data.error)))
    throw unreachable(baseUrl);
  if (!response.ok) {
    if (response.status === 401) recordRajeshAuthEvent("http_401");
    if (response.status === 403) recordRajeshAuthEvent("http_403");
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
  signal?: AbortSignal,
) =>
  call<{
    readonly task: RajeshTaskSummary;
    readonly messages?: ReadonlyArray<RajeshMessage>;
    readonly version?: string;
    readonly unchanged?: boolean;
  }>(baseUrl, `${taskPath(key)}?view=chat${known ? `&known=${encodeURIComponent(known)}` : ""}`, {
    token,
    ...(signal ? { signal } : {}),
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
  signal?: AbortSignal,
) =>
  call<{
    readonly threads?: ReadonlyArray<RajeshT3Thread>;
    readonly version?: string;
    readonly unchanged?: boolean;
  }>(baseUrl, `${taskPath(key)}/t3${known ? `?known=${encodeURIComponent(known)}` : ""}`, {
    token,
    ...(signal ? { signal } : {}),
  });

/**
 * A single-use link, valid for a minute, to one file the session may read. The link carries no
 * credentials, so a plain download can fetch it.
 */
export const rajeshFileLink = async (baseUrl: string, token: string, attachmentId: string) =>
  rajeshRoute(baseUrl) +
  (
    await call<{ readonly url: string }>(
      baseUrl,
      `/api/artifacts/${encodeURIComponent(attachmentId)}/ticket`,
      { token, body: {} },
    )
  ).url;

/** A file sent inline as base64, for gateways without streamed uploads (8 MB per message). */
export interface RajeshFile {
  readonly name: string;
  readonly mime?: string;
  readonly data: string;
}

/** A file on the device that a message sends; it is uploaded on its own first. */
export interface RajeshOutgoingFile {
  readonly uploadId: string;
  readonly name: string;
  readonly mime: string;
  readonly uri: string;
  readonly size: number;
}

/**
 * Streams one file to the gateway's staging area, straight from disk. Idempotent per upload ID.
 * A gateway without streamed uploads answers 404.
 */
export async function uploadRajeshFile(
  baseUrl: string,
  token: string,
  key: string,
  file: RajeshOutgoingFile,
  onProgress?: (sentBytes: number) => void,
): Promise<void> {
  const path = `${taskPath(key)}/uploads/${file.uploadId}`;
  const proof = await rajeshDeviceProof(baseUrl, "PUT", path);
  const { File, UploadType } = await import("expo-file-system");
  const result = await new File(file.uri).upload(rajeshRoute(baseUrl) + path, {
    httpMethod: "PUT",
    uploadType: UploadType.BINARY_CONTENT,
    mimeType: "application/octet-stream",
    headers: { Authorization: `Bearer ${token}`, DPoP: proof },
    ...(onProgress ? { onProgress: (progress) => onProgress(progress.bytesSent) } : {}),
  });
  if (result.status === 200) return;
  let message = `Rajesh returned ${result.status}.`;
  try {
    const parsed = JSON.parse(result.body);
    if (typeof parsed?.error === "string") message = parsed.error;
  } catch {}
  throw Object.assign(new Error(message), { status: result.status });
}

/** Idempotent per request ID: a retry after a lost reply is not sent twice. */
export const sendRajeshMessage = (
  baseUrl: string,
  token: string,
  key: string,
  requestId: string,
  text: string,
  files: ReadonlyArray<
    RajeshFile | { readonly name: string; readonly mime: string; readonly upload: string }
  >,
) =>
  call<{ readonly accepted: boolean }>(baseUrl, `${taskPath(key)}/messages`, {
    token,
    body: { requestId, text, ...(files.length > 0 ? { files } : {}) },
    // Inline files of several megabytes over a slow connection need longer than a plain request.
    ...(files.some((file) => "data" in file) ? { timeoutMs: 120_000 } : {}),
  });

export const stopRajesh = (baseUrl: string, token: string, key: string, requestId: string) =>
  call<{ readonly accepted: boolean }>(baseUrl, `${taskPath(key)}/stop`, {
    token,
    body: { requestId },
  });

export const logoutRajesh = (baseUrl: string, token: string) =>
  call<{ readonly ok: boolean }>(baseUrl, "/api/logout", { token, body: {} });

/** Asks the gateway to push this chat's new messages to the device's Firebase token. */
export const registerRajeshPush = (
  baseUrl: string,
  token: string,
  key: string,
  pushToken: string,
) =>
  call<{ readonly ok: boolean }>(baseUrl, "/api/push/register", {
    token,
    body: { token: pushToken, task: key },
  });

export const unregisterRajeshPush = (baseUrl: string, token: string, pushToken: string) =>
  call<{ readonly ok: boolean }>(baseUrl, "/api/push/unregister", {
    token,
    body: { token: pushToken },
  });
