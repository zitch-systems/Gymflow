#!/usr/bin/env bash
set -euo pipefail

export EXPO_NO_GIT_STATUS=1
export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-https://www.gymflow.ng}"

mkdir -p artifacts/ios-device
{
  npx expo prebuild --platform ios --clean
  xcodebuild archive \
    -workspace ios/GymFlow.xcworkspace \
    -scheme GymFlow \
    -configuration Release \
    -sdk iphoneos \
    -destination 'generic/platform=iOS' \
    -archivePath build/ios-device/GymFlow.xcarchive \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO
} 2>&1 | tee artifacts/ios-device/build.log

archive=build/ios-device/GymFlow.xcarchive
app="$archive/Products/Applications/GymFlow.app"
test -d "$app"

ditto -c -k --sequesterRsrc --keepParent "$archive" artifacts/ios-device/GymFlow-unsigned-device.xcarchive.zip
payload_dir="$(mktemp -d)"
mkdir -p "$payload_dir/Payload"
ditto "$app" "$payload_dir/Payload/GymFlow.app"
(
  cd "$payload_dir"
  zip -qry "$OLDPWD/artifacts/ios-device/GymFlow-unsigned-device.ipa" Payload
)
rm -rf "$payload_dir"

{
  echo "git_sha=${GITHUB_SHA:-local}"
  echo "api_url=$EXPO_PUBLIC_API_URL"
  echo "device_arch=arm64"
  echo "code_signing=disabled"
  echo "node=$(node --version)"
  xcodebuild -version | tr '\n' ' '
  echo
} > artifacts/ios-device/build-info.txt
