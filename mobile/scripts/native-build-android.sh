#!/usr/bin/env bash
set -euo pipefail

export EXPO_NO_GIT_STATUS=1
export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-https://www.gymflow.ng}"

mkdir -p artifacts/android
{
  npx expo prebuild --platform android --clean --no-install
  (
    cd android
    ./gradlew --no-daemon -PreactNativeArchitectures=arm64-v8a,x86_64 assembleRelease bundleRelease
  )
} 2>&1 | tee artifacts/android/build.log

apk=android/app/build/outputs/apk/release/app-release.apk
aab=android/app/build/outputs/bundle/release/app-release.aab
test -s "$apk"
test -s "$aab"
cp "$apk" artifacts/android/gymflow-internal-debug-signed-release.apk
cp "$aab" artifacts/android/gymflow-internal-debug-signed-release.aab
{
  echo "git_sha=${GITHUB_SHA:-local}"
  echo "api_url=$EXPO_PUBLIC_API_URL"
  echo "abis=arm64-v8a,x86_64"
  echo "node=$(node --version)"
  echo "java=$(java -version 2>&1 | head -1)"
  echo "gradle=$(cd android && ./gradlew --version | sed -n 's/^Gradle /Gradle /p')"
} > artifacts/android/build-info.txt

# The account-free artifact uses the generated development keystore, but it must
# still have production runtime behavior and must never be Android-debuggable.
build_tools_dir="$(find "${ANDROID_HOME:?}/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
test -x "$build_tools_dir/aapt"
badging="$("$build_tools_dir/aapt" dump badging "$apk")"
printf '%s\n' "$badging" > artifacts/android/manifest-badging.txt
if grep -q "application-debuggable" <<<"$badging"; then
  echo "Release APK is unexpectedly debuggable" >&2
  exit 1
fi
permissions="$("$build_tools_dir/aapt" dump permissions "$apk")"
printf '%s\n' "$permissions" > artifacts/android/manifest-permissions.txt
for blocked in RECORD_AUDIO READ_MEDIA_IMAGES READ_MEDIA_VIDEO READ_EXTERNAL_STORAGE WRITE_EXTERNAL_STORAGE SYSTEM_ALERT_WINDOW; do
  if grep -Fq "android.permission.$blocked'" <<<"$permissions"; then
    echo "Release APK retains an unnecessary permission: $blocked" >&2
    exit 1
  fi
done
test -x "$build_tools_dir/apksigner"
"$build_tools_dir/apksigner" verify --print-certs "$apk" > artifacts/android/signature.txt
