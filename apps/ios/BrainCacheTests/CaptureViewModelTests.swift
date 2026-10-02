import Foundation
import Testing

@testable import BrainCache

@MainActor
struct CaptureViewModelTests {
    private let fixedID = UUID(uuidString: "67FDC695-E0F5-4DB1-B45E-90F2E17F4490")!
    private let fixedDate = Date(timeIntervalSince1970: 1_788_232_860.456)

    @Test("A failed save retains the complete draft and retry reuses the attempt")
    func failureRetentionAndRetry() async throws {
        let store = FailableThoughtStore(saveFailuresRemaining: 1)
        let model = makeModel(store: store)
        let rawDraft = "  Keep my spacing until the retry.\n"
        model.updateDraft(rawDraft)

        await model.save()
        #expect(model.saveState == .persistenceError)
        #expect(model.draft == rawDraft)
        #expect(model.isRetryingSave)
        #expect(await store.persistedAttempts.count == 1)

        await model.save()
        #expect(model.saveState == .saved)
        #expect(model.draft.isEmpty)
        let saved = try await store.latest()
        #expect(model.recoveryState == .loaded(saved))

        let attempts = await store.persistedAttempts
        #expect(attempts.count == 2)
        #expect(attempts[0].id == attempts[1].id)
        #expect(attempts[0].createdAt == attempts[1].createdAt)
        #expect(attempts[1].id == fixedID)
        #expect(attempts[1].body == "Keep my spacing until the retry.")
    }

    @Test("Editing after a failure creates a new logical attempt")
    func editingAfterFailureCreatesNewAttempt() async throws {
        let ids = SequentialIDGenerator(
            values: [
                UUID(uuidString: "8D16EC93-4E73-44F1-A91C-A7FD776B4C33")!,
                UUID(uuidString: "C9B322A2-2E31-48E2-9CD5-8F15D13EA48B")!
            ]
        )
        let store = FailableThoughtStore(saveFailuresRemaining: 1)
        let operation = CaptureOperation(
            store: store,
            idGenerator: ids,
            clock: FixedViewClock(value: fixedDate)
        )
        let model = CaptureViewModel(operation: operation)

        model.updateDraft("First body")
        await model.save()
        model.updateDraft("Second body")
        await model.save()

        let attempts = await store.persistedAttempts
        #expect(attempts.count == 2)
        #expect(attempts[0].id != attempts[1].id)
        #expect(attempts[1].body == "Second body")
    }

    @Test("Recovery load failure is scoped and retryable")
    func recoveryLoadRetry() async {
        let recovered = Thought(
            id: fixedID,
            body: "Recovered offline",
            createdAt: ThoughtTimestamp.canonical(fixedDate),
            source: .iphone
        )
        let store = FailableThoughtStore(
            saveFailuresRemaining: 0,
            loadFailuresRemaining: 1,
            initialThought: recovered
        )
        let model = makeModel(store: store)

        await model.loadRecoveryIfNeeded()
        #expect(model.recoveryState == .loadError)

        await model.loadRecovery()
        #expect(model.recoveryState == .loaded(recovered))
    }

    @Test("Empty view-model save keeps the store untouched")
    func emptyViewModelSave() async {
        let store = FailableThoughtStore(saveFailuresRemaining: 0)
        let model = makeModel(store: store)
        model.updateDraft("\n  \t")

        await model.save()

        #expect(model.saveState == .emptyInput)
        #expect(model.draft == "\n  \t")
        #expect(await store.persistedAttempts.isEmpty)
    }

    @Test("A Lock Screen capture link requests focus without changing the draft")
    func lockScreenLinkPreservesDraft() {
        let model = makeModel(store: FailableThoughtStore(saveFailuresRemaining: 0))
        model.updateDraft("Keep this exact draft.\nWith the second line.")

        #expect(model.handleOpenURL(CaptureDeepLink.captureURL))
        #expect(model.focusRequest == 1)
        #expect(model.draft == "Keep this exact draft.\nWith the second line.")
        #expect(model.saveState == .idle)
        #expect(model.recoveryState == .loading)

        #expect(model.handleOpenURL(CaptureDeepLink.captureURL))
        #expect(model.focusRequest == 2)
        #expect(model.draft == "Keep this exact draft.\nWith the second line.")
    }

    @Test("A Lock Screen capture link preserves a failed save and its stable retry")
    func lockScreenLinkPreservesRetry() async throws {
        let store = FailableThoughtStore(saveFailuresRemaining: 1)
        let model = makeModel(store: store)
        model.updateDraft("Retry this exact thought")

        await model.save()
        #expect(model.saveState == .persistenceError)
        #expect(model.isRetryingSave)

        #expect(model.handleOpenURL(CaptureDeepLink.captureURL))
        #expect(model.focusRequest == 1)
        #expect(model.draft == "Retry this exact thought")
        #expect(model.saveState == .persistenceError)
        #expect(model.isRetryingSave)
        #expect(await store.persistedAttempts.count == 1)

        await model.save()
        let attempts = await store.persistedAttempts
        #expect(attempts.count == 2)
        #expect(attempts[0] == attempts[1])
    }

    @Test("Unexpected URLs do not change capture state or focus")
    func invalidLinkIsIgnored() throws {
        let model = makeModel(store: FailableThoughtStore(saveFailuresRemaining: 0))
        model.updateDraft("Unchanged")
        let invalidURL = try #require(URL(string: "braincache://capture?body=replace-me"))

        #expect(!model.handleOpenURL(invalidURL))
        #expect(model.focusRequest == 0)
        #expect(model.draft == "Unchanged")
        #expect(model.saveState == .idle)
        #expect(model.recoveryState == .loading)
    }

    private func makeModel(store: any ThoughtStore) -> CaptureViewModel {
        CaptureViewModel(
            operation: CaptureOperation(
                store: store,
                idGenerator: FixedViewIDGenerator(value: fixedID),
                clock: FixedViewClock(value: fixedDate)
            )
        )
    }
}

private actor FailableThoughtStore: ThoughtStore {
    private var saveFailuresRemaining: Int
    private var loadFailuresRemaining: Int
    private var savedThought: Thought?
    private(set) var persistedAttempts: [Thought] = []

    init(
        saveFailuresRemaining: Int,
        loadFailuresRemaining: Int = 0,
        initialThought: Thought? = nil
    ) {
        self.saveFailuresRemaining = saveFailuresRemaining
        self.loadFailuresRemaining = loadFailuresRemaining
        savedThought = initialThought
    }

    func persist(_ thought: Thought) throws -> Thought {
        persistedAttempts.append(thought)
        if saveFailuresRemaining > 0 {
            saveFailuresRemaining -= 1
            throw ThoughtStoreError.write
        }
        if let savedThought, savedThought.id == thought.id {
            return savedThought
        }
        savedThought = thought
        return thought
    }

    func latest() throws -> Thought? {
        if loadFailuresRemaining > 0 {
            loadFailuresRemaining -= 1
            throw ThoughtStoreError.read
        }
        return savedThought
    }
}

private struct FixedViewIDGenerator: CaptureIDGenerating {
    let value: UUID
    func next() -> UUID { value }
}

private final class SequentialIDGenerator: CaptureIDGenerating, @unchecked Sendable {
    private let lock = NSLock()
    private var values: [UUID]

    init(values: [UUID]) {
        self.values = values
    }

    func next() -> UUID {
        lock.withLock {
            values.removeFirst()
        }
    }
}

private struct FixedViewClock: CaptureClock {
    let value: Date
    func now() -> Date { value }
}
