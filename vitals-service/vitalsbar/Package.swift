// swift-tools-version:6.2
import PackageDescription

let package = Package(
    name: "VitalsBar",
    platforms: [.macOS(.v26)],
    targets: [
        .executableTarget(
            name: "VitalsBar",
            path: "Sources/VitalsBar"
        )
    ],
    swiftLanguageModes: [.v6]
)
