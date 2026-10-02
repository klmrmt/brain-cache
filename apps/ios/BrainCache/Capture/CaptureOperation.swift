import Foundation

struct CaptureAttempt: Equatable, Sendable {
    let thought: Thought
}

enum CaptureValidationError: LocalizedError, Equatable, Sendable {
    case emptyBody

    var errorDescription: String? {
        switch self {
        case .emptyBody:
            "Give Blob something to remember."
        }
    }
}

protocol CaptureIDGenerating: Sendable {
    func next() -> UUID
}

struct LiveCaptureIDGenerator: CaptureIDGenerating {
    func next() -> UUID { UUID() }
}

protocol CaptureClock: Sendable {
    func now() -> Date
}

struct LiveCaptureClock: CaptureClock {
    func now() -> Date { .now }
}

struct CaptureOperation: Sendable {
    private let store: any ThoughtStore
    private let idGenerator: any CaptureIDGenerating
    private let clock: any CaptureClock

    init(
        store: any ThoughtStore,
        idGenerator: any CaptureIDGenerating = LiveCaptureIDGenerator(),
        clock: any CaptureClock = LiveCaptureClock()
    ) {
        self.store = store
        self.idGenerator = idGenerator
        self.clock = clock
    }

    func prepare(_ rawBody: String, source: ThoughtSource) throws -> CaptureAttempt {
        let body = Self.normalize(rawBody)
        guard !body.isEmpty else {
            throw CaptureValidationError.emptyBody
        }

        return CaptureAttempt(
            thought: Thought(
                id: idGenerator.next(),
                body: body,
                createdAt: ThoughtTimestamp.canonical(clock.now()),
                archived: false,
                source: source
            )
        )
    }

    func save(_ attempt: CaptureAttempt) async throws -> Thought {
        try await store.persist(attempt.thought)
    }

    func capture(_ rawBody: String, source: ThoughtSource) async throws -> Thought {
        try await save(prepare(rawBody, source: source))
    }

    func latest() async throws -> Thought? {
        try await store.latest()
    }

    static func normalize(_ rawBody: String) -> String {
        rawBody
            .replacingOccurrences(of: "\r\n", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
