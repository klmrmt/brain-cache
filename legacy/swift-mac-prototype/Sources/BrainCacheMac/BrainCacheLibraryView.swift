import BrainCacheCore
import SwiftData
import SwiftUI

private enum LibraryFilter: String, CaseIterable, Identifiable {
  case all = "All thoughts"
  case today = "Today"
  case archived = "Archived"

  var id: Self { self }
}

struct BrainCacheLibraryView: View {
  @Environment(\.modelContext) private var modelContext
  @Query(sort: \Thought.createdAt, order: .reverse) private var thoughts: [Thought]

  @State private var filter: LibraryFilter = .all
  @State private var searchText = ""
  @State private var selectedThoughtID: UUID?
  @State private var archiveError: String?

  private var visibleThoughts: [Thought] {
    thoughts.filter { thought in
      let matchesFilter: Bool
      switch filter {
      case .all:
        matchesFilter = !thought.isArchived
      case .today:
        matchesFilter = !thought.isArchived && Calendar.current.isDateInToday(thought.createdAt)
      case .archived:
        matchesFilter = thought.isArchived
      }

      let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
      let searchableText = [
        thought.text,
        thought.source.label,
        thought.createdAt.formatted(date: .abbreviated, time: .shortened),
        thought.createdAt.formatted(date: .numeric, time: .omitted),
      ].joined(separator: " ")
      return matchesFilter
        && (query.isEmpty || searchableText.localizedCaseInsensitiveContains(query))
    }
  }

  private var selectedThought: Thought? {
    guard let selectedThoughtID else { return visibleThoughts.first }
    return visibleThoughts.first { $0.id == selectedThoughtID } ?? visibleThoughts.first
  }

  var body: some View {
    HStack(spacing: 0) {
      sidebar
        .frame(width: 196)

      Divider()
        .overlay(BrainCacheColors.border)

      library
        .frame(minWidth: 460, maxWidth: .infinity)

      Divider()
        .overlay(BrainCacheColors.border)

      inspector
        .frame(width: 280)
    }
    .frame(minWidth: 940, minHeight: 620)
    .background(BrainCacheColors.ink)
    .foregroundStyle(BrainCacheColors.paper)
    .preferredColorScheme(.dark)
    .onAppear(perform: selectFirstVisibleThought)
    .onChange(of: visibleThoughts.map(\.id)) {
      selectFirstVisibleThought()
    }
    .alert(
      "That change was not saved",
      isPresented: Binding(
        get: { archiveError != nil },
        set: { if !$0 { archiveError = nil } }
      )
    ) {
      Button("OK", role: .cancel) {}
    } message: {
      Text(archiveError ?? "Brain Cache could not update the local library.")
    }
  }

  private var sidebar: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("Brain Cache")
        .brainCacheFont(22, weight: .medium)
        .padding(.horizontal, 20)
        .padding(.top, 23)
        .padding(.bottom, 28)

      Text("LIBRARY")
        .brainCacheFont(9, weight: .semibold)
        .tracking(1.3)
        .foregroundStyle(BrainCacheColors.subtle)
        .padding(.horizontal, 20)
        .padding(.bottom, 8)

      ForEach(LibraryFilter.allCases) { item in
        Button {
          filter = item
          selectedThoughtID = nil
        } label: {
          HStack {
            Text(item.rawValue)
            Spacer()
            Text(count(for: item), format: .number)
              .foregroundStyle(BrainCacheColors.subtle)
          }
          .brainCacheFont(11, weight: .medium)
          .padding(.horizontal, 11)
          .frame(height: 34)
          .background(filter == item ? BrainCacheColors.signal.opacity(0.12) : .clear)
          .clipShape(RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
        .foregroundStyle(filter == item ? BrainCacheColors.paper : BrainCacheColors.muted)
        .padding(.horizontal, 9)
      }

      Spacer()

      HStack(spacing: 7) {
        Circle()
          .fill(BrainCacheColors.saved)
          .frame(width: 6, height: 6)
        Text("LOCAL FIRST")
          .brainCacheFont(9, weight: .medium)
          .tracking(1)
          .foregroundStyle(BrainCacheColors.muted)
      }
      .padding(20)
    }
    .background(BrainCacheColors.surface)
  }

  private var library: some View {
    VStack(spacing: 0) {
      HStack(spacing: 10) {
        HStack(spacing: 9) {
          Image(systemName: "magnifyingglass")
            .foregroundStyle(BrainCacheColors.muted)
          TextField("Search a word or date…", text: $searchText)
            .textFieldStyle(.plain)
            .brainCacheFont(12)
        }
        .padding(.horizontal, 12)
        .frame(height: 38)
        .background(BrainCacheColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay {
          RoundedRectangle(cornerRadius: 8)
            .stroke(BrainCacheColors.border, lineWidth: 1)
        }

        Button {
          BrainCacheRuntime.shared.showCapture()
        } label: {
          Image(systemName: "plus")
            .frame(width: 38, height: 38)
        }
        .buttonStyle(.plain)
        .background(BrainCacheColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay {
          RoundedRectangle(cornerRadius: 8)
            .stroke(BrainCacheColors.border, lineWidth: 1)
        }
        .help("Capture a thought (⌥ Space)")
      }
      .padding(.horizontal, 22)
      .padding(.top, 20)

      HStack(alignment: .firstTextBaseline) {
        Text(filter.rawValue)
          .brainCacheFont(24, weight: .medium)
        Spacer()
        Text("NEWEST FIRST")
          .brainCacheFont(9, weight: .medium)
          .tracking(1)
          .foregroundStyle(BrainCacheColors.subtle)
      }
      .padding(.horizontal, 22)
      .padding(.top, 18)
      .padding(.bottom, 14)

      if visibleThoughts.isEmpty {
        emptyState
      } else {
        ScrollView {
          LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 220), spacing: 12)],
            spacing: 12
          ) {
            ForEach(visibleThoughts) { thought in
              ThoughtCard(
                thought: thought,
                isSelected: selectedThought?.id == thought.id
              )
              .onTapGesture {
                selectedThoughtID = thought.id
              }
            }
          }
          .padding(.horizontal, 22)
          .padding(.bottom, 22)
        }
      }
    }
  }

  private var emptyState: some View {
    VStack(spacing: 13) {
      Spacer()
      PetMark()
        .frame(width: 72, height: 63)
      Text(searchText.isEmpty ? "Nothing here yet." : "No thought matches that search.")
        .brainCacheFont(16, weight: .medium)
      Text(searchText.isEmpty ? "Press ⌥ Space and catch the first one." : "Try a different word.")
        .brainCacheFont(11)
        .foregroundStyle(BrainCacheColors.muted)
      Spacer()
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  @ViewBuilder
  private var inspector: some View {
    if let thought = selectedThought {
      VStack(alignment: .leading, spacing: 0) {
        Text("SELECTED THOUGHT")
          .brainCacheFont(9, weight: .semibold)
          .tracking(1.2)
          .foregroundStyle(BrainCacheColors.subtle)

        Text(thought.text)
          .brainCacheFont(20, weight: .medium)
          .lineSpacing(5)
          .padding(.top, 14)

        metadataRow(
          "CREATED", value: thought.createdAt.formatted(date: .abbreviated, time: .shortened)
        )
        .padding(.top, 24)
        metadataRow("SOURCE", value: thought.source.label)
        metadataRow(
          "STATE",
          value: thought.syncState == .pending
            ? "Saved locally" : thought.syncState.rawValue.capitalized)

        Spacer()

        Button(thought.isArchived ? "Restore" : "Archive") {
          let priorValue = thought.isArchived
          let priorUpdatedAt = thought.updatedAt
          thought.isArchived.toggle()
          thought.updatedAt = .now
          do {
            try modelContext.save()
            selectedThoughtID = nil
          } catch {
            thought.isArchived = priorValue
            thought.updatedAt = priorUpdatedAt
            archiveError = error.localizedDescription
          }
        }
        .buttonStyle(.plain)
        .brainCacheFont(11, weight: .medium)
        .padding(.horizontal, 12)
        .frame(height: 34)
        .background(BrainCacheColors.paper)
        .foregroundStyle(BrainCacheColors.ink)
        .clipShape(RoundedRectangle(cornerRadius: 7))
      }
      .padding(20)
      .background(BrainCacheColors.surface)
    } else {
      VStack {
        Spacer()
        Text("SELECT A THOUGHT")
          .brainCacheFont(9, weight: .medium)
          .tracking(1.1)
          .foregroundStyle(BrainCacheColors.subtle)
        Spacer()
      }
      .frame(maxWidth: .infinity)
      .background(BrainCacheColors.surface)
    }
  }

  private func metadataRow(_ label: String, value: String) -> some View {
    HStack(alignment: .top, spacing: 8) {
      Text(label)
        .foregroundStyle(BrainCacheColors.subtle)
        .frame(width: 62, alignment: .leading)
      Text(value)
        .foregroundStyle(BrainCacheColors.muted)
    }
    .brainCacheFont(9, weight: .medium)
    .padding(.vertical, 10)
    .overlay(alignment: .top) {
      Rectangle()
        .fill(BrainCacheColors.border)
        .frame(height: 1)
    }
  }

  private func count(for item: LibraryFilter) -> Int {
    switch item {
    case .all:
      thoughts.count { !$0.isArchived }
    case .today:
      thoughts.count { !$0.isArchived && Calendar.current.isDateInToday($0.createdAt) }
    case .archived:
      thoughts.count { $0.isArchived }
    }
  }

  private func selectFirstVisibleThought() {
    guard !visibleThoughts.contains(where: { $0.id == selectedThoughtID }) else { return }
    selectedThoughtID = visibleThoughts.first?.id
  }
}

private struct ThoughtCard: View {
  let thought: Thought
  let isSelected: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        Text(thought.createdAt.formatted(date: .abbreviated, time: .shortened).uppercased())
        Spacer()
        Text("⌁")
      }
      .brainCacheFont(9, weight: .medium)
      .foregroundStyle(BrainCacheColors.subtle)

      Text(thought.text)
        .brainCacheFont(14)
        .lineSpacing(4)
        .lineLimit(5)
        .padding(.top, 13)

      Spacer(minLength: 16)

      Text(thought.source.label.uppercased())
        .brainCacheFont(8, weight: .medium)
        .tracking(0.8)
        .foregroundStyle(
          thought.source == .macPet ? BrainCacheColors.signal : BrainCacheColors.muted)
    }
    .padding(15)
    .frame(maxWidth: .infinity, minHeight: 148, alignment: .topLeading)
    .background(BrainCacheColors.raised)
    .clipShape(RoundedRectangle(cornerRadius: 10))
    .overlay {
      RoundedRectangle(cornerRadius: 10)
        .stroke(
          isSelected ? BrainCacheColors.signal.opacity(0.7) : BrainCacheColors.border, lineWidth: 1)
    }
    .overlay(alignment: .leading) {
      if isSelected {
        Rectangle()
          .fill(BrainCacheColors.signal)
          .frame(width: 3)
          .padding(.vertical, 9)
      }
    }
    .contentShape(Rectangle())
  }
}

private struct PetMark: View {
  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: 25)
        .fill(BrainCacheColors.raised)
        .overlay {
          RoundedRectangle(cornerRadius: 25)
            .stroke(BrainCacheColors.strongBorder, lineWidth: 1)
        }
      HStack(spacing: 20) {
        Capsule().fill(BrainCacheColors.paper).frame(width: 7, height: 10)
        Capsule().fill(BrainCacheColors.paper).frame(width: 7, height: 10)
      }
      .offset(y: -5)
      Capsule()
        .stroke(BrainCacheColors.muted, lineWidth: 1)
        .frame(width: 12, height: 4)
        .offset(y: 15)
    }
  }
}
