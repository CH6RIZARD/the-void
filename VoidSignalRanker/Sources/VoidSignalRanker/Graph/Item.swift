import Foundation

/// A rankable content item. Features are deliberately coarse and non-PII:
/// topic / region / format tags plus a dense embedding vector.
public struct Item: Identifiable, Equatable, Sendable, Codable {

    public let id: String
    public let authorID: String
    public let region: String
    public let topic: String
    public let format: Format

    /// Dense content embedding (e.g. from an on-device text/vision encoder).
    public let embedding: [Double]

    /// When the item was created — used for time decay in the ranker.
    public let createdAt: Date
    /// Adapter-derived contestedness, normalized to 0...1.  This is source
    /// evidence, never generated content or a moderation decision.
    public let controversy: Double

    public enum Format: String, Sendable, Codable, CaseIterable {
        case liveCam
        case rawFootage
        case news
        case shortVideo
        case photo
        case text
    }

    public init(id: String,
                authorID: String,
                region: String,
                topic: String,
                format: Format,
                embedding: [Double],
                createdAt: Date = Date(),
                controversy: Double = 0) {
        self.id = id
        self.authorID = authorID
        self.region = region
        self.topic = topic
        self.format = format
        self.embedding = embedding
        self.createdAt = createdAt
        self.controversy = min(1, max(0, controversy))
    }
}

/// The user's current interest representation and behavioral history, kept as
/// derived aggregates only (safe to persist).
public struct UserProfile: Codable, Equatable, Sendable {

    /// Dense interest vector (same dimensionality as item embeddings).
    public var interestVector: [Double]

    /// Historical engagement rate keyed by a discrete bucket
    /// ("topic:sports", "region:JP", "format:liveCam").
    public var behavioralAffinity: [String: Double]

    /// IDs of nodes (authors/regions) the user follows — the seeds for the
    /// social graph walk.
    public var followedNodes: Set<String>

    public init(interestVector: [Double] = [],
                behavioralAffinity: [String: Double] = [:],
                followedNodes: Set<String> = []) {
        self.interestVector = interestVector
        self.behavioralAffinity = behavioralAffinity
        self.followedNodes = followedNodes
    }
}
