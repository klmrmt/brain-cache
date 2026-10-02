import Foundation
import SwiftData

public enum ThoughtCaptureError: LocalizedError, Equatable {
  case empty

  public var errorDescription: String? {
    switch self {
    case .empty:
      "Type something before saving."
    }
  }
}

@MainActor
public enum ThoughtCapture {
  @discardableResult
  public static func save(
    _ rawText: String,
    source: ThoughtSource,
    into context: ModelContext,
    now: Date = .now
  ) throws -> Thought {
    let text = normalized(rawText)
    guard !text.isEmpty else {
      throw ThoughtCaptureError.empty
    }

    let thought = Thought(
      text: text,
      createdAt: now,
      source: source,
      syncState: .pending
    )
    context.insert(thought)
    do {
      try context.save()
    } catch {
      context.delete(thought)
      throw error
    }
    return thought
  }

  public static func normalized(_ value: String) -> String {
    value.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}
