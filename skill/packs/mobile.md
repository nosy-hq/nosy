# Mobile pack

## 1. Who it's for

Products distributed on iOS and/or Android, subject to store review, OS versions, and device fragmentation. Applies to both consumer apps (social, e-commerce, finance) and enterprise mobile apps (field teams, logistics); the common thread is that, unlike the web, a release has to pass store approval and a device/OS matrix, and a bug fix can't be deployed instantly.

## 2. Rival universe

Mobile isn't a product category on its own, it's a distribution form, so the rival universe follows the product's actual category (see `b2b-saas.md`, `fintech.md`, `legaltech.md`). This section instead lists mobile infrastructure/tooling rivals and store rules - a mobile product's "rival universe" belongs in the main pack, its "mobile challenges" belong here.

**Mobile infrastructure and tools (for understanding which infrastructure rivals use)**
- App Store Connect (developer.apple.com) - Apple distribution/review
- Google Play Console (play.google.com/console) - Android distribution/review
- Expo / EAS Update (expo.dev) - OTA updates + build
- Firebase Crashlytics (firebase.google.com) - crash tracking
- Branch (branch.io) - deep linking + attribution
- AppsFlyer (appsflyer.com) - deep linking (OneLink) + attribution
- Sentry (sentry.io) - error/performance monitoring
- TestFlight (Apple) - beta distribution
- Firebase App Distribution - Android beta distribution
- Fastlane (fastlane.tools) - release automation

## 3. Rows to add to the cycle matrix

| Row | Why it belongs in the matrix |
|---|---|
| Store review time and rejection history | Shows how fast the rival can actually ship |
| Crash-free session rate | A direct measure of quality perception, affects App Store/Play rating |
| Release train cadence | Weekly vs. biweekly - shows the speed culture |
| OTA/JS bundle updates (can code update without store approval) | Determines how fast bugs get fixed |
| Deep link / universal link support | The basis of campaign, notification, and sharing flows |
| Offline operation | Can be mandatory in field/enterprise use cases |
| Minimum supported OS version | Kept wide for an older audience, narrow for a newer one |
| Push notification personalization/segmentation | A frequently used retention channel |
| Biometric login (Face ID/Touch ID/Android biometric) | An expected standard in fintech and enterprise apps |
| Tablet/foldable/large-screen support | A differentiator most rivals skip |
| Forced in-app update | Manages the risk of users on an old version |
| Accessibility support (VoiceOver/TalkBack) | Increasingly asked about in store review and enterprise sales |

## 4. Low-hanging-fruit signals

- Crash-free rate dropped in the latest release but it isn't mentioned in the release notes: findable at a glance in the Crashlytics/Sentry dashboard, a quick hotfix candidate.
- Deep links depend on Firebase Dynamic Links: FDL shut down on 25 August 2025, so if it's still in use every link is returning a 404 - searchable in the repo with `firebase_dynamic_links` / `page.link`, urgent.
- The in-app "force update" message is generic and doesn't take the user to the store: a one-line button-target fix.
- Store rating is low and reviews haven't been answered for the last 3 months: replying is free, a fast trust signal.
- New screens that could ship as small JS changes via OTA are instead waiting on store approval: the OTA scope can be widened.

## 5. Mandatory PRD sections

- **Store policy check:** does the feature conflict with the Apple App Store Review Guidelines / Google Play Policy (payments, user content, permission requests); the relevant clause.
- **Offline behavior:** what the feature does with no network, how data syncs back.
- **Minimum OS and device scope:** which iOS/Android version it works from, and why.
- **OTA scope:** does this change ship via OTA, or does it require a native change that needs store approval.
- **Permission rationale:** if a permission like camera/location/notifications is requested, in which flow, with what copy.
- **Rollback plan:** the path back to the previous version on store rejection or a critical bug.

## 6. Never list

- Planning "it'll be live tomorrow" without accounting for store review time - Apple averages 24-48 hours, Google can take 3-7 days for a new developer account.
- Routing a payment flow around the in-app purchase (IAP) rule (an Apple/Google policy violation, rejection risk).
- Trying to ship a critical native change through OTA - against store policy and at risk of rejection.
- Collecting location/camera/microphone data without asking the user for permission.
- Supporting an old, vulnerable version indefinitely without a forced update.
- Leaving deep-link infrastructure tied to a discontinued service (e.g. Firebase Dynamic Links).

### Patterns (preread `--mobile`)

Searched in the PR title, body, and file paths (case-insensitive). A match is a warning, not a verdict: it tells the owner "look at this." Format: `- name :: regex`.

- Payment routed outside IAP :: external.{0,30}(payment|checkout)|bypass.{0,20}\bIAP\b
- Native change shipped via OTA :: \b(OTA|codepush|expo-updates)\b.{0,60}(native|podfile|gradle|AndroidManifest|Info\.plist)
- Location/camera/microphone without permission :: (location|camera|microphone).{0,40}without (permission|consent)
- Discontinued deep-link service :: firebase.{0,20}dynamic.{0,5}links|page\.link

## 7. Metrics

- Crash-free session/user rate - target 99.5%+ for consumer, 99.9%+ for finance/health
- Store rating and review volume (iOS/Android tracked separately)
- D1/D7/D30 retention
- Release train duration and store rejection rate
- OTA update adoption speed (how many users got the new bundle, and how fast)
- Cold start time
- Push notification open rate

## 8. Sources

- https://www.lowcode.agency/blog/app-store-review-time (App Store review time, accessed 2026-09-28)
- https://tms-outsource.com/blog/posts/how-long-does-google-play-app-review-take/ (Google Play review time, accessed 2026-09-28)
- https://www.luciq.ai/blog/benchmarking-crash-free-sessions-for-mobile-apps-whats-a-good-crash-free-rate (crash-free rate benchmarks, accessed 2026-09-28)
- https://www.businessofapps.com/data/app-performance-rates/ (mobile performance rates, accessed 2026-09-28)
- https://www.airbridge.io/en/blog/firebase-dynamic-links-alternatives (Firebase Dynamic Links shutdown and alternatives, accessed 2026-09-28)
- https://www.appsflyer.com/blog/mobile-marketing/fdl-deprecation-deep-linking/ (FDL shutdown date 25 August 2025, accessed 2026-09-28)
- https://developer.apple.com/app-store/review/guidelines/, https://play.google.com/console (store policies, accessed 2026-09-28)
