import AppKit
import BrainCacheCore
import SwiftData
import SwiftUI

private final class CapturePanel: NSPanel {
  override var canBecomeKey: Bool { true }
}

@MainActor
final class CapturePanelController: NSObject, NSWindowDelegate {
  private let container: ModelContainer
  private let panel: CapturePanel

  init(container: ModelContainer) {
    self.container = container
    panel = CapturePanel(
      contentRect: NSRect(x: 0, y: 0, width: 560, height: 112),
      styleMask: [.borderless],
      backing: .buffered,
      defer: false
    )
    super.init()

    panel.delegate = self
    panel.level = .floating
    panel.isReleasedWhenClosed = false
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
  }

  func show() {
    panel.contentView = NSHostingView(rootView: makeCaptureView())
    positionPanel()
    NSApp.activate(ignoringOtherApps: true)
    panel.makeKeyAndOrderFront(nil)
  }

  private func dismiss() {
    panel.orderOut(nil)
  }

  private func save(_ text: String) throws {
    try ThoughtCapture.save(
      text,
      source: .macPet,
      into: container.mainContext
    )
    dismiss()
  }

  private func makeCaptureView() -> some View {
    CapturePetView(
      onSave: { [weak self] text in
        guard let self else { return }
        try self.save(text)
      },
      onDismiss: { [weak self] in
        self?.dismiss()
      }
    )
  }

  private func positionPanel() {
    guard let screen = NSScreen.main ?? NSScreen.screens.first else { return }
    let visible = screen.visibleFrame
    let origin = NSPoint(
      x: visible.midX - panel.frame.width / 2,
      y: visible.maxY - panel.frame.height - 96
    )
    panel.setFrameOrigin(origin)
  }
}
