#!/usr/bin/env bash
# Builds and signs a Rajesh chat APK, and with --publish uploads it as this fork's GitHub release.
#
#   scripts/rajesh-chat-release.sh <version-code> [--publish]
#
# The app updates itself from the release tagged rajesh-chat-v<version-code>, so the code must be
# higher than every published one. The signing key never enters the repository or GitHub:
#   RAJESH_CHAT_SIGN            command run as `$RAJESH_CHAT_SIGN <unsigned.apk> <signed.apk>`
#   EXPO_PUBLIC_RAJESH_GATEWAY  gateway address built into the app
#   ANDROID_HOME                Android SDK with build-tools
#   RAJESH_CHAT_ABIS            optional, defaults to arm64-v8a (add x86_64 for emulator builds)
set -euo pipefail

# SHA-256 of the release signing certificate. Android refuses updates signed by any other key.
readonly CERTIFICATE=2cdc372dd1052bbd97af97158d0d80ff7e9082da0ba62443cfe8187d860328ff
readonly REPOSITORY=aShanki/t3code

version_code="${1:?usage: rajesh-chat-release.sh <version-code> [--publish]}"
publish="${2:-}"
[[ "$version_code" =~ ^[1-9][0-9]*$ ]] || { echo "version code must be a positive integer" >&2; exit 1; }
[[ -z "$publish" || "$publish" == --publish ]] || { echo "unknown option: $publish" >&2; exit 1; }
: "${RAJESH_CHAT_SIGN:?}" "${EXPO_PUBLIC_RAJESH_GATEWAY:?}" "${ANDROID_HOME:?}"

root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
tag="rajesh-chat-v$version_code"
commit="$(git -C "$root" rev-parse HEAD)"
if [[ -n "$publish" ]]; then
  [[ -z "$(git -C "$root" status --porcelain)" ]] || { echo "commit or stash changes before publishing" >&2; exit 1; }
  grep -q "^$commit" <<<"$(git -C "$root" ls-remote "https://github.com/$REPOSITORY.git")" ||
    { echo "push $commit to $REPOSITORY before publishing" >&2; exit 1; }
fi

# Public T3 Connect identifiers, the same ones official builds use.
set -a; . "$root/.env.example"; set +a
export APP_VARIANT=production NODE_ENV=production EXPO_NO_GIT_STATUS=1
export T3CODE_FORK_ANDROID_PACKAGE=tech.ashank.t3code.chat
export T3CODE_FORK_SCHEME=t3code-chat
export T3CODE_FORK_ANDROID_VERSION_CODE="$version_code"
export T3CODE_MOBILE_UPDATES_ENABLED=0

cd "$root/apps/mobile"
node_modules/.bin/expo prebuild --clean --platform android
(cd android && ./gradlew assembleRelease "-PreactNativeArchitectures=${RAJESH_CHAT_ABIS:-arm64-v8a}")

out="$root/apps/mobile/android/app/build/outputs/apk/release"
apk="$out/rajesh-chat-arm64.apk"
"$RAJESH_CHAT_SIGN" "$out/app-release.apk" "$apk"

build_tools="$(find "$ANDROID_HOME/build-tools/" -mindepth 1 -maxdepth 1 | sort -V | tail -1)"
# Captured first: with pipefail, a grep that stops reading early fails the pipeline.
certificates="$("$build_tools/apksigner" verify --print-certs "$apk")"
badging="$("$build_tools/aapt2" dump badging "$apk")"
grep -q "certificate SHA-256 digest: $CERTIFICATE" <<<"$certificates" ||
  { echo "the APK is not signed with the release certificate" >&2; exit 1; }
grep -q "package: name='$T3CODE_FORK_ANDROID_PACKAGE' versionCode='$version_code'" <<<"$badging" ||
  { echo "the APK does not carry version code $version_code" >&2; exit 1; }
sha256sum "$apk"

if [[ -n "$publish" ]]; then
  gh release create "$tag" "$apk" --repo "$REPOSITORY" --target "$commit" --title "Rajesh chat $version_code" \
    --notes "Signed Android build of this fork. The app checks this release, its SHA-256 and its signing certificate before offering the update."
fi
