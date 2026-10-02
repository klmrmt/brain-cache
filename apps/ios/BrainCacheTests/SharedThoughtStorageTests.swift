import Foundation
import Testing

@testable import BrainCache

struct SharedThoughtStorageTests {
    @Test("Legacy-only storage migrates and group-only storage opens unchanged")
    func singleSourceMigrationPaths() async throws {
        let legacyFixture = SharedStoreFixture()
        defer { legacyFixture.remove() }
        let legacyThought = legacyFixture.thought()
        try legacyFixture.writeArchive([legacyThought], to: legacyFixture.legacyArchiveURL)
        let migratingStore = FileThoughtStore(
            sharedArchiveURL: legacyFixture.groupArchiveURL,
            legacyArchiveURL: legacyFixture.legacyArchiveURL
        )
        #expect(try await migratingStore.latest() == legacyThought)
        #expect(try legacyFixture.readThoughts() == [legacyThought])

        let groupFixture = SharedStoreFixture()
        defer { groupFixture.remove() }
        let groupThought = groupFixture.thought()
        try groupFixture.writeArchive([groupThought], to: groupFixture.groupArchiveURL)
        let groupStore = FileThoughtStore(
            sharedArchiveURL: groupFixture.groupArchiveURL,
            legacyArchiveURL: groupFixture.legacyArchiveURL
        )
        let original = try Data(contentsOf: groupFixture.groupArchiveURL)
        #expect(try await groupStore.latest() == groupThought)
        #expect(try Data(contentsOf: groupFixture.groupArchiveURL) == original)
    }

    @Test("Independent store instances do not lose concurrent writes")
    func crossInstanceConcurrency() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let stores = (0..<24).map { _ in FileThoughtStore(fileURL: fixture.groupArchiveURL) }
        let thoughts = (0..<24).map { offset in
            fixture.thought(
                id: UUID(),
                body: "Concurrent \(offset)",
                date: fixture.date.addingTimeInterval(TimeInterval(offset))
            )
        }

        try await withThrowingTaskGroup(of: Thought.self) { group in
            for (index, thought) in thoughts.enumerated() {
                group.addTask {
                    try await stores[index].persist(thought)
                }
            }
            for try await persisted in group {
                #expect(thoughts.contains(persisted))
            }
        }

        let persisted = try fixture.readThoughts()
        #expect(persisted.count == thoughts.count)
        #expect(Set(persisted.map(\.id)) == Set(thoughts.map(\.id)))
    }

    @Test("Migration merges a preexisting shared archive and legacy archive")
    func migrationMergesBothArchives() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let shared = fixture.thought(
            id: fixture.firstID,
            body: "Saved by extension first",
            date: fixture.date.addingTimeInterval(10)
        )
        let legacy = fixture.thought(
            id: fixture.secondID,
            body: "Saved before App Group",
            date: fixture.date
        )
        try fixture.writeArchive([shared], to: fixture.groupArchiveURL)
        try fixture.writeArchive([legacy], to: fixture.legacyArchiveURL)
        let originalLegacy = try Data(contentsOf: fixture.legacyArchiveURL)

        let store = FileThoughtStore(
            sharedArchiveURL: fixture.groupArchiveURL,
            legacyArchiveURL: fixture.legacyArchiveURL
        )

        #expect(try await store.latest() == shared)
        #expect(try fixture.readThoughts() == [legacy, shared])
        #expect(!FileManager.default.fileExists(atPath: fixture.legacyArchiveURL.path))
        #expect(try Data(contentsOf: fixture.legacyBackupURL) == originalLegacy)
    }

    @Test("Migration deduplicates identical identifiers and is idempotent")
    func migrationDeduplicates() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let same = fixture.thought()
        try fixture.writeArchive([same, same], to: fixture.groupArchiveURL)
        try fixture.writeArchive([same], to: fixture.legacyArchiveURL)

        let store = FileThoughtStore(
            sharedArchiveURL: fixture.groupArchiveURL,
            legacyArchiveURL: fixture.legacyArchiveURL
        )
        #expect(try await store.latest() == same)
        #expect(try fixture.readThoughts() == [same])

        let reopened = FileThoughtStore(
            sharedArchiveURL: fixture.groupArchiveURL,
            legacyArchiveURL: fixture.legacyArchiveURL
        )
        #expect(try await reopened.latest() == same)
        #expect(try fixture.readThoughts() == [same])
    }

    @Test("Migration sorts equal timestamps by UUID")
    func deterministicEqualTimestampOrder() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let first = fixture.thought(id: fixture.firstID, body: "First UUID")
        let second = fixture.thought(id: fixture.secondID, body: "Second UUID")
        try fixture.writeArchive([second], to: fixture.groupArchiveURL)
        try fixture.writeArchive([first], to: fixture.legacyArchiveURL)

        let store = FileThoughtStore(
            sharedArchiveURL: fixture.groupArchiveURL,
            legacyArchiveURL: fixture.legacyArchiveURL
        )
        _ = try await store.latest()

        #expect(try fixture.readThoughts().map(\.id) == [fixture.firstID, fixture.secondID])
    }

    @Test("A different existing backup is preserved and migration uses a unique backup")
    func backupCollisionDoesNotBlockMigration() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let thought = fixture.thought()
        try fixture.writeArchive([thought], to: fixture.legacyArchiveURL)
        let legacyBytes = try Data(contentsOf: fixture.legacyArchiveURL)
        let previousBackup = Data("older unrelated safety copy".utf8)
        try previousBackup.write(to: fixture.legacyBackupURL)

        let store = FileThoughtStore(
            sharedArchiveURL: fixture.groupArchiveURL,
            legacyArchiveURL: fixture.legacyArchiveURL
        )
        #expect(try await store.latest() == thought)

        #expect(try Data(contentsOf: fixture.legacyBackupURL) == previousBackup)
        #expect(try Data(contentsOf: fixture.secondLegacyBackupURL) == legacyBytes)
        #expect(!FileManager.default.fileExists(atPath: fixture.legacyArchiveURL.path))
    }

    @Test("An identical existing backup lets migration retire the legacy archive")
    func identicalBackupCompletesMigration() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let thought = fixture.thought()
        try fixture.writeArchive([thought], to: fixture.legacyArchiveURL)
        let legacyBytes = try Data(contentsOf: fixture.legacyArchiveURL)
        try legacyBytes.write(to: fixture.legacyBackupURL)

        let store = FileThoughtStore(
            sharedArchiveURL: fixture.groupArchiveURL,
            legacyArchiveURL: fixture.legacyArchiveURL
        )

        #expect(try await store.latest() == thought)
        #expect(try fixture.readThoughts() == [thought])
        #expect(!FileManager.default.fileExists(atPath: fixture.legacyArchiveURL.path))
        #expect(try Data(contentsOf: fixture.legacyBackupURL) == legacyBytes)
    }

    @Test("Migration advances past every occupied backup suffix")
    func deeperBackupCollisionUsesNextSuffix() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let thought = fixture.thought()
        try fixture.writeArchive([thought], to: fixture.legacyArchiveURL)
        let legacyBytes = try Data(contentsOf: fixture.legacyArchiveURL)
        let firstBackup = Data("first safety copy".utf8)
        let secondBackup = Data("second safety copy".utf8)
        try firstBackup.write(to: fixture.legacyBackupURL)
        try secondBackup.write(to: fixture.secondLegacyBackupURL)

        let store = FileThoughtStore(
            sharedArchiveURL: fixture.groupArchiveURL,
            legacyArchiveURL: fixture.legacyArchiveURL
        )

        #expect(try await store.latest() == thought)
        #expect(try Data(contentsOf: fixture.legacyBackupURL) == firstBackup)
        #expect(try Data(contentsOf: fixture.secondLegacyBackupURL) == secondBackup)
        #expect(try Data(contentsOf: fixture.thirdLegacyBackupURL) == legacyBytes)
        #expect(!FileManager.default.fileExists(atPath: fixture.legacyArchiveURL.path))
    }

    @Test("A conflicting identifier across migration sources preserves both files")
    func migrationConflictFailsClosed() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let shared = fixture.thought(body: "Shared value")
        let legacy = fixture.thought(body: "Different legacy value")
        try fixture.writeArchive([shared], to: fixture.groupArchiveURL)
        try fixture.writeArchive([legacy], to: fixture.legacyArchiveURL)
        let sharedBytes = try Data(contentsOf: fixture.groupArchiveURL)
        let legacyBytes = try Data(contentsOf: fixture.legacyArchiveURL)

        let store = FileThoughtStore(
            sharedArchiveURL: fixture.groupArchiveURL,
            legacyArchiveURL: fixture.legacyArchiveURL
        )
        await #expect(throws: ThoughtStoreError.conflictingIdentifier) {
            try await store.latest()
        }
        #expect(try Data(contentsOf: fixture.groupArchiveURL) == sharedBytes)
        #expect(try Data(contentsOf: fixture.legacyArchiveURL) == legacyBytes)
        #expect(!FileManager.default.fileExists(atPath: fixture.legacyBackupURL.path))
    }

    @Test("Conflicting duplicate identifiers inside one archive fail closed")
    func internalDuplicateConflictFailsClosed() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        try fixture.writeArchive(
            [fixture.thought(body: "one"), fixture.thought(body: "two")],
            to: fixture.groupArchiveURL
        )
        let original = try Data(contentsOf: fixture.groupArchiveURL)

        let store = FileThoughtStore(fileURL: fixture.groupArchiveURL)
        await #expect(throws: ThoughtStoreError.conflictingIdentifier) {
            try await store.persist(fixture.thought(id: fixture.secondID))
        }
        #expect(try Data(contentsOf: fixture.groupArchiveURL) == original)
    }

    @Test("Malformed migration input leaves both archives byte-identical")
    func malformedMigrationFailsClosed() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        try fixture.writeArchive([fixture.thought()], to: fixture.groupArchiveURL)
        try FileManager.default.createDirectory(
            at: fixture.legacyArchiveURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let malformed = Data("{ not valid JSON".utf8)
        try malformed.write(to: fixture.legacyArchiveURL)
        let groupBytes = try Data(contentsOf: fixture.groupArchiveURL)

        let store = FileThoughtStore(
            sharedArchiveURL: fixture.groupArchiveURL,
            legacyArchiveURL: fixture.legacyArchiveURL
        )
        await #expect(throws: ThoughtStoreError.decode) {
            try await store.latest()
        }
        #expect(try Data(contentsOf: fixture.groupArchiveURL) == groupBytes)
        #expect(try Data(contentsOf: fixture.legacyArchiveURL) == malformed)
    }

    @Test("A malformed pending journal fails closed without changing archive or journal")
    func malformedJournalFailsClosed() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        try fixture.writeArchive([fixture.thought()], to: fixture.groupArchiveURL)
        try FileManager.default.createDirectory(
            at: fixture.pendingDirectoryURL,
            withIntermediateDirectories: true
        )
        let malformed = Data("not a pending share".utf8)
        let journalURL = fixture.pendingDirectoryURL.appending(path: "broken.json")
        try malformed.write(to: journalURL)
        let archiveBytes = try Data(contentsOf: fixture.groupArchiveURL)

        let store = FileThoughtStore(fileURL: fixture.groupArchiveURL)
        await #expect(throws: ThoughtStoreError.decode) {
            try await store.latest()
        }
        #expect(try Data(contentsOf: fixture.groupArchiveURL) == archiveBytes)
        #expect(try Data(contentsOf: journalURL) == malformed)
    }

    @Test("An existing identical Share journal resumes the same attempt")
    func identicalPendingJournalResumes() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let thought = fixture.thought()
        let journalURL = try fixture.writePendingShare(thought)
        let journalBytes = try Data(contentsOf: journalURL)
        let expectedJournalBytes = try fixture.encodedPendingShare(thought)
        let store = FileThoughtStore(fileURL: fixture.groupArchiveURL)

        #expect(try await store.persistJournaledShare(thought) == thought)
        #expect(try fixture.readThoughts() == [thought])
        #expect(try fixture.pendingJournalCount() == 0)
        #expect(journalBytes == expectedJournalBytes)
    }

    @Test("A conflicting existing Share journal fails before changing either file")
    func conflictingPendingJournalFailsClosed() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let intended = fixture.thought(body: "Intended value")
        let conflicting = fixture.thought(body: "Conflicting journal value")
        let journalURL = try fixture.writePendingShare(conflicting)
        let journalBytes = try Data(contentsOf: journalURL)
        let store = FileThoughtStore(fileURL: fixture.groupArchiveURL)

        await #expect(throws: ThoughtStoreError.conflictingIdentifier) {
            try await store.persistJournaledShare(intended)
        }
        #expect(!FileManager.default.fileExists(atPath: fixture.groupArchiveURL.path))
        #expect(try Data(contentsOf: journalURL) == journalBytes)
    }

    @Test("A malformed journal for the current Share attempt fails closed")
    func malformedCurrentPendingJournalFailsClosed() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let thought = fixture.thought()
        try FileManager.default.createDirectory(
            at: fixture.pendingDirectoryURL,
            withIntermediateDirectories: true
        )
        let journalURL = fixture.pendingDirectoryURL.appending(
            path: "\(thought.id.uuidString.lowercased()).json"
        )
        let malformed = Data("not a pending Share attempt".utf8)
        try malformed.write(to: journalURL)
        let store = FileThoughtStore(fileURL: fixture.groupArchiveURL)

        await #expect(throws: ThoughtStoreError.decode) {
            try await store.persistJournaledShare(thought)
        }
        #expect(!FileManager.default.fileExists(atPath: fixture.groupArchiveURL.path))
        #expect(try Data(contentsOf: journalURL) == malformed)
    }

    @Test("A pending journal that conflicts with the archive preserves both records")
    func pendingArchiveConflictFailsClosed() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let archived = fixture.thought(body: "Canonical value")
        let pending = fixture.thought(body: "Conflicting pending value")
        try fixture.writeArchive([archived], to: fixture.groupArchiveURL)
        let journalURL = try fixture.writePendingShare(pending)
        let archiveBytes = try Data(contentsOf: fixture.groupArchiveURL)
        let journalBytes = try Data(contentsOf: journalURL)
        let store = FileThoughtStore(fileURL: fixture.groupArchiveURL)

        await #expect(throws: ThoughtStoreError.conflictingIdentifier) {
            try await store.latest()
        }
        #expect(try Data(contentsOf: fixture.groupArchiveURL) == archiveBytes)
        #expect(try Data(contentsOf: journalURL) == journalBytes)
    }

    @Test("An empty or non-JSON pending directory is ignored without deleting unrelated files")
    func unrelatedPendingFilesAreIgnored() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        try FileManager.default.createDirectory(
            at: fixture.pendingDirectoryURL,
            withIntermediateDirectories: true
        )
        let noteURL = fixture.pendingDirectoryURL.appending(path: "keep.txt")
        let note = Data("not a Share journal".utf8)
        try note.write(to: noteURL)
        let store = FileThoughtStore(fileURL: fixture.groupArchiveURL)

        #expect(try await store.latest() == nil)
        #expect(try Data(contentsOf: noteURL) == note)
        #expect(!FileManager.default.fileExists(atPath: fixture.groupArchiveURL.path))
    }

    @Test("Unsupported archive schema fails closed")
    func unsupportedArchiveSchemaFailsClosed() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        try fixture.writeArchive(
            [fixture.thought()],
            to: fixture.groupArchiveURL,
            schemaVersion: 99
        )
        let original = try Data(contentsOf: fixture.groupArchiveURL)
        let store = FileThoughtStore(fileURL: fixture.groupArchiveURL)

        await #expect(throws: ThoughtStoreError.decode) {
            try await store.latest()
        }
        #expect(try Data(contentsOf: fixture.groupArchiveURL) == original)
    }

    @Test("Unsupported pending journal schema preserves the archive and journal")
    func unsupportedPendingSchemaFailsClosed() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let archived = fixture.thought(id: fixture.secondID, body: "Already safe")
        try fixture.writeArchive([archived], to: fixture.groupArchiveURL)
        let journalURL = try fixture.writePendingShare(
            fixture.thought(body: "Future journal"),
            schemaVersion: 99
        )
        let archiveBytes = try Data(contentsOf: fixture.groupArchiveURL)
        let journalBytes = try Data(contentsOf: journalURL)
        let store = FileThoughtStore(fileURL: fixture.groupArchiveURL)

        await #expect(throws: ThoughtStoreError.decode) {
            try await store.latest()
        }
        #expect(try Data(contentsOf: fixture.groupArchiveURL) == archiveBytes)
        #expect(try Data(contentsOf: journalURL) == journalBytes)
    }

    @Test("New storage errors provide actionable local recovery guidance")
    func localizedStorageErrors() {
        #expect(
            ThoughtStoreError.appGroupUnavailable.errorDescription
                == "Brain Cache cannot access its shared local storage. Reinstall the app, then try again."
        )
        #expect(
            ThoughtStoreError.coordinate.errorDescription
                == "Brain Cache could not coordinate access to local storage."
        )
        #expect(
            ThoughtStoreError.migration.errorDescription
                == "Brain Cache could not finish migrating local storage. Your data remains safe, and migration will retry on the next local access."
        )
        #expect(
            ThoughtStoreError.interrupted.errorDescription
                == "Brain Cache was interrupted while saving. The thought will be recovered on the next local access."
        )
    }

    @Test("Directory preparation failures use the dedicated storage error")
    func createDirectoryFailureIsMapped() async {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let store = FileThoughtStore(
            fileURL: fixture.groupArchiveURL,
            fileManager: InjectedFailureFileManager(.createDirectory)
        )

        await #expect(throws: ThoughtStoreError.createDirectory) {
            try await store.latest()
        }
    }

    @Test("Pending-directory read failures preserve the archive and journal")
    func pendingDirectoryReadFailureIsMapped() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let archived = fixture.thought(id: fixture.secondID, body: "Already safe")
        let pending = fixture.thought(body: "Still pending")
        try fixture.writeArchive([archived], to: fixture.groupArchiveURL)
        let journalURL = try fixture.writePendingShare(pending)
        let archiveBytes = try Data(contentsOf: fixture.groupArchiveURL)
        let journalBytes = try Data(contentsOf: journalURL)
        let store = FileThoughtStore(
            fileURL: fixture.groupArchiveURL,
            fileManager: InjectedFailureFileManager(.listPending)
        )

        await #expect(throws: ThoughtStoreError.read) {
            try await store.latest()
        }
        #expect(try Data(contentsOf: fixture.groupArchiveURL) == archiveBytes)
        #expect(try Data(contentsOf: journalURL) == journalBytes)
    }

    @Test("Journal cleanup failure leaves a replayable record without duplication")
    func journalCleanupFailureRecovers() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let thought = fixture.thought()
        let journalURL = try fixture.writePendingShare(thought)
        let store = FileThoughtStore(
            fileURL: fixture.groupArchiveURL,
            fileManager: InjectedFailureFileManager(.removeJournal)
        )

        await #expect(throws: ThoughtStoreError.write) {
            try await store.latest()
        }
        #expect(try fixture.readThoughts() == [thought])
        #expect(FileManager.default.fileExists(atPath: journalURL.path))

        let recoveringStore = FileThoughtStore(fileURL: fixture.groupArchiveURL)
        #expect(try await recoveringStore.latest() == thought)
        #expect(try fixture.readThoughts() == [thought])
        #expect(try fixture.pendingJournalCount() == 0)
    }

    @Test("Interrupted legacy retirement retries without losing or duplicating data")
    func legacyRetirementFailureRecovers() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        let thought = fixture.thought()
        try fixture.writeArchive([thought], to: fixture.legacyArchiveURL)
        let legacyBytes = try Data(contentsOf: fixture.legacyArchiveURL)
        let interruptedStore = FileThoughtStore(
            sharedArchiveURL: fixture.groupArchiveURL,
            legacyArchiveURL: fixture.legacyArchiveURL,
            fileManager: InjectedFailureFileManager(.moveLegacy)
        )

        await #expect(throws: ThoughtStoreError.migration) {
            try await interruptedStore.latest()
        }
        #expect(try fixture.readThoughts() == [thought])
        #expect(try Data(contentsOf: fixture.legacyArchiveURL) == legacyBytes)

        let recoveringStore = FileThoughtStore(
            sharedArchiveURL: fixture.groupArchiveURL,
            legacyArchiveURL: fixture.legacyArchiveURL
        )
        #expect(try await recoveringStore.latest() == thought)
        #expect(try fixture.readThoughts() == [thought])
        #expect(!FileManager.default.fileExists(atPath: fixture.legacyArchiveURL.path))
    }

    @Test("Missing App Group configuration never falls back to private storage")
    func missingGroupFailsVisibly() async throws {
        let fixture = SharedStoreFixture()
        defer { fixture.remove() }
        try fixture.writeArchive([fixture.thought()], to: fixture.legacyArchiveURL)
        let legacyBytes = try Data(contentsOf: fixture.legacyArchiveURL)
        let store = FileThoughtStore(
            sharedArchiveURL: nil,
            legacyArchiveURL: fixture.legacyArchiveURL
        )

        await #expect(throws: ThoughtStoreError.appGroupUnavailable) {
            try await store.latest()
        }
        await #expect(throws: ThoughtStoreError.appGroupUnavailable) {
            try await store.persist(fixture.thought(id: fixture.secondID))
        }
        #expect(try Data(contentsOf: fixture.legacyArchiveURL) == legacyBytes)
    }
}

private final class InjectedFailureFileManager: FileManager, @unchecked Sendable {
    enum Failure {
        case createDirectory
        case listPending
        case removeJournal
        case moveLegacy
    }

    private let failure: Failure

    init(_ failure: Failure) {
        self.failure = failure
        super.init()
    }

    override func createDirectory(
        at url: URL,
        withIntermediateDirectories createIntermediates: Bool,
        attributes: [FileAttributeKey: Any]? = nil
    ) throws {
        if failure == .createDirectory {
            throw CocoaError(.fileWriteNoPermission)
        }
        try super.createDirectory(
            at: url,
            withIntermediateDirectories: createIntermediates,
            attributes: attributes
        )
    }

    override func contentsOfDirectory(
        at url: URL,
        includingPropertiesForKeys keys: [URLResourceKey]?,
        options mask: DirectoryEnumerationOptions = []
    ) throws -> [URL] {
        if failure == .listPending, url.lastPathComponent == "pending-shares" {
            throw CocoaError(.fileReadNoPermission)
        }
        return try super.contentsOfDirectory(
            at: url,
            includingPropertiesForKeys: keys,
            options: mask
        )
    }

    override func removeItem(at url: URL) throws {
        if failure == .removeJournal, url.deletingLastPathComponent().lastPathComponent == "pending-shares" {
            throw CocoaError(.fileWriteNoPermission)
        }
        try super.removeItem(at: url)
    }

    override func moveItem(at srcURL: URL, to dstURL: URL) throws {
        if failure == .moveLegacy {
            throw CocoaError(.fileWriteNoPermission)
        }
        try super.moveItem(at: srcURL, to: dstURL)
    }
}

struct SharedStoreFixture {
    private struct Archive: Codable {
        let schemaVersion: Int
        let thoughts: [Thought]
    }

    private struct PendingShare: Codable {
        let schemaVersion: Int
        let thought: Thought
    }

    let rootURL = FileManager.default.temporaryDirectory.appending(
        path: "BrainCacheSharedTests-\(UUID().uuidString)",
        directoryHint: .isDirectory
    )
    let firstID = UUID(uuidString: "A4506E58-4A4D-4468-A44A-2461D365452D")!
    let secondID = UUID(uuidString: "BF02796F-41AE-4B48-8F21-48427299A503")!
    let date = Date(timeIntervalSince1970: 1_788_233_800.123)

    var groupArchiveURL: URL {
        rootURL
            .appending(path: "group", directoryHint: .isDirectory)
            .appending(path: "thoughts.json", directoryHint: .notDirectory)
    }

    var legacyArchiveURL: URL {
        rootURL
            .appending(path: "legacy", directoryHint: .isDirectory)
            .appending(path: "thoughts.json", directoryHint: .notDirectory)
    }

    var legacyBackupURL: URL {
        legacyArchiveURL.deletingLastPathComponent().appending(
            path: "thoughts.pre-app-group-backup.json",
            directoryHint: .notDirectory
        )
    }

    var secondLegacyBackupURL: URL {
        legacyArchiveURL.deletingLastPathComponent().appending(
            path: "thoughts.pre-app-group-backup-2.json",
            directoryHint: .notDirectory
        )
    }

    var thirdLegacyBackupURL: URL {
        legacyArchiveURL.deletingLastPathComponent().appending(
            path: "thoughts.pre-app-group-backup-3.json",
            directoryHint: .notDirectory
        )
    }

    var pendingDirectoryURL: URL {
        groupArchiveURL.deletingLastPathComponent().appending(
            path: "pending-shares",
            directoryHint: .isDirectory
        )
    }

    func thought(
        id: UUID? = nil,
        body: String = "Shared thought",
        date: Date? = nil
    ) -> Thought {
        Thought(
            id: id ?? firstID,
            body: body,
            createdAt: ThoughtTimestamp.canonical(date ?? self.date),
            source: .iphone
        )
    }

    func writeArchive(
        _ thoughts: [Thought],
        to url: URL,
        schemaVersion: Int = 1
    ) throws {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(Archive(schemaVersion: schemaVersion, thoughts: thoughts)).write(to: url)
    }

    @discardableResult
    func writePendingShare(_ thought: Thought, schemaVersion: Int = 1) throws -> URL {
        try FileManager.default.createDirectory(
            at: pendingDirectoryURL,
            withIntermediateDirectories: true
        )
        let url = pendingDirectoryURL.appending(
            path: "\(thought.id.uuidString.lowercased()).json",
            directoryHint: .notDirectory
        )
        try encodedPendingShare(thought, schemaVersion: schemaVersion).write(to: url)
        return url
    }

    func encodedPendingShare(_ thought: Thought, schemaVersion: Int = 1) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(PendingShare(schemaVersion: schemaVersion, thought: thought))
    }

    func readThoughts() throws -> [Thought] {
        let data = try Data(contentsOf: groupArchiveURL)
        return try JSONDecoder().decode(Archive.self, from: data).thoughts
    }

    func pendingJournalCount() throws -> Int {
        guard FileManager.default.fileExists(atPath: pendingDirectoryURL.path) else { return 0 }
        return try FileManager.default.contentsOfDirectory(atPath: pendingDirectoryURL.path)
            .filter { $0.hasSuffix(".json") }
            .count
    }

    func readPendingThought() throws -> Thought {
        let journalURL = try FileManager.default.contentsOfDirectory(
            at: pendingDirectoryURL,
            includingPropertiesForKeys: nil
        )
        .first { $0.pathExtension == "json" }
        let url = try #require(journalURL)
        let pending = try JSONDecoder().decode(PendingShare.self, from: Data(contentsOf: url))
        #expect(pending.schemaVersion == 1)
        return pending.thought
    }

    func remove() {
        try? FileManager.default.removeItem(at: rootURL)
    }
}
