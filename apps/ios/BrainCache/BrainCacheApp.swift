import SwiftUI

@main
struct BrainCacheApp: App {
    @StateObject private var model: CaptureViewModel

    init() {
        let store = FileThoughtStore.applicationStore()
        let operation = CaptureOperation(store: store)
        _model = StateObject(wrappedValue: CaptureViewModel(operation: operation))
    }

    var body: some Scene {
        WindowGroup {
            CaptureView(model: model)
                .onOpenURL { url in
                    model.handleOpenURL(url)
                }
        }
    }
}
