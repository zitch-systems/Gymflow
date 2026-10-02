#!/usr/bin/env bash
set -euo pipefail

export EXPO_NO_GIT_STATUS=1
export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-https://www.gymflow.ng}"

npx expo prebuild --platform ios --clean
xcodebuild \
  -workspace ios/GymFlow.xcworkspace \
  -scheme GymFlow \
  -configuration Release \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build/ios \
  CODE_SIGNING_ALLOWED=NO \
  build

app=build/ios/Build/Products/Release-iphonesimulator/GymFlow.app
test -d "$app"
mkdir -p artifacts/ios
ditto -c -k --sequesterRsrc --keepParent "$app" artifacts/ios/GymFlow-ios-simulator.zip
