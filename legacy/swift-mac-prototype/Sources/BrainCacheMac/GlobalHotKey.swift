import Carbon.HIToolbox
import Foundation

@MainActor
final class GlobalHotKey: @unchecked Sendable {
  private let action: @MainActor () -> Void
  private var eventHandler: EventHandlerRef?
  private var hotKey: EventHotKeyRef?

  init?(keyCode: UInt32, modifiers: UInt32, action: @escaping @MainActor () -> Void) {
    self.action = action

    var eventSpec = EventTypeSpec(
      eventClass: OSType(kEventClassKeyboard),
      eventKind: UInt32(kEventHotKeyPressed)
    )
    let handlerStatus = InstallApplicationEventHandler(
      { _, _, userData -> OSStatus in
        guard let userData else { return OSStatus(eventNotHandledErr) }
        let owner = Unmanaged<GlobalHotKey>
          .fromOpaque(userData)
          .takeUnretainedValue()
        Task { @MainActor in
          owner.fire()
        }
        return noErr
      },
      1,
      &eventSpec,
      Unmanaged.passUnretained(self).toOpaque(),
      &eventHandler
    )
    guard handlerStatus == noErr else { return nil }

    var hotKeyID = EventHotKeyID(signature: 0x4641_4D4C, id: 1)
    let registrationStatus = RegisterEventHotKey(
      keyCode,
      modifiers,
      hotKeyID,
      GetApplicationEventTarget(),
      0,
      &hotKey
    )
    guard registrationStatus == noErr else {
      if let eventHandler {
        RemoveEventHandler(eventHandler)
      }
      return nil
    }
  }

  deinit {
    if let hotKey {
      UnregisterEventHotKey(hotKey)
    }
    if let eventHandler {
      RemoveEventHandler(eventHandler)
    }
  }

  private func fire() {
    action()
  }
}
