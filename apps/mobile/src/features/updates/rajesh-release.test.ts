import { describe, expect, it } from "vite-plus/test";
import { parseRajeshRelease } from "./rajesh-release";

const release = {
  draft: false,
  prerelease: false,
  tag_name: "rajesh-chat-v3",
  assets: [
    {
      name: "rajesh-chat-arm64.apk",
      browser_download_url:
        "https://github.com/aShanki/t3code/releases/download/rajesh-chat-v3/rajesh-chat-arm64.apk",
      digest: `sha256:${"a".repeat(64)}`,
    },
  ],
};

describe("Rajesh release selection", () => {
  it("accepts only a newer stable release with an exact asset and SHA-256 digest", () => {
    expect(parseRajeshRelease(release, 2)).toEqual({ versionCode: 3, sha256: "a".repeat(64) });
    expect(parseRajeshRelease(release, 3)).toBeNull();
    expect(parseRajeshRelease({ ...release, prerelease: true }, 2)).toBeNull();
    expect(parseRajeshRelease({ ...release, tag_name: "rajesh-chat-v3-beta" }, 2)).toBeNull();
    expect(
      parseRajeshRelease({ ...release, assets: [{ ...release.assets[0], digest: null }] }, 2),
    ).toBeNull();
    expect(
      parseRajeshRelease(
        {
          ...release,
          assets: [{ ...release.assets[0], browser_download_url: "https://evil.example/app.apk" }],
        },
        2,
      ),
    ).toBeNull();
  });
});
