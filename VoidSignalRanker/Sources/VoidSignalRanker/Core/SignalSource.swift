import Foundation

/// A thin wrapper around `AsyncStream<SignalSample>` and its continuation, so
/// concrete sources can emit samples without each re-implementing the
/// continuation-capture dance.
///
/// Marked `@unchecked Sendable`: the underlying `AsyncStream.Continuation` is
/// itself thread-safe, and we only ever mutate through it.
public final class SignalStream: @unchecked Sendable {

    public let stream: AsyncStream<SignalSample>
    private let continuation: AsyncStream<SignalSample>.Continuation

    public init(bufferingPolicy: AsyncStream<SignalSample>.Continuation.BufferingPolicy = .bufferingNewest(256)) {
        var capturedContinuation: AsyncStream<SignalSample>.Continuation!
        self.stream = AsyncStream(bufferingPolicy: bufferingPolicy) { continuation in
            capturedContinuation = continuation
        }
        self.continuation = capturedContinuation
    }

    public func emit(_ sample: SignalSample) {
        continuation.yield(sample)
    }

    public func finish() {
        continuation.finish()
    }
}

/// Every on-device signal producer conforms to `SignalSource`.
///
/// Invariants enforced across all conformances:
/// - `isAvailable` reflects hardware/OS capability (e.g. no gyro, no paired
///   Watch, device without a TrueDepth camera). It is independent of the user's
///   choice.
/// - `isEnabled` reflects the user's *choice* + permission grant. Each source is
///   independently permissioned and disableable. A disabled source emits nothing.
/// - The ranker must produce sensible output for ANY subset of sources — even
///   the empty set (cold start / fixed weights).
public protocol SignalSource: AnyObject {

    /// Stable identity of this source.
    var id: SignalSourceID { get }

    /// Whether the underlying hardware/OS capability exists on this device.
    var isAvailable: Bool { get }

    /// Whether the user has enabled this source (and granted any permission it
    /// needs). Independently toggleable per source. Setting `false` should stop
    /// emission.
    var isEnabled: Bool { get set }

    /// Async stream of normalized samples. Consumers iterate with `for await`.
    var samples: AsyncStream<SignalSample> { get }

    /// Begin producing samples (no-op if unavailable or disabled).
    func start()

    /// Stop producing samples and release any hardware handles.
    func stop()
}

public extension SignalSource {
    /// A source can actually deliver data only when it is both physically
    /// available and enabled by the user.
    var isActive: Bool { isAvailable && isEnabled }
}
