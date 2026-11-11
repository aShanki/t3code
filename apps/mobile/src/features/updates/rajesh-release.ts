export interface RajeshRelease {
  readonly versionCode: number;
  readonly sha256: string;
}

/** The newer stable release in a GitHub "latest release" response, or null if there is none. */
export function parseRajeshRelease(value: unknown, currentVersion: number): RajeshRelease | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.draft !== false || record.prerelease !== false || typeof record.tag_name !== "string")
    return null;
  const match = /^rajesh-chat-v([1-9]\d*)$/.exec(record.tag_name);
  if (!match) return null;
  const versionCode = Number(match[1]);
  if (
    !Number.isSafeInteger(versionCode) ||
    versionCode <= currentVersion ||
    versionCode > 2100000000
  )
    return null;
  if (!Array.isArray(record.assets)) return null;
  const assets = record.assets.filter(
    (asset: unknown) =>
      typeof asset === "object" &&
      asset !== null &&
      (asset as Record<string, unknown>).name === "rajesh-chat-arm64.apk",
  );
  if (assets.length !== 1) return null;
  const asset = assets[0] as Record<string, unknown>;
  const url = `https://github.com/aShanki/t3code/releases/download/${record.tag_name}/rajesh-chat-arm64.apk`;
  if (
    asset.browser_download_url !== url ||
    typeof asset.digest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest)
  )
    return null;
  return { versionCode, sha256: asset.digest.slice(7) };
}
