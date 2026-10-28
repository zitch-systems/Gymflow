# GymFlow remaining release access

The code and internal native artifacts can be checked without account credentials. Store distribution and signed-in acceptance need the following existing accounts and test data.

## Store distribution

The current CI credential probe reports no Expo token, Android production keystore or Apple signing set. `mobile/app.json` also has no EAS project ID. The production profile already targets the public API and an Android app bundle.

1. Link this repository to the intended Expo project with `eas init` and retain its `extra.eas.projectId` in app configuration. Use the organisation's Expo account.
2. Configure the existing store signing identities with `eas credentials:configure-build --platform android --profile production` and the corresponding iOS command. EAS can manage signing credentials; the current native GitHub workflow only produces internal Android and unsigned iOS artifacts.
3. Configure `EXPO_TOKEN` through the CI secret manager, without adding its value to source, chat or logs. Complete one interactive production build per platform before enabling unattended EAS builds.
4. Configure the Play service account and App Store Connect submission credentials in the relevant provider. A first Play submission requires the web console. Submit and review the exact production-signed build separately from the internal APK.

Official setup: [Expo CI builds](https://docs.expo.dev/build/building-on-ci/), [EAS project and token setup](https://docs.expo.dev/accounts/programmatic-access/), [app signing](https://docs.expo.dev/build/setup/), [Android submission](https://docs.expo.dev/submit/android/).

## Signed-in acceptance

Use designated test memberships and staff accounts for each relevant role. A login to one role does not certify another. Browser sign-in must use the secure credential form. Payment, membership and messaging tests require a designated test tenant and recipient; real customers must not be used as fixtures.

| Surface | Acceptance that remains |
|---|---|
| Member web | Sign-in and refresh, profile persistence, membership freeze/cancel consent, classes/waitlist, wallet/receipts, renewal callback, documents |
| Owner and staff web | Role-scoped navigation, tenant boundaries, member administration, finance views, reporting and settings |
| Coach and superadmin web | Role-scoped navigation and permitted operations with designated accounts |
| Android and iPhone | Signed-in screen navigation, camera grant/denial and QR scanning, background/resume and offline behavior, banking handoff/deep link, accessibility and physical layout |
| Device upgrade | Preserve a designated member session and data across an upgrade signed by the intended release identity |

The automated component checks mock native/API boundaries. The CI emulator/simulator launch checks and unsigned device archive do not replace these acceptance tests. Meta account remediation and leaked-password protection remain excluded by request.
