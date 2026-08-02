import Foundation

/// A tiny Bayesian logistic-regression contextual bandit trained with online
/// Thompson sampling. It learns how much to trust each ranking component (the
/// fusion "arms" are the component weights) from observed engagement outcomes.
///
/// Model: `p(engage) = sigmoid(wᵀ x)` where `x` is the per-item context vector
/// (the component scores + affective context). We keep a diagonal-Gaussian
/// posterior over `w` (mean `m`, precision `q`) — the standard
/// Chapelle & Li (2011) online logistic-regression Thompson sampler.
///
/// Persistable: stores only the posterior parameters (weights), never raw data.
public final class ContextualBandit: Codable {

    /// Posterior mean of each weight.
    public private(set) var mean: [Double]
    /// Posterior precision (inverse variance) of each weight.
    public private(set) var precision: [Double]

    private let priorPrecision: Double
    private let dimension: Int

    enum CodingKeys: String, CodingKey { case mean, precision, priorPrecision, dimension }

    public init(dimension: Int, priorMean: [Double]? = nil, priorPrecision: Double = 1.0) {
        self.dimension = dimension
        self.priorPrecision = priorPrecision
        self.mean = priorMean ?? Array(repeating: 0.0, count: dimension)
        self.precision = Array(repeating: priorPrecision, count: dimension)
    }

    public required init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mean = try c.decode([Double].self, forKey: .mean)
        precision = try c.decode([Double].self, forKey: .precision)
        priorPrecision = try c.decode(Double.self, forKey: .priorPrecision)
        dimension = try c.decode(Int.self, forKey: .dimension)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(mean, forKey: .mean)
        try c.encode(precision, forKey: .precision)
        try c.encode(priorPrecision, forKey: .priorPrecision)
        try c.encode(dimension, forKey: .dimension)
    }

    /// Draw a weight vector from the current posterior (Thompson sampling).
    public func sampleWeights(rng: inout SplitMix64) -> [Double] {
        var w = [Double](repeating: 0, count: dimension)
        for i in 0..<dimension {
            let sd = sqrt(1.0 / max(precision[i], 1e-6))
            w[i] = mean[i] + sd * rng.nextGaussian()
        }
        return w
    }

    /// Posterior-mean weights (exploitation only) — used for display + as a
    /// stable fallback.
    public var meanWeights: [Double] { mean }

    /// Online Bayesian update from one observation `(x, engaged)`.
    /// Uses a Laplace/Newton step per Chapelle & Li.
    public func update(context x: [Double], engaged: Bool, learningRate: Double = 1.0) {
        guard x.count == dimension else { return }
        let y = engaged ? 1.0 : 0.0
        let p = sigmoid(dot(mean, x))
        for i in 0..<dimension {
            // Gradient of log-likelihood for logistic regression.
            let grad = (p - y) * x[i]
            // Precision grows with informative (large-|x|, confident-p) samples.
            let hess = p * (1 - p) * x[i] * x[i]
            precision[i] += hess
            mean[i] -= learningRate * grad / precision[i]
        }
    }

    public func predict(context x: [Double]) -> Double {
        sigmoid(dot(mean, x))
    }

    private func dot(_ a: [Double], _ b: [Double]) -> Double {
        var s = 0.0
        for i in 0..<min(a.count, b.count) { s += a[i] * b[i] }
        return s
    }

    private func sigmoid(_ z: Double) -> Double { 1.0 / (1.0 + exp(-z)) }
}

/// Small, deterministic, seedable PRNG (SplitMix64) with a Box–Muller Gaussian.
/// Deterministic seeding makes bandit behavior reproducible in tests.
public struct SplitMix64: RandomNumberGenerator {
    private var state: UInt64
    public init(seed: UInt64 = 0x9E3779B97F4A7C15) { self.state = seed }

    public mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }

    public mutating func nextUnit() -> Double {
        // 53-bit mantissa in [0,1).
        Double(next() >> 11) * (1.0 / 9007199254740992.0)
    }

    public mutating func nextGaussian() -> Double {
        // Box–Muller.
        let u1 = max(nextUnit(), 1e-12)
        let u2 = nextUnit()
        return sqrt(-2.0 * log(u1)) * cos(2.0 * Double.pi * u2)
    }
}
