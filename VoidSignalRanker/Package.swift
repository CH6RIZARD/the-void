// swift-tools-version:5.9
import PackageDescription

// VoidSignalRanker
//
// A standalone, on-device signal + ranking subsystem.
//
// NOTE: This package was authored WITHOUT a Swift toolchain available on the
// authoring machine (Windows, no `swift build`). It is intended to be built in
// Xcode 15+ targeting an iOS 17+ simulator or device. All device-only frameworks
// (CoreMotion, HealthKit, ARKit) are imported behind `#if canImport(...)` /
// `#if os(iOS)` so that the package still *parses* on other platforms.

let package = Package(
    name: "VoidSignalRanker",
    platforms: [
        .iOS(.v17)
    ],
    products: [
        .library(
            name: "VoidSignalRanker",
            targets: ["VoidSignalRanker"]
        )
    ],
    targets: [
        .target(
            name: "VoidSignalRanker",
            path: "Sources/VoidSignalRanker"
        ),
        .testTarget(
            name: "VoidSignalRankerTests",
            dependencies: ["VoidSignalRanker"],
            path: "Tests/VoidSignalRankerTests"
        )
    ]
)
