# VoidSignalRanker

An on-device **signal + ranking subsystem** for iOS 17+. It turns raw device
sensors into a small set of normalized *affective* scalars, retrieves
social/interest/behavioral scores for candidate content, and fuses them into a
per-user ranking whose weights are learned online.

> **Authored without a compiler.** This package was written on a machine with no
> Swift toolchain, so it has **not** been through `swift build`. It targets
> Xcode 15+ / iOS 17. All device-only frameworks are imported behind
> `#if canImport(...)` / `#if os(iOS)` so the package still parses on other
> platforms; open it in Xcode to build and run the tests. Treat first-build
> fixes (imports, minor API drift) as expected.

---

## Architecture

```
                         ┌─────────────────────────────────────────┐
   Sensors / app         │            SignalSource(s)              │
 ┌───────────────┐       │  Motion  Health  Face  Interaction Ctx  │
 │ CoreMotion    │──────▶│  each: id · isAvailable · isEnabled ·   │
 │ HealthKit     │       │  start()/stop() · AsyncStream<Sample>   │
 │ ARKit (face)  │       └───────────────┬─────────────────────────┘
 │ UIKit ctx     │                       │  SignalSample
 │ app telemetry │                       │  (normalized payload + derived scalars)
 └───────────────┘                       ▼
                          ┌─────────────────────────────────────┐
                          │           FeatureExtractor           │
                          │  sliding windows 5s / 60s / session  │
                          │  z-score vs per-user 7-day EWMA      │
                          │  → arousal, attention, agitation,    │
                          │    engagement_depth  (each in [0,1]) │
                          └───────────────┬─────────────────────┘
                                          │ AffectiveState
                    ┌─────────────────────┴──────────────────────┐
                    ▼                                             ▼
        ┌───────────────────────┐                    ┌────────────────────────┐
        │      GraphStore        │                    │   PhysioAffinityModel   │
        │  social (≤2 hops)      │                    │  item features → pred.  │
        │  interest (cosine)     │                    │  affective response     │
        │  behavioral (history)  │                    │  = physio_affinity      │
        └───────────┬───────────┘                    └────────────┬───────────┘
                    │  GraphScores                                 │
                    └───────────────┬─────────────────────────────┘
                                    ▼
                     ┌──────────────────────────────────────────┐
                     │               FusionRanker                │
                     │ score = w_s·social + w_i·interest         │
                     │        + w_b·behavioral + w_p·physio       │
                     │ × time_decay                              │
                     │ weights: contextual bandit (Thompson      │
                     │ sampling / logistic) + cold-start fallback│
                     └──────────────────────────────────────────┘
```

### Files

```
VoidSignalRanker/
├── Package.swift
├── README.md
├── Sources/VoidSignalRanker/
│   ├── Core/
│   │   ├── SignalSample.swift        # sample value type + SignalSourceID
│   │   ├── SignalSource.swift        # protocol + SignalStream helper
│   │   └── EncryptedStore.swift      # persistence seam (in-memory + CryptoKit)
│   ├── Sources/
│   │   ├── MotionSource.swift        # CoreMotion
│   │   ├── HealthSource.swift        # HealthKit (Watch → degrade to steps)
│   │   ├── FaceSource.swift          # ARKit face tracking (opt-in, session-only)
│   │   ├── InteractionSource.swift   # app-driven, no OS permission
│   │   └── ContextSource.swift       # time / light / charging / motion ctx
│   ├── Features/
│   │   ├── EWMABaselineStore.swift   # per-user 7-day rolling baselines
│   │   └── FeatureExtractor.swift    # windows → 4 affective scalars
│   ├── Graph/
│   │   ├── Item.swift                # Item + UserProfile models
│   │   └── GraphStore.swift          # social / interest / behavioral scores
│   ├── Ranking/
│   │   ├── ContextualBandit.swift    # Thompson sampling logistic bandit + PRNG
│   │   ├── PhysioAffinityModel.swift # physio_affinity online regressor
│   │   └── FusionRanker.swift        # the fusion score + time decay
│   ├── Synthetic/
│   │   └── SyntheticSignalGenerator.swift  # fake streams + items, seeded
│   ├── Debug/
│   │   └── DebugRankPanel.swift      # SwiftUI panel + view model
│   └── SignalRankingEngine.swift     # façade wiring sources→extractor→ranker
└── Tests/VoidSignalRankerTests/
    ├── FeatureNormalizationTests.swift
    ├── ColdStartTests.swift
    └── SourceDegradationTests.swift
```

---

## Privacy model

The design encodes the privacy rules structurally, not just by convention:

1. **Raw sensor data never leaves memory.** Sources consume raw
   accelerometer/gyro buffers, raw HealthKit samples, and raw ARKit face
   geometry *inside* the source object and immediately reduce them to a handful
   of normalized/derived values inside a `SignalSample`. A `SignalSample` has no
   API to carry a raw buffer.

2. **Only derived scalars + model weights may persist, and only encrypted.**
   The `EncryptedStore` protocol is the single persistence seam. Everything it
   accepts is `Codable` aggregate statistics: EWMA baselines, the bandit
   posterior, the physio regressor, and the derived `UserProfile`. There is no
   code path that hands raw HR or face geometry to a store.
   `CryptoKitEncryptedStore` AES-GCM-encrypts every value with
   `.completeFileProtection`.

3. **Face data is session-scoped.** `FaceSource` is opt-in, emits **no** derived
   scalars (its samples carry an empty `scalars` bag, so the baseline store never
   sees them), and wipes all in-memory face state on `stop()`. Nothing
   face-derived is ever persisted.

4. **Every source is independently permissioned and disableable.** `isAvailable`
   reflects hardware/OS capability; `isEnabled` reflects the user's choice +
   permission grant. A disabled source emits nothing. The ranker produces
   sensible output for **any** subset of sources, including none (cold start).

5. **No HealthKit data for ads/targeting.** `HealthSource` requests **read-only**
   access, uses the data solely for on-device affective features, and never
   exports it. See the App Store Guideline **5.1.3** references in
   `HealthSource.swift` and `EncryptedStore.swift`.

---

## Running the tests with the synthetic generator

No hardware or users are required. `SyntheticSignalGenerator` produces seeded,
realistic sample streams and candidate items so the whole pipeline is testable
deterministically.

```bash
# In Xcode: select an iOS 17 simulator scheme, then Product ▸ Test (⌘U).
# Or from the command line on macOS:
xcodebuild test \
  -scheme VoidSignalRanker \
  -destination 'platform=iOS Simulator,name=iPhone 15'
# (Pure `swift test` also works for the non-UIKit/logic paths if your toolchain
#  resolves the iOS 17 platform.)
```

The three required test suites:

- **`FeatureNormalizationTests`** — payload clamping, HealthKit range
  normalization, EWMA baseline direction/neutrality, and bounded affective
  scalars.
- **`ColdStartTests`** — fixed cold-start weights when the bandit is unwarmed,
  valid convex weight vectors, sensible ranking with no signals, and bandit
  warm-up.
- **`SourceDegradationTests`** — availability vs. enablement, Watch-absent
  degradation to steps/energy, **all 2⁵ source subsets** producing bounded
  finite output, and the face-never-baselined guarantee.

Quick manual demo in code:

```swift
let gen = SyntheticSignalGenerator(scenario: .excitedRestless)
let engine = SignalRankingEngine.makeDefault(sources: [])
engine.ingestSynthetic(gen.generate(count: 90))
let snapshot = engine.snapshot(candidates: gen.makeItems())
print(snapshot.affect, snapshot.weights, snapshot.ranked.first?.finalScore ?? 0)
```

---

## Embedding the DebugRankPanel

The panel is the **only** UI surface and shows derived values only (component
scores, weight vector, live affective scalars).

```swift
import SwiftUI
import VoidSignalRanker

struct DebugScreen: View {
    // Build a view model from live sources…
    @StateObject private var vm: DebugRankViewModel

    init(engine: SignalRankingEngine, candidates: [Item]) {
        _vm = StateObject(wrappedValue: DebugRankViewModel(engine: engine,
                                                           candidates: candidates))
    }

    var body: some View {
        DebugRankPanel(viewModel: vm)
            .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { _ in
                vm.refresh()
            }
    }
}

// …or, with zero hardware, straight from the synthetic generator:
DebugRankPanel(viewModel: .synthetic(scenario: .calmFocused))
```

To wire real sources, construct them, enable the ones the user has permitted,
build an engine, and call `start()`:

```swift
let motion = MotionSource();       motion.isEnabled = true
let interaction = InteractionSource(); interaction.isEnabled = true
let engine = SignalRankingEngine.makeDefault(
    sources: [motion, interaction],           // any subset — including []
    store: CryptoKitEncryptedStore(key: keychainKey, directory: appSupportDir))
engine.start()
```

---

## Notes & assumptions

- **Not compiled.** Expect to resolve minor first-build issues in Xcode.
- Normalization *ceilings* in each source (e.g. HR 40–180 bpm) are static priors
  used only to map to [0,1]; the *interpretation* is per-user via EWMA z-scores,
  never absolute thresholds.
- The contextual bandit context is the 4 component scores; it learns their
  fusion weights and only overrides cold-start weights after
  `banditWarmupCount` (default 20) engagement observations. Set
  `ranker.deterministic = true` for reproducible (mean-weight) ranking.
- `physio_affinity` is trained from logged `(item → measured affective delta)`
  pairs via `FusionRanker.observe(_:engaged:measuredAffectiveDelta:)`.
- The synthetic generator and all tests use a seeded `SplitMix64` PRNG for
  determinism.
