import Combine
import Foundation

enum CaptureSaveState: Equatable {
    case idle
    case saving
    case saved
    case emptyInput
    case persistenceError
}

enum CaptureRecoveryState: Equatable {
    case loading
    case loaded(Thought?)
    case loadError
}

@MainActor
final class CaptureViewModel: ObservableObject {
    @Published private(set) var draft = ""
    @Published private(set) var saveState: CaptureSaveState = .idle
    @Published private(set) var recoveryState: CaptureRecoveryState = .loading
    @Published private(set) var focusRequest = 0

    private let operation: CaptureOperation
    private var retryAttempt: CaptureAttempt?
    private var hasLoadedRecovery = false

    init(operation: CaptureOperation) {
        self.operation = operation
    }

    var isSaving: Bool {
        saveState == .saving
    }

    var isRetryingSave: Bool {
        saveState == .persistenceError
            && retryAttempt?.thought.body == CaptureOperation.normalize(draft)
    }

    var primaryActionLabel: String {
        if isSaving { return "WRITING LOCALLY…" }
        if isRetryingSave { return "TRY AGAIN" }
        return "CACHE IT"
    }

    var primaryActionDisabled: Bool {
        isSaving
    }

    @discardableResult
    func handleOpenURL(_ url: URL) -> Bool {
        guard CaptureDeepLink.matches(url) else { return false }
        focusRequest += 1
        return true
    }

    func updateDraft(_ value: String) {
        draft = value

        if saveState != .saving {
            if let retryAttempt,
               retryAttempt.thought.body != CaptureOperation.normalize(value) {
                self.retryAttempt = nil
            }
            if saveState != .idle {
                saveState = .idle
            }
        }
    }

    func save() async {
        guard !isSaving else { return }

        let submittedDraft = draft
        let attempt: CaptureAttempt
        do {
            if let retryAttempt,
               retryAttempt.thought.body == CaptureOperation.normalize(submittedDraft) {
                attempt = retryAttempt
            } else {
                attempt = try operation.prepare(submittedDraft, source: .iphone)
            }
        } catch is CaptureValidationError {
            retryAttempt = nil
            saveState = .emptyInput
            return
        } catch {
            retryAttempt = nil
            saveState = .persistenceError
            return
        }

        retryAttempt = attempt
        saveState = .saving

        do {
            let persisted = try await operation.save(attempt)
            retryAttempt = nil
            recoveryState = .loaded(persisted)
            hasLoadedRecovery = true
            saveState = .saved

            if draft == submittedDraft {
                draft = ""
                focusRequest += 1
            }
        } catch {
            // Keep both the visible draft and prepared attempt. A retry with the
            // same draft reuses its UUID and timestamp, so it cannot duplicate.
            retryAttempt = attempt
            saveState = .persistenceError
        }
    }

    func loadRecoveryIfNeeded() async {
        guard !hasLoadedRecovery else { return }
        await loadRecovery()
    }

    func loadRecovery() async {
        recoveryState = .loading
        do {
            recoveryState = .loaded(try await operation.latest())
            hasLoadedRecovery = true
        } catch {
            recoveryState = .loadError
            hasLoadedRecovery = false
        }
    }
}
