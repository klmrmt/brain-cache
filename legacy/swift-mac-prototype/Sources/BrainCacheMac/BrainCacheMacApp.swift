import AppKit
import SwiftData
import SwiftUI

@main
struct BrainCacheMacApp: App {
  @NSApplicationDelegateAdaptor(BrainCacheAppDelegate.self) private var appDelegate

  var body: some Scene {
    WindowGroup("Brain Cache") {
      BrainCacheLibraryView()
        .modelContainer(BrainCacheRuntime.shared.container)
    }
    .windowStyle(.hiddenTitleBar)
    .defaultSize(width: 1120, height: 720)
    .commands {
      CommandMenu("Capture") {
        Button("Capture Thought") {
          BrainCacheRuntime.shared.showCapture()
        }
      }
    }

    MenuBarExtra("Brain Cache", systemImage: "text.bubble") {
      Button("Capture Thought") {
        BrainCacheRuntime.shared.showCapture()
      }
      Divider()
      Text("Global shortcut: ⌥ Space")
    }
    .menuBarExtraStyle(.menu)
  }
}

@MainActor
final class BrainCacheAppDelegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) {
    BrainCacheRuntime.shared.start()
  }
}
