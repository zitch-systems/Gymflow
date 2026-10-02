#!/usr/bin/env bash
set -euo pipefail

export EXPO_NO_GIT_STATUS=1
export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-https://www.gymflow.ng}"

mkdir -p artifacts/ios
{
  npx expo prebuild --platform ios --clean
  xcodebuild \
    -workspace ios/GymFlow.xcworkspace \
    -scheme GymFlow \
    -configuration Release \
    -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath build/ios \
    ARCHS="$(uname -m)" \
    ONLY_ACTIVE_ARCH=YES \
    CODE_SIGNING_ALLOWED=NO \
    build
} 2>&1 | tee artifacts/ios/build.log

app=build/ios/Build/Products/Release-iphonesimulator/GymFlow.app
test -d "$app"
ditto -c -k --sequesterRsrc --keepParent "$app" artifacts/ios/GymFlow-ios-simulator.zip
{
  echo "git_sha=${GITHUB_SHA:-local}"
  echo "api_url=$EXPO_PUBLIC_API_URL"
  echo "simulator_arch=$(uname -m)"
  echo "node=$(node --version)"
  xcodebuild -version | tr '\n' ' '
  echo
} > artifacts/ios/build-info.txt
