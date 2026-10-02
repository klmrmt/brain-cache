import Foundation

enum SharedItem: Equatable, Sendable {
    case text(String)
    case url(URL)
    case unsupported
}

enum ShareCaptureError: LocalizedError, Equatable, Sendable {
    case empty
    case multipleItems
    case unsupported
    case relativeURL

    var errorDescription: String? {
        switch self {
        case .empty:
            "Share some text or a link for Blob to remember."
        case .multipleItems:
            "Brain Cache can save one shared item at a time."
        case .unsupported:
            "Brain Cache can save shared text and links."
        case .relativeURL:
            "Brain Cache needs a complete link, including its address scheme."
        }
    }
}

enum ShareItemRepresentation: Equatable, Sendable {
    case url
    case text
    case unsupported
}

enum ShareItemRepresentationClassifier {
    static func classify(canLoadURL: Bool, canLoadText: Bool) -> ShareItemRepresentation {
        if canLoadURL { return .url }
        if canLoadText { return .text }
        return .unsupported
    }
}

enum ShareItemParser {
    static func editableBody(from items: [SharedItem]) throws -> String {
        guard !items.isEmpty else { throw ShareCaptureError.empty }
        guard items.count == 1 else { throw ShareCaptureError.multipleItems }

        switch items[0] {
        case let .text(rawText):
            let body = CaptureOperation.normalize(rawText)
            guard !body.isEmpty else { throw ShareCaptureError.empty }
            return body
        case let .url(url):
            guard url.scheme != nil, !url.absoluteString.isEmpty else {
                throw ShareCaptureError.relativeURL
            }
            return url.absoluteString
        case .unsupported:
            throw ShareCaptureError.unsupported
        }
    }
}

struct ShareCaptureOperation: Sendable {
    private let captureOperation: CaptureOperation
    private let store: FileThoughtStore

    init(
        store: FileThoughtStore,
        idGenerator: any CaptureIDGenerating = LiveCaptureIDGenerator(),
        clock: any CaptureClock = LiveCaptureClock()
    ) {
        self.store = store
        captureOperation = CaptureOperation(
            store: store,
            idGenerator: idGenerator,
            clock: clock
        )
    }

    func prepare(_ editableBody: String) throws -> CaptureAttempt {
        try captureOperation.prepare(editableBody, source: .iphone)
    }

    func save(_ attempt: CaptureAttempt) async throws -> Thought {
        try await store.persistJournaledShare(attempt.thought)
    }

    func capture(_ editableBody: String) async throws -> Thought {
        try await save(prepare(editableBody))
    }
}
