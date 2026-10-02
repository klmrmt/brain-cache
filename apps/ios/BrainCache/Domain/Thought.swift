import Foundation

enum ThoughtSource: String, Codable, CaseIterable, Sendable {
    case macLibrary = "mac-library"
    case macCapture = "mac-capture"
    case iphone
    case shortcut
}

enum ThoughtKind: String, Codable, Sendable {
    case text
    case checklist
}

enum ChecklistReminderState: String, Codable, Sendable {
    case pending
    case scheduled
    case overdue
    case permissionDenied = "permission-denied"
    case schedulingFailed = "scheduling-failed"
}

struct ChecklistReminder: Codable, Equatable, Sendable {
    let scheduledFor: String
    let state: ChecklistReminderState
    let lastError: String?
}

struct ChecklistItem: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let text: String
    let completed: Bool
    let reminder: ChecklistReminder?
}

struct Thought: Codable, Equatable, Identifiable, Sendable {
    let id: UUID
    let body: String
    let kind: ThoughtKind
    let checklistItems: [ChecklistItem]
    let createdAt: Date
    let archived: Bool
    let source: ThoughtSource
    let tags: [String]

    init(
        id: UUID,
        body: String,
        createdAt: Date,
        archived: Bool = false,
        source: ThoughtSource
    ) {
        self.id = id
        self.body = body
        kind = .text
        checklistItems = []
        self.createdAt = createdAt
        self.archived = archived
        self.source = source
        tags = []
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case body
        case kind
        case checklistItems
        case createdAt
        case archived
        case source
        case tags
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        body = try container.decode(String.self, forKey: .body)
        kind = try container.contains(.kind)
            ? container.decode(ThoughtKind.self, forKey: .kind)
            : .text
        checklistItems = try container.contains(.checklistItems)
            ? container.decode([ChecklistItem].self, forKey: .checklistItems)
            : []
        archived = try container.decode(Bool.self, forKey: .archived)
        source = try container.decode(ThoughtSource.self, forKey: .source)
        tags = try container.contains(.tags)
            ? container.decode([String].self, forKey: .tags)
            : []

        let timestamp = try container.decode(String.self, forKey: .createdAt)
        do {
            createdAt = try ThoughtTimestamp.date(from: timestamp)
        } catch {
            throw DecodingError.dataCorruptedError(
                forKey: .createdAt,
                in: container,
                debugDescription: "createdAt must be a UTC ISO-8601 timestamp."
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(body, forKey: .body)
        try container.encode(kind, forKey: .kind)
        try container.encode(checklistItems, forKey: .checklistItems)
        try container.encode(ThoughtTimestamp.string(from: createdAt), forKey: .createdAt)
        try container.encode(archived, forKey: .archived)
        try container.encode(source, forKey: .source)
        try container.encode(tags, forKey: .tags)
    }
}

enum ThoughtTimestamp {
    private static var format: Date.ISO8601FormatStyle {
        Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    }

    static func string(from date: Date) -> String {
        format.format(date)
    }

    static func date(from value: String) throws -> Date {
        do {
            return try format.parse(value)
        } catch {
            return try Date.ISO8601FormatStyle().parse(value)
        }
    }

    static func canonical(_ date: Date) -> Date {
        // The persisted contract uses millisecond ISO-8601 precision. Round-trip
        // before constructing an attempt so its timestamp is identical after read-back.
        var candidate = date
        for _ in 0..<3 {
            let encoded = format.format(candidate)
            guard let decoded = try? format.parse(encoded) else { return candidate }
            if format.format(decoded) == encoded {
                return decoded
            }
            candidate = decoded
        }
        return candidate
    }
}
