// swift-tools-version: 6.0

import PackageDescription

let package = Package(
  name: "BrainCache",
  platforms: [
    .macOS(.v14)
  ],
  products: [
    .library(name: "BrainCacheCore", targets: ["BrainCacheCore"]),
    .executable(name: "BrainCacheMac", targets: ["BrainCacheMac"]),
  ],
  targets: [
    .target(name: "BrainCacheCore"),
    .executableTarget(
      name: "BrainCacheMac",
      dependencies: ["BrainCacheCore"]
    ),
    .testTarget(
      name: "BrainCacheCoreTests",
      dependencies: ["BrainCacheCore"]
    ),
  ]
)
