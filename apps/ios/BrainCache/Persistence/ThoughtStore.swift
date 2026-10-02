import Foundation

protocol ThoughtStore: Sendable {
    /// Returns only after the exact thought is durably stored and read back.
    func persist(_ thought: Thought) async throws -> Thought

    /// The recovery surface intentionally exposes only the latest local record.
    func latest() async throws -> Thought?
}

enum ThoughtStoreError: LocalizedError, Equatable, Sendable {
    case appGroupUnavailable
    case createDirectory
    case coordinate
    case read
    case decode
    case encode
    case write
    case verificationFailed
    case conflictingIdentifier
    case migration
    case interrupted

    var errorDescription: String? {
        switch self {
        case .appGroupUnavailable:
            "Brain Cache cannot access its shared local storage. Reinstall the app, then try again."
        case .createDirectory:
            "Brain Cache could not prepare local storage."
        case .coordinate:
            "Brain Cache could not coordinate access to local storage."
        case .read, .decode:
            "Brain Cache could not read local storage."
        case .encode, .write:
            "Brain Cache could not write to local storage."
        case .verificationFailed:
            "Brain Cache could not verify the local save."
        case .conflictingIdentifier:
            "Brain Cache found a conflicting local record."
        case .migration:
            "Brain Cache could not finish migrating local storage. Your data remains safe, and migration will retry on the next local access."
        case .interrupted:
            "Brain Cache was interrupted while saving. The thought will be recovered on the next local access."
        }
    }
}
