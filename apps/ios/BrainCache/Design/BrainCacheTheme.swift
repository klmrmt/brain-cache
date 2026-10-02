import SwiftUI

enum BrainCacheTheme {
    static let ink = Color(red: 7 / 255, green: 7 / 255, blue: 6 / 255)
    static let surface = Color(red: 17 / 255, green: 17 / 255, blue: 15 / 255)
    static let raised = Color(red: 24 / 255, green: 24 / 255, blue: 22 / 255)
    static let border = Color(red: 44 / 255, green: 43 / 255, blue: 39 / 255)
    static let strongBorder = Color(red: 71 / 255, green: 68 / 255, blue: 61 / 255)
    static let paper = Color(red: 243 / 255, green: 240 / 255, blue: 231 / 255)
    static let muted = Color(red: 145 / 255, green: 141 / 255, blue: 131 / 255)
    static let subtle = Color(red: 103 / 255, green: 100 / 255, blue: 93 / 255)
    static let signal = Color(red: 242 / 255, green: 184 / 255, blue: 75 / 255)
    static let saved = Color(red: 112 / 255, green: 201 / 255, blue: 151 / 255)
    static let error = Color(red: 229 / 255, green: 110 / 255, blue: 104 / 255)

}

private struct ScaledMonospacedLabel: ViewModifier {
    @ScaledMetric(relativeTo: .caption2) private var scaledSize: CGFloat = 10
    private let weight: Font.Weight

    init(size: CGFloat, weight: Font.Weight) {
        _scaledSize = ScaledMetric(wrappedValue: size, relativeTo: .caption2)
        self.weight = weight
    }

    func body(content: Content) -> some View {
        content.font(.system(size: scaledSize, weight: weight, design: .monospaced))
    }
}

extension View {
    func brainCacheLabel(size: CGFloat = 10, weight: Font.Weight = .semibold) -> some View {
        modifier(ScaledMonospacedLabel(size: size, weight: weight))
    }
}

struct QuietGrid: View {
    var body: some View {
        Canvas { context, size in
            var path = Path()
            let step: CGFloat = 32

            for x in stride(from: CGFloat.zero, through: size.width, by: step) {
                path.move(to: CGPoint(x: x, y: 0))
                path.addLine(to: CGPoint(x: x, y: size.height))
            }
            for y in stride(from: CGFloat.zero, through: size.height, by: step) {
                path.move(to: CGPoint(x: 0, y: y))
                path.addLine(to: CGPoint(x: size.width, y: y))
            }

            context.stroke(path, with: .color(BrainCacheTheme.paper.opacity(0.018)), lineWidth: 1)
        }
        .accessibilityHidden(true)
        .ignoresSafeArea()
    }
}

struct PassiveBlob: View {
    var body: some View {
        ZStack {
            UnevenRoundedRectangle(
                topLeadingRadius: 11,
                bottomLeadingRadius: 8,
                bottomTrailingRadius: 12,
                topTrailingRadius: 9
            )
            .fill(BrainCacheTheme.raised)
            .stroke(BrainCacheTheme.strongBorder, lineWidth: 1)

            HStack(spacing: 5) {
                Circle()
                    .fill(BrainCacheTheme.paper)
                    .frame(width: 3, height: 3)
                Circle()
                    .fill(BrainCacheTheme.paper)
                    .frame(width: 3, height: 3)
            }
            .offset(y: -1)
        }
        .frame(width: 30, height: 27)
        .rotationEffect(.degrees(-2))
        .accessibilityHidden(true)
    }
}
