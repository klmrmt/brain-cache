import BrainCacheCore
import Carbon.HIToolbox
import SwiftData

@MainActor
final class BrainCacheRuntime {
  static let shared = BrainCacheRuntime()

  let container: ModelContainer
  private lazy var capturePanel = CapturePanelController(container: container)
  private var hotKey: GlobalHotKey?

  private init() {
    do {
      let configuration = ModelConfiguration(
        isStoredInMemoryOnly: false,
        cloudKitDatabase: .none
      )
      container = try ModelContainer(
        for: Thought.self,
        configurations: configuration
      )
    } catch {
      fatalError("Unable to create Brain Cache's local store: \(error)")
    }
  }

  func start() {
    guard hotKey == nil else { return }
    hotKey = GlobalHotKey(
      keyCode: UInt32(kVK_Space),
      modifiers: UInt32(optionKey)
    ) { [weak self] in
      self?.showCapture()
    }
  }

  func showCapture() {
    capturePanel.show()
  }
}
