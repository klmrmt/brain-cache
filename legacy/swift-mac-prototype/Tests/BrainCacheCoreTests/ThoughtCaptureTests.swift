import SwiftData
import XCTest

@testable import BrainCacheCore

final class ThoughtCaptureTests: XCTestCase {
  @MainActor
  func testSaveTrimsAndPersistsAThought() throws {
    let container = try ModelContainer(
      for: Thought.self,
      configurations: ModelConfiguration(isStoredInMemoryOnly: true)
    )
    let now = Date(timeIntervalSince1970: 1_788_232_860)

    let thought = try ThoughtCapture.save(
      "  Catch this before it disappears.\n",
      source: .macPet,
      into: container.mainContext,
      now: now
    )

    let stored = try container.mainContext.fetch(FetchDescriptor<Thought>())
    XCTAssertEqual(stored.count, 1)
    XCTAssertEqual(stored.first?.id, thought.id)
    XCTAssertEqual(stored.first?.text, "Catch this before it disappears.")
    XCTAssertEqual(stored.first?.source, .macPet)
    XCTAssertEqual(stored.first?.syncState, .pending)
    XCTAssertEqual(stored.first?.createdAt, now)
  }

  @MainActor
  func testSaveRejectsWhitespaceOnlyInput() throws {
    let container = try ModelContainer(
      for: Thought.self,
      configurations: ModelConfiguration(isStoredInMemoryOnly: true)
    )

    XCTAssertThrowsError(
      try ThoughtCapture.save(
        " \n\t ",
        source: .macPet,
        into: container.mainContext
      )
    ) { error in
      XCTAssertEqual(error as? ThoughtCaptureError, .empty)
    }

    let stored = try container.mainContext.fetch(FetchDescriptor<Thought>())
    XCTAssertTrue(stored.isEmpty)
  }
}
