import Foundation

/// The coordinated, process-safe storage implementation shared by the app,
/// App Intent, and Share extension. All archive and journal mutations happen
/// while coordinating the storage directory so independent processes cannot
/// overwrite one another's read-modify-write cycle.
final class SharedThoughtStorage: @unchecked Sendable {
    struct Configuration: Sendable {
        let archiveURL: URL?
        let legacyArchiveURL: URL?

        init(archiveURL: URL?, legacyArchiveURL: URL? = nil) {
            self.archiveURL = archiveURL
            self.legacyArchiveURL = legacyArchiveURL
        }
    }

    enum FailurePoint: Sendable {
        case afterJournalWrite
        case afterArchiveWrite
    }

    private struct Archive: Codable, Equatable {
        let schemaVersion: Int
        var thoughts: [Thought]
    }

    private struct PendingShare: Codable, Equatable {
        let schemaVersion: Int
        let thought: Thought
    }

    private let configuration: Configuration
    private let fileManager: FileManager
    private let failurePoint: FailurePoint?

    init(
        configuration: Configuration,
        fileManager: FileManager = .default,
        failurePoint: FailurePoint? = nil
    ) {
        self.configuration = configuration
        self.fileManager = fileManager
        self.failurePoint = failurePoint
    }

    func persist(_ thought: Thought) throws -> Thought {
        try coordinated { archiveURL in
            var archive = try prepareArchive(at: archiveURL)
            archive = try replayPendingShares(in: archive, archiveURL: archiveURL)
            let persisted = try add(thought, to: &archive)
            try writeAndVerify(archive, at: archiveURL)
            return persisted
        }
    }

    /// Called only after a person explicitly taps Save in the Share extension.
    /// The stable attempt is journaled before the canonical archive changes.
    func persistJournaledShare(_ thought: Thought) throws -> Thought {
        try coordinated { archiveURL in
            // The current stable attempt is the first data read/write after the
            // coordinated directory is available. Even a malformed old archive
            // or termination immediately after Save cannot erase this intent.
            _ = try writeJournal(for: thought, archiveURL: archiveURL)
            if failurePoint == .afterJournalWrite {
                throw ThoughtStoreError.interrupted
            }

            var archive = try prepareArchive(at: archiveURL)
            archive = try replayPendingShares(
                in: archive,
                archiveURL: archiveURL,
                removeAfterVerification: false
            )
            guard let persisted = archive.thoughts.first(where: { $0.id == thought.id }),
                  persisted == thought else {
                throw ThoughtStoreError.verificationFailed
            }
            if failurePoint == .afterArchiveWrite {
                throw ThoughtStoreError.interrupted
            }

            try removePendingJournals(archiveURL: archiveURL)
            return persisted
        }
    }

    func latest() throws -> Thought? {
        try coordinated { archiveURL in
            var archive = try prepareArchive(at: archiveURL)
            archive = try replayPendingShares(in: archive, archiveURL: archiveURL)
            return Self.sorted(archive.thoughts).last
        }
    }

    private func coordinated<T>(_ operation: (URL) throws -> T) throws -> T {
        guard let archiveURL = configuration.archiveURL else {
            throw ThoughtStoreError.appGroupUnavailable
        }

        let directoryURL = archiveURL.deletingLastPathComponent()
        do {
            try fileManager.createDirectory(
                at: directoryURL,
                withIntermediateDirectories: true
            )
        } catch {
            throw ThoughtStoreError.createDirectory
        }

        let coordinator = NSFileCoordinator(filePresenter: nil)
        var coordinationError: NSError?
        var result: Result<T, Error>?
        coordinator.coordinate(
            writingItemAt: directoryURL,
            options: [],
            error: &coordinationError
        ) { coordinatedDirectoryURL in
            let coordinatedArchiveURL = coordinatedDirectoryURL.appending(
                path: archiveURL.lastPathComponent,
                directoryHint: .notDirectory
            )
            result = Result { try operation(coordinatedArchiveURL) }
        }

        if let result {
            return try result.get()
        }
        throw ThoughtStoreError.coordinate
    }

    private func prepareArchive(at archiveURL: URL) throws -> Archive {
        let groupArchive = try readArchive(at: archiveURL)
        guard let legacyURL = configuration.legacyArchiveURL,
              fileManager.fileExists(atPath: legacyURL.path) else {
            return groupArchive
        }

        // Decode both complete archives before changing either one. A malformed
        // source therefore fails closed and preserves both byte streams.
        let legacyArchive = try readArchive(at: legacyURL)
        var merged = groupArchive
        for thought in legacyArchive.thoughts {
            _ = try add(thought, to: &merged)
        }
        merged.thoughts = Self.sorted(merged.thoughts)

        try writeAndVerify(merged, at: archiveURL)
        try retireLegacyArchive(at: legacyURL)
        return merged
    }

    private func replayPendingShares(
        in original: Archive,
        archiveURL: URL,
        removeAfterVerification: Bool = true
    ) throws -> Archive {
        let pendingDirectory = pendingDirectoryURL(for: archiveURL)
        guard fileManager.fileExists(atPath: pendingDirectory.path) else {
            return original
        }

        let journalURLs: [URL]
        do {
            journalURLs = try fileManager.contentsOfDirectory(
                at: pendingDirectory,
                includingPropertiesForKeys: nil,
                options: [.skipsHiddenFiles]
            )
            .filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        } catch {
            throw ThoughtStoreError.read
        }

        var pending: [(URL, PendingShare)] = []
        for url in journalURLs {
            let data = try readData(at: url)
            do {
                let journal = try JSONDecoder().decode(PendingShare.self, from: data)
                guard journal.schemaVersion == 1 else {
                    throw ThoughtStoreError.decode
                }
                pending.append((url, journal))
            } catch let error as ThoughtStoreError {
                throw error
            } catch {
                throw ThoughtStoreError.decode
            }
        }

        guard !pending.isEmpty else { return original }

        var archive = original
        for (_, journal) in pending {
            _ = try add(journal.thought, to: &archive)
        }
        archive.thoughts = Self.sorted(archive.thoughts)
        try writeAndVerify(archive, at: archiveURL)

        if removeAfterVerification {
            for (url, _) in pending {
                try removeJournal(at: url)
            }
        }
        return archive
    }

    private func add(_ thought: Thought, to archive: inout Archive) throws -> Thought {
        if let existing = archive.thoughts.first(where: { $0.id == thought.id }) {
            guard existing == thought else {
                throw ThoughtStoreError.conflictingIdentifier
            }
            return existing
        }

        archive.thoughts.append(thought)
        archive.thoughts = Self.sorted(archive.thoughts)
        return thought
    }

    private func readArchive(at url: URL) throws -> Archive {
        guard fileManager.fileExists(atPath: url.path) else {
            return Archive(schemaVersion: 1, thoughts: [])
        }

        let data = try readData(at: url)
        do {
            let archive = try JSONDecoder().decode(Archive.self, from: data)
            guard archive.schemaVersion == 1 else {
                throw ThoughtStoreError.decode
            }
            return Archive(
                schemaVersion: archive.schemaVersion,
                thoughts: try Self.normalized(archive.thoughts)
            )
        } catch let error as ThoughtStoreError {
            throw error
        } catch {
            throw ThoughtStoreError.decode
        }
    }

    private func writeAndVerify(_ archive: Archive, at url: URL) throws {
        let normalized = Archive(schemaVersion: 1, thoughts: Self.sorted(archive.thoughts))
        let data: Data
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            data = try encoder.encode(normalized)
        } catch {
            throw ThoughtStoreError.encode
        }

        do {
            try data.write(
                to: url,
                options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
            )
        } catch {
            throw ThoughtStoreError.write
        }

        guard try readArchive(at: url) == normalized else {
            throw ThoughtStoreError.verificationFailed
        }
    }

    private func writeJournal(for thought: Thought, archiveURL: URL) throws -> URL {
        let directoryURL = pendingDirectoryURL(for: archiveURL)
        do {
            try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        } catch {
            throw ThoughtStoreError.createDirectory
        }

        let url = directoryURL.appending(
            path: "\(thought.id.uuidString.lowercased()).json",
            directoryHint: .notDirectory
        )
        let pending = PendingShare(schemaVersion: 1, thought: thought)

        if fileManager.fileExists(atPath: url.path) {
            let existingData = try readData(at: url)
            do {
                let existing = try JSONDecoder().decode(PendingShare.self, from: existingData)
                guard existing == pending else {
                    throw ThoughtStoreError.conflictingIdentifier
                }
                return url
            } catch let error as ThoughtStoreError {
                throw error
            } catch {
                throw ThoughtStoreError.decode
            }
        }

        let data: Data
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            data = try encoder.encode(pending)
        } catch {
            throw ThoughtStoreError.encode
        }

        do {
            try data.write(
                to: url,
                options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
            )
        } catch {
            throw ThoughtStoreError.write
        }

        guard (try? Data(contentsOf: url)) == data else {
            throw ThoughtStoreError.verificationFailed
        }
        return url
    }

    private func removeJournal(at url: URL) throws {
        do {
            try fileManager.removeItem(at: url)
        } catch {
            throw ThoughtStoreError.write
        }
    }

    private func removePendingJournals(archiveURL: URL) throws {
        let directoryURL = pendingDirectoryURL(for: archiveURL)
        let urls: [URL]
        do {
            urls = try fileManager.contentsOfDirectory(
                at: directoryURL,
                includingPropertiesForKeys: nil,
                options: [.skipsHiddenFiles]
            )
            .filter { $0.pathExtension == "json" }
        } catch {
            throw ThoughtStoreError.read
        }
        for url in urls {
            try removeJournal(at: url)
        }
    }

    private func retireLegacyArchive(at legacyURL: URL) throws {
        let backupURL = legacyURL.deletingLastPathComponent().appending(
            path: "thoughts.pre-app-group-backup.json",
            directoryHint: .notDirectory
        )

        do {
            if fileManager.fileExists(atPath: backupURL.path) {
                let legacyData = try Data(contentsOf: legacyURL)
                let backupData = try Data(contentsOf: backupURL)
                if legacyData == backupData {
                    try fileManager.removeItem(at: legacyURL)
                } else {
                    // Never overwrite an older safety copy. A distinct legacy
                    // archive gets the next unused noncanonical backup name.
                    var suffix = 2
                    var uniqueBackupURL: URL
                    repeat {
                        uniqueBackupURL = legacyURL.deletingLastPathComponent().appending(
                            path: "thoughts.pre-app-group-backup-\(suffix).json",
                            directoryHint: .notDirectory
                        )
                        suffix += 1
                    } while fileManager.fileExists(atPath: uniqueBackupURL.path)
                    try fileManager.moveItem(at: legacyURL, to: uniqueBackupURL)
                }
            } else {
                try fileManager.moveItem(at: legacyURL, to: backupURL)
            }
        } catch let error as ThoughtStoreError {
            throw error
        } catch {
            throw ThoughtStoreError.migration
        }
    }

    private func readData(at url: URL) throws -> Data {
        do {
            return try Data(contentsOf: url)
        } catch {
            throw ThoughtStoreError.read
        }
    }

    private func pendingDirectoryURL(for archiveURL: URL) -> URL {
        archiveURL.deletingLastPathComponent().appending(
            path: "pending-shares",
            directoryHint: .isDirectory
        )
    }

    private static func sorted(_ thoughts: [Thought]) -> [Thought] {
        thoughts.sorted {
            if $0.createdAt != $1.createdAt {
                return $0.createdAt < $1.createdAt
            }
            return $0.id.uuidString < $1.id.uuidString
        }
    }

    private static func normalized(_ thoughts: [Thought]) throws -> [Thought] {
        var byIdentifier: [UUID: Thought] = [:]
        for thought in thoughts {
            if let existing = byIdentifier[thought.id] {
                guard existing == thought else {
                    throw ThoughtStoreError.conflictingIdentifier
                }
            } else {
                byIdentifier[thought.id] = thought
            }
        }
        return sorted(Array(byIdentifier.values))
    }
}
