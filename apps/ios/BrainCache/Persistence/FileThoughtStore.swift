import Foundation

actor FileThoughtStore: ThoughtStore {
    static let appGroupIdentifier = "group.com.braincache.iphone"

    private let storage: SharedThoughtStorage

    /// Direct-file construction remains available for focused tests. Production
    /// entry points use `applicationStore` or `shareExtensionStore` below.
    init(
        fileURL: URL,
        fileManager: FileManager = .default,
        failurePoint: SharedThoughtStorage.FailurePoint? = nil
    ) {
        storage = SharedThoughtStorage(
            configuration: .init(archiveURL: fileURL),
            fileManager: fileManager,
            failurePoint: failurePoint
        )
    }

    init(
        sharedArchiveURL: URL?,
        legacyArchiveURL: URL?,
        fileManager: FileManager = .default,
        failurePoint: SharedThoughtStorage.FailurePoint? = nil
    ) {
        storage = SharedThoughtStorage(
            configuration: .init(
                archiveURL: sharedArchiveURL,
                legacyArchiveURL: legacyArchiveURL
            ),
            fileManager: fileManager,
            failurePoint: failurePoint
        )
    }

    static var applicationFileURL: URL {
        URL.applicationSupportDirectory
            .appending(path: "BrainCache", directoryHint: .isDirectory)
            .appending(path: "thoughts.json", directoryHint: .notDirectory)
    }

    static func applicationStore() -> FileThoughtStore {
        FileThoughtStore(
            sharedArchiveURL: sharedArchiveURL(),
            legacyArchiveURL: applicationFileURL
        )
    }

    static func shareExtensionStore() -> FileThoughtStore {
        FileThoughtStore(
            sharedArchiveURL: sharedArchiveURL(),
            legacyArchiveURL: nil
        )
    }

    static func sharedArchiveURL() -> URL? {
        FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier)?
            .appending(path: "BrainCache", directoryHint: .isDirectory)
            .appending(path: "thoughts.json", directoryHint: .notDirectory)
    }

    func persist(_ thought: Thought) throws -> Thought {
        try storage.persist(thought)
    }

    func persistJournaledShare(_ thought: Thought) throws -> Thought {
        try storage.persistJournaledShare(thought)
    }

    func latest() throws -> Thought? {
        try storage.latest()
    }
}
