import AppKit
import SwiftUI

enum BrainCacheColors {
  static let ink = Color(red: 7 / 255, green: 7 / 255, blue: 6 / 255)
  static let surface = Color(red: 17 / 255, green: 17 / 255, blue: 15 / 255)
  static let raised = Color(red: 24 / 255, green: 24 / 255, blue: 22 / 255)
  static let hover = Color(red: 32 / 255, green: 31 / 255, blue: 28 / 255)
  static let border = Color(red: 44 / 255, green: 43 / 255, blue: 39 / 255)
  static let strongBorder = Color(red: 71 / 255, green: 68 / 255, blue: 61 / 255)
  static let paper = Color(red: 243 / 255, green: 240 / 255, blue: 231 / 255)
  static let muted = Color(red: 145 / 255, green: 141 / 255, blue: 131 / 255)
  static let subtle = Color(red: 103 / 255, green: 100 / 255, blue: 93 / 255)
  static let signal = Color(red: 242 / 255, green: 184 / 255, blue: 75 / 255)
  static let saved = Color(red: 112 / 255, green: 201 / 255, blue: 151 / 255)
  static let error = Color(red: 229 / 255, green: 110 / 255, blue: 104 / 255)
}

enum BrainCacheTypography {
  static func font(size: CGFloat, weight: Font.Weight = .regular) -> Font {
    if NSFont(name: "Fragment Mono", size: size) != nil {
      return .custom("Fragment Mono", size: size).weight(weight)
    }
    return .system(size: size, weight: weight, design: .monospaced)
  }
}

extension View {
  func brainCacheFont(_ size: CGFloat, weight: Font.Weight = .regular) -> some View {
    font(BrainCacheTypography.font(size: size, weight: weight))
  }
}
