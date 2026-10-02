import Foundation
import Testing

@testable import BrainCache

struct FileThoughtStoreTests {
    @Test("A legacy five-field archive remains readable and upgrades on the next write")
    func legacyArchiveMigration() async throws {
        let fixture = StoreFixture()
        defer { fixture.remove() }

        try FileManager.default.createDirectory(
            at: fixture.directoryURL,
            withIntermediateDirectories: true
        )
        let legacyArchive = """
        {
          "schemaVersion": 1,
          "thoughts": [
            {
              "id": "\(fixture.id.uuidString)",
              "body": "Legacy thought",
              "createdAt": "\(ThoughtTimestamp.string(from: ThoughtTimestamp.canonical(fixture.date)))",
              "archived": false,
              "source": "iphone"
            }
          ]
        }
        """
        try Data(legacyArchive.utf8).write(to: fixture.fileURL)

        let store = FileThoughtStore(fileURL: fixture.fileURL)
        let recovered = try #require(try await store.latest())
        #expect(recovered.kind == .text)
        #expect(recovered.checklistItems.isEmpty)
        #expect(recovered.tags.isEmpty)

        let next = Thought(
            id: UUID(uuidString: "7EC104EA-5FA3-48C2-9C8A-893039C5C746")!,
            body: "New thought",
            createdAt: ThoughtTimestamp.canonical(fixture.date.addingTimeInterval(1)),
            source: .iphone
        )
        _ = try await store.persist(next)

        let data = try Data(contentsOf: fixture.fileURL)
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json["schemaVersion"] as? Int == 1)
        let thoughts = try #require(json["thoughts"] as? [[String: Any]])
        #expect(thoughts.count == 2)
        #expect(thoughts[0]["kind"] as? String == "text")
        #expect((thoughts[0]["checklistItems"] as? [Any])?.isEmpty == true)
        #expect((thoughts[0]["tags"] as? [Any])?.isEmpty == true)
    }

    @Test("Malformed present additive fields fail without rewriting the archive")
    func malformedAdditiveFields() async throws {
        let invalidFieldSets = [
            """
            "kind": "voice",
            "checklistItems": [],
            "tags": []
            """,
            """
            "kind": "text",
            "checklistItems": {},
            "tags": []
            """,
            """
            "kind": "text",
            "checklistItems": [],
            "tags": null
            """,
            """
            "kind": "checklist",
            "checklistItems": [
              {
                "id": "4FEE1AAE-180B-4415-BD3E-A4EC3E328955",
                "text": "Unknown reminder state",
                "completed": false,
                "reminder": {
                  "scheduledFor": "2026-09-04T14:00:00.000Z",
                  "state": "dismissed",
                  "lastError": null
                }
              }
            ],
            "tags": []
            """
        ]

        for invalidFields in invalidFieldSets {
            try await assertInvalidArchiveRemainsUnchanged(invalidFields: invalidFields)
        }
    }

    @Test("A saved thought survives reopening the file store")
    func persistenceAndReopen() async throws {
        let fixture = StoreFixture()
        defer { fixture.remove() }

        let thought = fixture.thought()
        let firstStore = FileThoughtStore(fileURL: fixture.fileURL)
        let persisted = try await firstStore.persist(thought)
        #expect(persisted == thought)

        let reopenedStore = FileThoughtStore(fileURL: fixture.fileURL)
        #expect(try await reopenedStore.latest() == thought)
    }

    @Test("Concurrent retries of one attempt write one record and return one identity")
    func concurrentIdempotency() async throws {
        let fixture = StoreFixture()
        defer { fixture.remove() }

        let store = FileThoughtStore(fileURL: fixture.fileURL)
        let operation = CaptureOperation(
            store: store,
            idGenerator: FixedStoreIDGenerator(value: fixture.id),
            clock: FixedStoreClock(value: fixture.date)
        )
        let attempt = try operation.prepare("Save exactly once", source: .iphone)

        let results = try await withThrowingTaskGroup(of: Thought.self) { group in
            for _ in 0..<12 {
                group.addTask {
                    try await operation.save(attempt)
                }
            }
            return try await group.reduce(into: []) { $0.append($1) }
        }

        #expect(results.count == 12)
        #expect(Set(results.map(\.id)) == [fixture.id])
        #expect(Set(results.map(\.createdAt)) == [ThoughtTimestamp.canonical(fixture.date)])

        let data = try Data(contentsOf: fixture.fileURL)
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let thoughts = try #require(json["thoughts"] as? [[String: Any]])
        #expect(thoughts.count == 1)
    }

    @Test("Reusing an identifier for different content is rejected")
    func conflictingIdentifier() async throws {
        let fixture = StoreFixture()
        defer { fixture.remove() }

        let store = FileThoughtStore(fileURL: fixture.fileURL)
        let original = fixture.thought(body: "Original")
        _ = try await store.persist(original)

        let conflict = Thought(
            id: original.id,
            body: "Different",
            createdAt: original.createdAt,
            source: .iphone
        )
        await #expect(throws: ThoughtStoreError.conflictingIdentifier) {
            try await store.persist(conflict)
        }
        #expect(try await store.latest() == original)
    }

    private func assertInvalidArchiveRemainsUnchanged(invalidFields: String) async throws {
        let fixture = StoreFixture()
        defer { fixture.remove() }

        try FileManager.default.createDirectory(
            at: fixture.directoryURL,
            withIntermediateDirectories: true
        )
        let archive = """
        {
          "schemaVersion": 1,
          "thoughts": [
            {
              "id": "\(fixture.id.uuidString)",
              "body": "Do not rewrite this archive",
              "createdAt": "\(ThoughtTimestamp.string(from: ThoughtTimestamp.canonical(fixture.date)))",
              "archived": false,
              "source": "iphone",
              \(invalidFields)
            }
          ]
        }
        """
        let originalData = Data(archive.utf8)
        try originalData.write(to: fixture.fileURL)

        let store = FileThoughtStore(fileURL: fixture.fileURL)
        await #expect(throws: ThoughtStoreError.decode) {
            try await store.latest()
        }
        await #expect(throws: ThoughtStoreError.decode) {
            try await store.persist(fixture.thought(body: "Must not be appended"))
        }
        #expect(try Data(contentsOf: fixture.fileURL) == originalData)
    }
}

private struct StoreFixture {
    let directoryURL = FileManager.default.temporaryDirectory
        .appending(path: "BrainCacheTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    let id = UUID(uuidString: "B8B27C04-EAAC-4F52-B42A-3B8CB2B88676")!
    let date = Date(timeIntervalSince1970: 1_788_232_860.456)

    var fileURL: URL {
        directoryURL.appending(path: "thoughts.json", directoryHint: .notDirectory)
    }

    func thought(body: String = "Still here after relaunch") -> Thought {
        Thought(
            id: id,
            body: body,
            createdAt: ThoughtTimestamp.canonical(date),
            source: .iphone
        )
    }

    func remove() {
        try? FileManager.default.removeItem(at: directoryURL)
    }
}

private struct FixedStoreIDGenerator: CaptureIDGenerating {
    let value: UUID
    func next() -> UUID { value }
}

private struct FixedStoreClock: CaptureClock {
    let value: Date
    func now() -> Date { value }
}
