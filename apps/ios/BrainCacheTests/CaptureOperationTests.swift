import Foundation
import Testing

@testable import BrainCache

struct CaptureOperationTests {
    private let fixedID = UUID(uuidString: "746AAB5F-C24A-4B50-9343-10DF55D2EC3D")!
    private let fixedDate = Date(timeIntervalSince1970: 1_788_232_860.456)

    @Test("Normalization trims only the edges and preserves internal line breaks")
    func normalization() throws {
        let store = RecordingThoughtStore()
        let operation = makeOperation(store: store)

        let attempt = try operation.prepare(
            "  First line\n  second line stays indented.  \n",
            source: .iphone
        )

        #expect(attempt.thought.body == "First line\n  second line stays indented.")
    }

    @Test("Normalization converts every CRLF to LF and preserves internal indentation")
    func crlfNormalization() throws {
        let store = RecordingThoughtStore()
        let operation = makeOperation(store: store)

        let attempt = try operation.prepare(
            "  First line\r\n  Second line\r\nThird line  ",
            source: .iphone
        )

        #expect(attempt.thought.body == "First line\n  Second line\nThird line")
        #expect(!attempt.thought.body.contains("\r"))
    }

    @Test("Empty input is rejected without touching persistence", arguments: ["", "   ", "\n\t\r"])
    func emptyInputPerformsZeroWrites(input: String) async {
        let store = RecordingThoughtStore()
        let operation = makeOperation(store: store)

        await #expect(throws: CaptureValidationError.emptyBody) {
            try await operation.capture(input, source: .iphone)
        }
        #expect(await store.persistCallCount == 0)
    }

    @Test("Prepared iPhone thoughts contain the complete stable shared contract")
    func stableContractFields() throws {
        let store = RecordingThoughtStore()
        let operation = makeOperation(store: store)

        let first = try operation.prepare("  Durable thought  ", source: .iphone)
        let second = first

        #expect(first == second)
        #expect(first.thought.id == fixedID)
        #expect(first.thought.body == "Durable thought")
        #expect(first.thought.createdAt == ThoughtTimestamp.canonical(fixedDate))
        #expect(first.thought.archived == false)
        #expect(first.thought.source == .iphone)
        #expect(first.thought.kind == .text)
        #expect(first.thought.checklistItems.isEmpty)
        #expect(first.thought.tags.isEmpty)

        let data = try JSONEncoder().encode(first.thought)
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(
            Set(json.keys)
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
        #expect(json["id"] as? String == fixedID.uuidString)
        #expect(json["body"] as? String == "Durable thought")
        #expect(json["kind"] as? String == "text")
        #expect((json["checklistItems"] as? [Any])?.isEmpty == true)
        #expect(json["createdAt"] as? String == ThoughtTimestamp.string(from: first.thought.createdAt))
        #expect(json["archived"] as? Bool == false)
        #expect(json["source"] as? String == "iphone")
        #expect((json["tags"] as? [Any])?.isEmpty == true)
    }

    @Test("Legacy five-field thoughts decode as untagged text records")
    func legacyContractDefaults() throws {
        let json = """
        {
          "id": "\(fixedID.uuidString)",
          "body": "Still durable",
          "createdAt": "\(ThoughtTimestamp.string(from: ThoughtTimestamp.canonical(fixedDate)))",
          "archived": false,
          "source": "iphone"
        }
        """

        let thought = try JSONDecoder().decode(Thought.self, from: Data(json.utf8))

        #expect(thought.id == fixedID)
        #expect(thought.body == "Still durable")
        #expect(thought.kind == .text)
        #expect(thought.checklistItems.isEmpty)
        #expect(thought.createdAt == ThoughtTimestamp.canonical(fixedDate))
        #expect(thought.archived == false)
        #expect(thought.source == .iphone)
        #expect(thought.tags.isEmpty)
    }

    @Test("Checklist thoughts preserve ordered items, tags, completion, and every reminder state")
    func checklistContractRoundTrip() throws {
        let itemIDs = [
            UUID(uuidString: "48CB594D-BF62-4D36-AEC7-D34A8A150DF4")!,
            UUID(uuidString: "14068688-D63A-481D-B1B4-AF357F2A6C92")!,
            UUID(uuidString: "3158D8DE-84B7-456A-B6B0-0068F4171213")!,
            UUID(uuidString: "B02C94EB-3A85-4039-A4CB-02876A0C678F")!,
            UUID(uuidString: "A95E9C76-48B4-4BE7-8CB2-62DDE3F57B88")!,
            UUID(uuidString: "E5446345-C2F8-48AA-A55A-C37A60917680")!
        ]
        let json = """
        {
          "id": "\(fixedID.uuidString)",
          "body": "No reminder\\nPending\\nScheduled\\nOverdue\\nPermission denied\\nScheduling failed",
          "kind": "checklist",
          "checklistItems": [
            {
              "id": "\(itemIDs[0].uuidString)",
              "text": "No reminder",
              "completed": false,
              "reminder": null
            },
            {
              "id": "\(itemIDs[1].uuidString)",
              "text": "Pending",
              "completed": true,
              "reminder": {
                "scheduledFor": "2026-09-04T14:00:00.000Z",
                "state": "pending",
                "lastError": null
              }
            },
            {
              "id": "\(itemIDs[2].uuidString)",
              "text": "Scheduled",
              "completed": false,
              "reminder": {
                "scheduledFor": "2026-09-05T14:00:00.000Z",
                "state": "scheduled",
                "lastError": null
              }
            },
            {
              "id": "\(itemIDs[3].uuidString)",
              "text": "Overdue",
              "completed": true,
              "reminder": {
                "scheduledFor": "2026-09-01T14:00:00.000Z",
                "state": "overdue",
                "lastError": null
              }
            },
            {
              "id": "\(itemIDs[4].uuidString)",
              "text": "Permission denied",
              "completed": false,
              "reminder": {
                "scheduledFor": "2026-09-06T14:00:00.000Z",
                "state": "permission-denied",
                "lastError": "Notifications are disabled."
              }
            },
            {
              "id": "\(itemIDs[5].uuidString)",
              "text": "Scheduling failed",
              "completed": true,
              "reminder": {
                "scheduledFor": "2026-09-07T14:00:00.000Z",
                "state": "scheduling-failed",
                "lastError": "The system request failed."
              }
            }
          ],
          "createdAt": "\(ThoughtTimestamp.string(from: ThoughtTimestamp.canonical(fixedDate)))",
          "archived": false,
          "source": "iphone",
          "tags": ["errands", "home"]
        }
        """

        let thought = try JSONDecoder().decode(Thought.self, from: Data(json.utf8))

        #expect(thought.kind == .checklist)
        #expect(thought.checklistItems.map(\.id) == itemIDs)
        #expect(thought.checklistItems.map(\.completed) == [false, true, false, true, false, true])
        #expect(thought.checklistItems[0].reminder == nil)
        #expect(
            thought.checklistItems.compactMap(\.reminder?.state)
                == [.pending, .scheduled, .overdue, .permissionDenied, .schedulingFailed]
        )
        #expect(thought.checklistItems[4].reminder?.lastError == "Notifications are disabled.")
        #expect(thought.checklistItems[5].reminder?.lastError == "The system request failed.")
        #expect(thought.tags == ["errands", "home"])

        let encoded = try JSONEncoder().encode(thought)
        let decodedAgain = try JSONDecoder().decode(Thought.self, from: encoded)
        #expect(decodedAgain == thought)

        let encodedJSON = try #require(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any]
        )
        let encodedItems = try #require(encodedJSON["checklistItems"] as? [[String: Any]])
        let rawStates = encodedItems.compactMap { item in
            (item["reminder"] as? [String: Any])?["state"] as? String
        }
        #expect(
            rawStates
                == ["pending", "scheduled", "overdue", "permission-denied", "scheduling-failed"]
        )
    }

    private func makeOperation(store: any ThoughtStore) -> CaptureOperation {
        CaptureOperation(
            store: store,
            idGenerator: FixedIDGenerator(value: fixedID),
            clock: FixedClock(value: fixedDate)
        )
    }
}

private struct FixedIDGenerator: CaptureIDGenerating {
    let value: UUID
    func next() -> UUID { value }
}

private struct FixedClock: CaptureClock {
    let value: Date
    func now() -> Date { value }
}

private actor RecordingThoughtStore: ThoughtStore {
    private(set) var persistCallCount = 0
    private var thoughts: [Thought] = []

    func persist(_ thought: Thought) -> Thought {
        persistCallCount += 1
        if let existing = thoughts.first(where: { $0.id == thought.id }) {
            return existing
        }
        thoughts.append(thought)
        return thought
    }

    func latest() -> Thought? {
        thoughts.last
    }
}
