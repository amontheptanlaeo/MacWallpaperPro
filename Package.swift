// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "MacWallpaperPro",
    platforms: [.macOS(.v15)],
    targets: [
        .executableTarget(name: "MacWallpaperPro", path: "Sources/MacWallpaperPro")
    ],
    swiftLanguageModes: [.v5]
)
