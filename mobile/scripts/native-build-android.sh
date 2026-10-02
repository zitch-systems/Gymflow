#!/usr/bin/env bash
set -euo pipefail

export EXPO_NO_GIT_STATUS=1
export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-https://www.gymflow.ng}"

npx expo prebuild --platform android --clean --no-install
(
  cd android
  ./gradlew --no-daemon assembleRelease bundleRelease
)

apk=android/app/build/outputs/apk/release/app-release.apk
aab=android/app/build/outputs/bundle/release/app-release.aab
test -s "$apk"
test -s "$aab"

# The account-free artifact uses the generated development keystore, but it must
# still have production runtime behavior and must never be Android-debuggable.
if command -v apkanalyzer >/dev/null 2>&1; then
  test "$(apkanalyzer manifest debuggable "$apk")" = "false"
elif command -v aapt >/dev/null 2>&1; then
  ! aapt dump badging "$apk" | grep -q "application-debuggable"
else
  echo "Android SDK manifest inspector not found" >&2
  exit 1
fi

if command -v apksigner >/dev/null 2>&1; then
  apksigner verify "$apk"
fi

mkdir -p artifacts/android
cp "$apk" artifacts/android/gymflow-internal-debug-signed-release.apk
cp "$aab" artifacts/android/gymflow-internal-debug-signed-release.aab
