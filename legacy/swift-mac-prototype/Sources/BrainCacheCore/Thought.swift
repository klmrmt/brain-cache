import Foundation
import SwiftData

public enum ThoughtSource: String, Codable, CaseIterable, Sendable {
  case macPet
  case macLibrary
  case iPhone
  case lockScreenWidget
  case shareSheet
  case siri

  public var label: String {
    switch self {
    case .macPet: "Mac pet"
    case .macLibrary: "Mac library"
    case .iPhone: "iPhone"
    case .lockScreenWidget: "Lock Screen"
    case .shareSheet: "Share Sheet"
    case .siri: "Siri"
    }
  }
}

public enum ThoughtSyncState: String, Codable, CaseIterable, Sendable {
  case pending
  case synced
  case retrying
}

@Model
public final class Thought {
  public var id: UUID
  public var text: String
  public var createdAt: Date
  public var updatedAt: Date
  public var sourceValue: String
  public var syncStateValue: String
  public var isArchived: Bool

  public init(
    id: UUID = UUID(),
    text: String,
    createdAt: Date = .now,
    updatedAt: Date? = nil,
    source: ThoughtSource,
    syncState: ThoughtSyncState = .pending,
    isArchived: Bool = false
  ) {
    self.id = id
    self.text = text
    self.createdAt = createdAt
    self.updatedAt = updatedAt ?? createdAt
    self.sourceValue = source.rawValue
    self.syncStateValue = syncState.rawValue
    self.isArchived = isArchived
  }

  public var source: ThoughtSource {
    get { ThoughtSource(rawValue: sourceValue) ?? .macLibrary }
    set { sourceValue = newValue.rawValue }
  }

  public var syncState: ThoughtSyncState {
    get { ThoughtSyncState(rawValue: syncStateValue) ?? .pending }
    set { syncStateValue = newValue.rawValue }
  }
}
