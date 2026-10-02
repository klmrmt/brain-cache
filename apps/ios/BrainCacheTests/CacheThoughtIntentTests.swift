import Foundation
import Testing

@testable import BrainCache

struct CacheThoughtIntentTests {
    private let fixedID = UUID(uuidString: "379D0DE8-BB9A-4525-8D6A-7A681884C38B")!
    private let fixedDate = Date(timeIntervalSince1970: 1_788_232_860.456)

    @Test("The shortcut entry point persists the shared contract with shortcut source")
    func shortcutContractPersistence() async throws {
        let fixture = ShortcutStoreFixture()
        defer { fixture.remove() }

        let capture = ShortcutCaptureOperation(
            operation: CaptureOperation(
                store: FileThoughtStore(fileURL: fixture.fileURL),
                idGenerator: ShortcutFixedIDGenerator(value: fixedID),
                clock: ShortcutFixedClock(value: fixedDate)
            )
        )

        let persisted = try await CacheThoughtIntent.execute(
            "  Captured from a shortcut.\nWith context intact.  ",
            using: capture
        )

        #expect(persisted.id == fixedID)
        #expect(persisted.body == "Captured from a shortcut.\nWith context intact.")
        #expect(persisted.kind == .text)
        #expect(persisted.checklistItems.isEmpty)
        #expect(persisted.createdAt == ThoughtTimestamp.canonical(fixedDate))
        #expect(persisted.archived == false)
        #expect(persisted.source == .shortcut)
        #expect(persisted.tags.isEmpty)

        let reopened = FileThoughtStore(fileURL: fixture.fileURL)
        #expect(try await reopened.latest() == persisted)

        let data = try Data(contentsOf: fixture.fileURL)
        let archive = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let thoughts = try #require(archive["thoughts"] as? [[String: Any]])
        let record = try #require(thoughts.first)
        #expect(
            Set(record.keys)
                == Set([
                    "id",
                    "body",
                    "kind",
                    "checklistItems",
                    "createdAt",
                    "archived",
                    "source",
                    "tags"
                ])
        )
        #expect(record["source"] as? String == "shortcut")
    }

    @Test("A transient shortcut save failure retries one prepared attempt")
    func stableRetryIdentity() async throws {
        let store = AmbiguousShortcutStore()
        let capture = ShortcutCaptureOperation(
            operation: CaptureOperation(
                store: store,
                idGenerator: ShortcutFixedIDGenerator(value: fixedID),
                clock: ShortcutFixedClock(value: fixedDate)
            )
        )

        let persisted = try await CacheThoughtIntent.execute("Retry once", using: capture)
        let attempts = await store.attempts

        #expect(attempts.count == 2)
        #expect(attempts[0] == attempts[1])
        #expect(persisted == attempts[0])
        #expect(persisted.source == .shortcut)
        #expect(try await store.latest() == persisted)
    }

    @Test("Empty shortcut input returns a useful validation error without writing")
    func emptyInput() async {
        let store = FailingShortcutStore(error: ThoughtStoreError.write)
        let capture = ShortcutCaptureOperation(
            operation: CaptureOperation(
                store: store,
                idGenerator: ShortcutFixedIDGenerator(value: fixedID),
                clock: ShortcutFixedClock(value: fixedDate)
            )
        )

        await #expect(throws: CacheThoughtIntentError.emptyThought) {
            try await CacheThoughtIntent.execute(" \n\t ", using: capture)
        }
        #expect(await store.attempts.isEmpty)
    }

    @Test("A persistent shortcut save failure is actionable and keeps a stable attempt")
    func persistentFailure() async {
        let store = FailingShortcutStore(error: ThoughtStoreError.write)
        let capture = ShortcutCaptureOperation(
            operation: CaptureOperation(
                store: store,
                idGenerator: ShortcutFixedIDGenerator(value: fixedID),
                clock: ShortcutFixedClock(value: fixedDate)
            )
        )

        await #expect(throws: CacheThoughtIntentError.localSaveFailed) {
            try await CacheThoughtIntent.execute("Keep this input", using: capture)
        }
        let attempts = await store.attempts
        #expect(attempts.count == 2)
        #expect(attempts[0] == attempts[1])
    }

    @Test("Intent errors expose localized validation and persistence guidance")
    func localizedErrors() {
        #expect(
            String(localized: CacheThoughtIntentError.emptyThought.localizedStringResource)
                == "Add some text before saving to Brain Cache."
        )
        #expect(
            String(localized: CacheThoughtIntentError.localSaveFailed.localizedStringResource)
                == "Brain Cache couldn’t confirm a local save. Open Brain Cache to check your cache, then try again."
        )
    }

    @Test("Cancellation after the first store failure prevents a retry")
    func cancellationStopsRetry() async {
        let store = CancellingFailureShortcutStore()
        let capture = ShortcutCaptureOperation(
            operation: CaptureOperation(
                store: store,
                idGenerator: ShortcutFixedIDGenerator(value: fixedID),
                clock: ShortcutFixedClock(value: fixedDate)
            )
        )
        let task = Task {
            try await capture.capture("Do not retry after cancellation")
        }

        await #expect(throws: CancellationError.self) {
            try await task.value
        }
        #expect(await store.attempts.count == 1)
    }

    @Test("The intent entry point passes cancellation through unchanged")
    func cancellationPassthrough() async {
        let store = RetryThenCancellationShortcutStore()
        let capture = ShortcutCaptureOperation(
            operation: CaptureOperation(
                store: store,
                idGenerator: ShortcutFixedIDGenerator(value: fixedID),
                clock: ShortcutFixedClock(value: fixedDate)
            )
        )

        await #expect(throws: CancellationError.self) {
            try await CacheThoughtIntent.execute("Let the system cancel", using: capture)
        }
        let attempts = await store.attempts
        #expect(attempts.count == 2)
        #expect(attempts[0] == attempts[1])
    }

    @Test("Success confirmation counts user-perceived characters and constructs a dialog")
    func successConfirmation() {
        let thought = Thought(
            id: fixedID,
            body: "Hi 🧠",
            createdAt: ThoughtTimestamp.canonical(fixedDate),
            source: .shortcut
        )

        let message = CacheThoughtIntent.successMessage(for: thought)
        #expect(
            String(localized: message)
                == "Saved locally to Brain Cache. 4 characters cached."
        )
        _ = CacheThoughtIntent.successDialog(for: thought)
    }

    @Test("Shortcut metadata publishes one discoverable cache action")
    func shortcutMetadata() {
        #expect(BrainCacheShortcuts.appShortcuts.count == 1)
        _ = CacheThoughtIntent.parameterSummary
    }
}

private struct ShortcutStoreFixture {
    let directoryURL = FileManager.default.temporaryDirectory
        .appending(path: "BrainCacheShortcutTests-\(UUID().uuidString)", directoryHint: .isDirectory)

    var fileURL: URL {
        directoryURL.appending(path: "thoughts.json", directoryHint: .notDirectory)
    }

    func remove() {
        try? FileManager.default.removeItem(at: directoryURL)
    }
}

private actor AmbiguousShortcutStore: ThoughtStore {
    private(set) var attempts: [Thought] = []
    private var savedThought: Thought?

    func persist(_ thought: Thought) throws -> Thought {
        attempts.append(thought)

        if savedThought == nil {
            savedThought = thought
            throw ThoughtStoreError.verificationFailed
        }

        guard savedThought == thought else {
            throw ThoughtStoreError.conflictingIdentifier
        }
        return thought
    }

    func latest() -> Thought? {
        savedThought
    }
}

private actor FailingShortcutStore: ThoughtStore {
    private let error: ThoughtStoreError
    private(set) var attempts: [Thought] = []

    init(error: ThoughtStoreError) {
        self.error = error
    }

    func persist(_ thought: Thought) throws -> Thought {
        attempts.append(thought)
        throw error
    }

    func latest() -> Thought? {
        nil
    }
}

private actor CancellingFailureShortcutStore: ThoughtStore {
    private(set) var attempts: [Thought] = []

    func persist(_ thought: Thought) throws -> Thought {
        attempts.append(thought)
        withUnsafeCurrentTask { task in
            task?.cancel()
        }
        throw ThoughtStoreError.write
    }

    func latest() -> Thought? {
        nil
    }
}

private actor RetryThenCancellationShortcutStore: ThoughtStore {
    private(set) var attempts: [Thought] = []

    func persist(_ thought: Thought) throws -> Thought {
        attempts.append(thought)
        if attempts.count == 1 {
            throw ThoughtStoreError.write
        }
        throw CancellationError()
    }

    func latest() -> Thought? {
        nil
    }
}

private struct ShortcutFixedIDGenerator: CaptureIDGenerating {
    let value: UUID
    func next() -> UUID { value }
}

private struct ShortcutFixedClock: CaptureClock {
    let value: Date
    func now() -> Date { value }
}
