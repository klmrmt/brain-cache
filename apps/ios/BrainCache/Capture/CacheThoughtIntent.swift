import AppIntents
import Foundation

enum CacheThoughtIntentError: Error, Equatable, CustomLocalizedStringResourceConvertible, Sendable {
    case emptyThought
    case localSaveFailed

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .emptyThought:
            "Add some text before saving to Brain Cache."
        case .localSaveFailed:
            "Brain Cache couldn’t confirm a local save. Open Brain Cache to check your cache, then try again."
        }
    }
}

struct ShortcutCaptureOperation: Sendable {
    private let operation: CaptureOperation

    init(operation: CaptureOperation) {
        self.operation = operation
    }

    func capture(_ rawBody: String) async throws -> Thought {
        let attempt = try operation.prepare(rawBody, source: .shortcut)

        do {
            return try await operation.save(attempt)
        } catch {
            try Task.checkCancellation()
            // A transient or ambiguous local-store failure gets one retry with
            // the same UUID and timestamp, preserving the capture contract.
            return try await operation.save(attempt)
        }
    }
}

struct CacheThoughtIntent: AppIntent {
    static let title: LocalizedStringResource = "Cache a Thought"
    static let description = IntentDescription(
        "Save text privately to Brain Cache on this device, even when offline."
    )

    @Parameter(
        title: "Thought",
        description: "The text to save locally in Brain Cache.",
        requestValueDialog: "What should I cache?"
    )
    var thought: String

    static var parameterSummary: some ParameterSummary {
        Summary("Cache \(\.$thought)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let shortcutCapture = ShortcutCaptureOperation(
            operation: CaptureOperation(
                store: FileThoughtStore.applicationStore()
            )
        )
        let persisted = try await Self.execute(thought, using: shortcutCapture)

        return .result(dialog: Self.successDialog(for: persisted))
    }

    static func successMessage(for persisted: Thought) -> LocalizedStringResource {
        "Saved locally to Brain Cache. \(persisted.body.count) characters cached."
    }

    static func successDialog(for persisted: Thought) -> IntentDialog {
        IntentDialog(successMessage(for: persisted))
    }

    static func execute(
        _ rawThought: String,
        using shortcutCapture: ShortcutCaptureOperation
    ) async throws -> Thought {
        do {
            return try await shortcutCapture.capture(rawThought)
        } catch is CaptureValidationError {
            throw CacheThoughtIntentError.emptyThought
        } catch let error as CancellationError {
            throw error
        } catch {
            throw CacheThoughtIntentError.localSaveFailed
        }
    }
}

struct BrainCacheShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CacheThoughtIntent(),
            phrases: [
                "Cache a thought in \(.applicationName)",
                "Save a thought to \(.applicationName)"
            ],
            shortTitle: "Cache Thought",
            systemImageName: "tray.and.arrow.down.fill"
        )
    }
}
