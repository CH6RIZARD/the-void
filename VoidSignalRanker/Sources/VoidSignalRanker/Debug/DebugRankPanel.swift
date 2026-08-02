#if canImport(SwiftUI)
import SwiftUI

/// Observable adapter that drives `DebugRankPanel`. Holds a `SignalRankingEngine`
/// and a candidate set, and republishes snapshots on demand.
///
/// Debug-only: this is the ONLY UI surface for the subsystem. It shows derived
/// values only (component scores, weights, affective scalars) — never raw sensor
/// data, consistent with the privacy model.
@MainActor
public final class DebugRankViewModel: ObservableObject {

    @Published public private(set) var snapshot: SignalRankingEngine.Snapshot?
    private let engine: SignalRankingEngine
    private var candidates: [Item]

    public init(engine: SignalRankingEngine, candidates: [Item]) {
        self.engine = engine
        self.candidates = candidates
    }

    public func setCandidates(_ items: [Item]) {
        candidates = items
        refresh()
    }

    public func refresh() {
        snapshot = engine.snapshot(candidates: candidates)
    }

    /// Convenience for previews/demos: build an engine from the synthetic
    /// generator and a scenario, ingest a batch, and return a ready view model.
    public static func synthetic(scenario: SyntheticSignalGenerator.Scenario = .calmFocused,
                                 seed: UInt64 = 7) -> DebugRankViewModel {
        let gen = SyntheticSignalGenerator(scenario: scenario, seed: seed)
        let engine = SignalRankingEngine.makeDefault(sources: [])
        engine.ingestSynthetic(gen.generate(count: 90))
        let vm = DebugRankViewModel(engine: engine, candidates: gen.makeItems())
        vm.refresh()
        return vm
    }
}

/// SwiftUI panel showing, per item: the four component scores (social, interest,
/// behavioral, physio), the current weight vector, and the live affective
/// scalars (arousal / attention / agitation / engagement depth).
@MainActor
public struct DebugRankPanel: View {

    @ObservedObject private var viewModel: DebugRankViewModel

    public init(viewModel: DebugRankViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                affectiveSection
                weightsSection
                itemsSection
            }
            .padding()
        }
        .onAppear { viewModel.refresh() }
    }

    // MARK: - Sections

    @ViewBuilder
    private var affectiveSection: some View {
        if let a = viewModel.snapshot?.affect {
            VStack(alignment: .leading, spacing: 8) {
                header("Live affective state")
                bar("Arousal", a.arousal)
                bar("Attention", a.attention)
                bar("Agitation", a.agitation)
                bar("Engagement depth", a.engagementDepth)
                if let ids = viewModel.snapshot?.activeSourceIDs {
                    Text("Active sources: " + (ids.isEmpty ? "none (cold start)" : ids.map(\.rawValue).joined(separator: ", ")))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private var weightsSection: some View {
        if let w = viewModel.snapshot?.weights {
            VStack(alignment: .leading, spacing: 8) {
                header("Fusion weights" + ((viewModel.snapshot?.banditWarm ?? false) ? " (bandit)" : " (cold start)"))
                bar("w_social", w.social)
                bar("w_interest", w.interest)
                bar("w_behavioral", w.behavioral)
                bar("w_physio", w.physio)
            }
        }
    }

    @ViewBuilder
    private var itemsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            header("Ranked items")
            ForEach(viewModel.snapshot?.ranked ?? []) { ranked in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(ranked.item.id).font(.subheadline.bold())
                        Spacer()
                        Text(String(format: "%.3f", ranked.finalScore))
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(.tint)
                    }
                    Text("\(ranked.item.topic) · \(ranked.item.region) · \(ranked.item.format.rawValue)")
                        .font(.caption).foregroundStyle(.secondary)
                    bar("social", ranked.components.social)
                    bar("interest", ranked.components.interest)
                    bar("behavioral", ranked.components.behavioral)
                    bar("physio", ranked.physioAffinity)
                    Text(String(format: "decay ×%.2f", ranked.decay))
                        .font(.caption2).foregroundStyle(.secondary)
                }
                .padding(10)
                .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    // MARK: - Building blocks

    private func header(_ title: String) -> some View {
        Text(title).font(.headline)
    }

    private func bar(_ label: String, _ value: Double) -> some View {
        HStack(spacing: 8) {
            Text(label).font(.caption).frame(width: 120, alignment: .leading)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 4).fill(.quaternary)
                    RoundedRectangle(cornerRadius: 4)
                        .fill(.tint)
                        .frame(width: max(0, min(1, value)) * geo.size.width)
                }
            }
            .frame(height: 10)
            Text(String(format: "%.2f", value))
                .font(.caption.monospacedDigit())
                .frame(width: 40, alignment: .trailing)
        }
    }
}

#if DEBUG
struct DebugRankPanel_Previews: PreviewProvider {
    static var previews: some View {
        DebugRankPanel(viewModel: .synthetic(scenario: .excitedRestless))
    }
}
#endif
#endif
