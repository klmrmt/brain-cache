import Foundation
import Testing

@testable import BrainCache

struct ShareCaptureTests {
    @Test("Provider representations prefer URLs, accept text, and reject everything else")
    func providerRepresentationClassification() {
        #expect(
            ShareItemRepresentationClassifier.classify(canLoadURL: true, canLoadText: true)
                == .url
        )
        #expect(
            ShareItemRepresentationClassifier.classify(canLoadURL: false, canLoadText: true)
                == .text
        )
        #expect(
            ShareItemRepresentationClassifier.classify(canLoadURL: false, canLoadText: false)
                == .unsupported
        )
    }

    @Test("Every rejected Share payload explains how to recover")
    func localizedErrors() {
        #expect(ShareCaptureError.empty.errorDescription == "Share some text or a link for Blob to remember.")
        #expect(ShareCaptureError.multipleItems.errorDescription == "Brain Cache can save one shared item at a time.")
        #expect(ShareCaptureError.unsupported.errorDescription == "Brain Cache can save shared text and links.")
        #expect(ShareCaptureError.relativeURL.errorDescription == "Brain Cache needs a complete link, including its address scheme.")
    }

    @Test("Shared text is normalized into an editable body")
    func textPayload() throws {
        #expect(
            try ShareItemParser.editableBody(from: [.text("  first\r\nsecond  ")])
                == "first\nsecond"
        )
    }

    @Test("A complete URL is preserved verbatim")
    func urlPayload() throws {
        let raw = "https://example.com/a%20path?q=Brain%20Cache#saved"
        let url = try #require(URL(string: raw))
        #expect(try ShareItemParser.editableBody(from: [.url(url)]) == raw)
    }

    @Test("Empty, multiple, and relative payloads are rejected")
    func invalidPayloads() throws {
        #expect(throws: ShareCaptureError.empty) {
            try ShareItemParser.editableBody(from: [])
        }
        #expect(throws: ShareCaptureError.empty) {
            try ShareItemParser.editableBody(from: [.text(" \n ")])
        }
        #expect(throws: ShareCaptureError.multipleItems) {
            try ShareItemParser.editableBody(from: [.text("one"), .text("two")])
        }
        let relative = try #require(URL(string: "relative/path"))
        #expect(throws: ShareCaptureError.relativeURL) {
            try ShareItemParser.editableBody(from: [.url(relative)])
        }
        #expect(throws: ShareCaptureError.unsupported) {
            try ShareItemParser.editableBody(from: [.unsupported])
        }
    }

    @Test("An unsupported provider is rejected before any storage write")
    func unsupportedProviderDoesNotWrite() throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }

        let representation = ShareItemRepresentationClassifier.classify(
            canLoadURL: false,
            canLoadText: false
        )

        #expect(representation == .unsupported)
        #expect(throws: ShareCaptureError.unsupported) {
            try ShareItemParser.editableBody(from: [.unsupported])
        }
        #expect(!FileManager.default.fileExists(atPath: fixture.groupArchiveURL.path))
        #expect(!FileManager.default.fileExists(atPath: fixture.pendingDirectoryURL.path))
    }

    @Test("Preparing before Save creates no durable record")
    func prepareDoesNotPersist() throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let store = FileThoughtStore(fileURL: fixture.groupArchiveURL)
        let operation = ShareCaptureOperation(
            store: store,
            idGenerator: FixedShareIDGenerator(value: fixture.firstID),
            clock: FixedShareClock(value: fixture.date)
        )

        let attempt = try operation.prepare("Review me")

        #expect(attempt.thought.source == .iphone)
        #expect(!FileManager.default.fileExists(atPath: fixture.groupArchiveURL.path))
        #expect(!FileManager.default.fileExists(atPath: fixture.pendingDirectoryURL.path))
    }

    @Test("A Share save uses one stable identity and the iPhone source")
    func stableIdentity() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let store = FileThoughtStore(fileURL: fixture.groupArchiveURL)
        let operation = ShareCaptureOperation(
            store: store,
            idGenerator: FixedShareIDGenerator(value: fixture.firstID),
            clock: FixedShareClock(value: fixture.date)
        )
        let attempt = try operation.prepare("  saved from share  ")

        let first = try await operation.save(attempt)
        let retry = try await operation.save(attempt)

        #expect(first == retry)
        #expect(first.id == fixture.firstID)
        #expect(first.createdAt == ThoughtTimestamp.canonical(fixture.date))
        #expect(first.body == "saved from share")
        #expect(first.source == .iphone)
        #expect(first.kind == .text)
        #expect(first.checklistItems.isEmpty)
        #expect(first.tags.isEmpty)
        #expect(!first.archived)
    }

    @Test("The one-step Share capture wrapper prepares and persists the shared contract")
    func captureWrapper() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let store = FileThoughtStore(fileURL: fixture.groupArchiveURL)
        let operation = ShareCaptureOperation(
            store: store,
            idGenerator: FixedShareIDGenerator(value: fixture.firstID),
            clock: FixedShareClock(value: fixture.date)
        )

        let persisted = try await operation.capture("  Captured in one step  ")

        #expect(persisted == fixture.thought(body: "Captured in one step"))
        #expect(try await store.latest() == persisted)
        #expect(try fixture.pendingJournalCount() == 0)
    }

    @Test("A journal left before archive mutation replays exactly once")
    func interruptionAfterJournal() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let interruptedStore = FileThoughtStore(
            fileURL: fixture.groupArchiveURL,
            failurePoint: .afterJournalWrite
        )
        let operation = ShareCaptureOperation(
            store: interruptedStore,
            idGenerator: FixedShareIDGenerator(value: fixture.firstID),
            clock: FixedShareClock(value: fixture.date)
        )
        let attempt = try operation.prepare("Recover from journal")

        await #expect(throws: ThoughtStoreError.interrupted) {
            try await operation.save(attempt)
        }
        #expect(FileManager.default.fileExists(atPath: fixture.pendingDirectoryURL.path))

        let recoveringStore = FileThoughtStore(fileURL: fixture.groupArchiveURL)
        #expect(try await recoveringStore.latest() == attempt.thought)
        #expect(try fixture.readThoughts().count == 1)
        #expect(try fixture.pendingJournalCount() == 0)
        #expect(try await recoveringStore.latest() == attempt.thought)
        #expect(try fixture.readThoughts().count == 1)
    }

    @Test("A journal left after archive mutation replays without duplication")
    func interruptionAfterArchive() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let interruptedStore = FileThoughtStore(
            fileURL: fixture.groupArchiveURL,
            failurePoint: .afterArchiveWrite
        )
        let operation = ShareCaptureOperation(
            store: interruptedStore,
            idGenerator: FixedShareIDGenerator(value: fixture.firstID),
            clock: FixedShareClock(value: fixture.date)
        )
        let attempt = try operation.prepare("Already in the archive")

        await #expect(throws: ThoughtStoreError.interrupted) {
            try await operation.save(attempt)
        }
        #expect(try fixture.readThoughts() == [attempt.thought])
        #expect(try fixture.pendingJournalCount() == 1)

        let recoveringStore = FileThoughtStore(fileURL: fixture.groupArchiveURL)
        #expect(try await recoveringStore.latest() == attempt.thought)
        #expect(try fixture.readThoughts() == [attempt.thought])
        #expect(try fixture.pendingJournalCount() == 0)
    }

    @Test("Save journals the current attempt before reading a malformed archive")
    func journalPrecedesMalformedArchiveRead() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        try FileManager.default.createDirectory(
            at: fixture.groupArchiveURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let malformedArchive = Data("{ malformed canonical archive".utf8)
        try malformedArchive.write(to: fixture.groupArchiveURL)
        let store = FileThoughtStore(fileURL: fixture.groupArchiveURL)
        let operation = ShareCaptureOperation(
            store: store,
            idGenerator: FixedShareIDGenerator(value: fixture.firstID),
            clock: FixedShareClock(value: fixture.date)
        )
        let attempt = try operation.prepare("Journal me before reading")

        await #expect(throws: ThoughtStoreError.decode) {
            try await operation.save(attempt)
        }
        #expect(try Data(contentsOf: fixture.groupArchiveURL) == malformedArchive)
        #expect(try fixture.pendingJournalCount() == 1)
        #expect(try fixture.readPendingThought() == attempt.thought)

        try FileManager.default.removeItem(at: fixture.groupArchiveURL)
        let recoveringStore = FileThoughtStore(fileURL: fixture.groupArchiveURL)
        #expect(try await recoveringStore.latest() == attempt.thought)
        #expect(try fixture.pendingJournalCount() == 0)
    }
}

private struct FixedShareIDGenerator: CaptureIDGenerating {
    let value: UUID
    func next() -> UUID { value }
}

private struct FixedShareClock: CaptureClock {
    let value: Date
    func now() -> Date { value }
}
