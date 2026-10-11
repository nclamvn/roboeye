// swift-tools-version: 5.9
import PackageDescription

let package = Package(name: "AssistiveDepthProbe", platforms: [.macOS(.v13), .iOS(.v17)], products: [
    .library(name: "AssistiveCore", targets: ["AssistiveCore"]),
    .executable(name: "ProbeFixture", targets: ["ProbeFixture"])
], targets: [
    .target(name: "AssistiveCore", path: "Core"),
    .executableTarget(name: "ProbeFixture", dependencies: ["AssistiveCore"], path: "Fixture"),
    .testTarget(name: "AssistiveCoreTests", dependencies: ["AssistiveCore"], path: "Tests")
])
