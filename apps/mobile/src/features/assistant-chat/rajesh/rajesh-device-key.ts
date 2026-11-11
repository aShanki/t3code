import { requireOptionalNativeModule } from "expo";
import * as Base64Url from "effect/encoding/Base64Url";

import { uuidv4 } from "../../../lib/uuid";

interface NativeDeviceKeys {
  ensureKey(
    alias: string,
  ): Promise<{ readonly x: string; readonly y: string; readonly jkt: string }>;
  sign(alias: string, data: string): Promise<string>;
  deleteKey(alias: string): Promise<void>;
}

const native = requireOptionalNativeModule<NativeDeviceKeys>("T3DeviceKeys");

/** One Keystore key per gateway; the alias names it, it is not a secret. */
const alias = (baseUrl: string) => `t3code.rajesh.${new URL(baseUrl).host}`;

function keys(): NativeDeviceKeys {
  if (!native) throw new Error("This device cannot create a secure key for Rajesh.");
  return native;
}

const encode = (value: unknown) =>
  Base64Url.encode(new TextEncoder().encode(JSON.stringify(value)));

/** The key's thumbprint, for pairing. Creates the key on first use. */
export async function rajeshDeviceKeyThumbprint(baseUrl: string): Promise<string> {
  return (await keys().ensureKey(alias(baseUrl))).jkt;
}

/** A fresh key for a new pairing, so an old session's key is never reused. */
export async function resetRajeshDeviceKey(baseUrl: string): Promise<void> {
  await keys().deleteKey(alias(baseUrl));
}

/** A single-use proof that this request comes from the paired device (DPoP shape, RFC 9449). */
export async function rajeshDeviceProof(baseUrl: string, method: string, path: string) {
  const { x, y } = await keys().ensureKey(alias(baseUrl));
  const signingInput = `${encode({ typ: "dpop+jwt", alg: "ES256", jwk: { kty: "EC", crv: "P-256", x, y } })}.${encode(
    {
      htm: method,
      htu: baseUrl + path.split("?")[0],
      iat: Math.floor(Date.now() / 1000),
      jti: uuidv4(),
    },
  )}`;
  return `${signingInput}.${await keys().sign(alias(baseUrl), signingInput)}`;
}
