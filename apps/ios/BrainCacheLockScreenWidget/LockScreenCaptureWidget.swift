import SwiftUI
import WidgetKit

private struct LockScreenCaptureEntry: TimelineEntry {
    let date: Date
}

private struct LockScreenCaptureProvider: TimelineProvider {
    func placeholder(in context: Context) -> LockScreenCaptureEntry {
        LockScreenCaptureEntry(date: .now)
    }

    func getSnapshot(
        in context: Context,
        completion: @escaping (LockScreenCaptureEntry) -> Void
    ) {
        completion(LockScreenCaptureEntry(date: .now))
    }

    func getTimeline(
        in context: Context,
        completion: @escaping (Timeline<LockScreenCaptureEntry>) -> Void
    ) {
        completion(Timeline(entries: [LockScreenCaptureEntry(date: .now)], policy: .never))
    }
}

private struct LockScreenCaptureEntryView: View {
    var entry: LockScreenCaptureEntry

    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            Image(systemName: "tray.and.arrow.down.fill")
                .font(.system(size: 18, weight: .semibold))
                .widgetAccentable()
        }
        .containerBackground(for: .widget) {
            Color.clear
        }
        .widgetURL(CaptureDeepLink.captureURL)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Open Brain Cache capture")
    }
}

@main
struct BrainCacheLockScreenWidget: Widget {
    let kind = "BrainCacheLockScreenCapture"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LockScreenCaptureProvider()) { entry in
            LockScreenCaptureEntryView(entry: entry)
        }
        .configurationDisplayName("Quick Capture")
        .description("Open Brain Cache to capture a thought.")
        .supportedFamilies([.accessoryCircular])
    }
}
