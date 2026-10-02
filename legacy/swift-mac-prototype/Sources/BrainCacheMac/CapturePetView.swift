import SwiftUI

struct CapturePetView: View {
  let onSave: (String) throws -> Void
  let onDismiss: () -> Void

  @State private var text = ""
  @State private var errorMessage: String?
  @State private var isSaving = false
  @FocusState private var isFocused: Bool

  var body: some View {
    VStack(spacing: 9) {
      HStack(spacing: 12) {
        PetGlyph(isSaving: isSaving)

        VStack(alignment: .leading, spacing: 4) {
          Text(errorMessage ?? "I'M LISTENING")
            .brainCacheFont(9, weight: .semibold)
            .tracking(1.2)
            .foregroundStyle(errorMessage == nil ? BrainCacheColors.signal : BrainCacheColors.error)

          TextField("Type anything in your head…", text: $text)
            .textFieldStyle(.plain)
            .brainCacheFont(14)
            .foregroundStyle(BrainCacheColors.paper)
            .focused($isFocused)
            .onSubmit(save)
        }

        Button(action: save) {
          Image(systemName: "return")
            .font(.system(size: 13, weight: .semibold))
            .frame(width: 38, height: 38)
            .foregroundStyle(BrainCacheColors.ink)
            .background(BrainCacheColors.paper)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Save thought")
      }

      HStack {
        Text("#tag  /find  /remind")
        Spacer()
        Text("return to save  ·  esc to close")
      }
      .brainCacheFont(9)
      .foregroundStyle(BrainCacheColors.subtle)
      .padding(.leading, 70)
    }
    .padding(12)
    .background(.ultraThinMaterial)
    .background(BrainCacheColors.raised.opacity(0.92))
    .clipShape(RoundedRectangle(cornerRadius: 14))
    .overlay {
      RoundedRectangle(cornerRadius: 14)
        .stroke(BrainCacheColors.strongBorder, lineWidth: 1)
    }
    .preferredColorScheme(.dark)
    .onAppear { isFocused = true }
    .onExitCommand(perform: onDismiss)
  }

  private func save() {
    do {
      isSaving = true
      try onSave(text)
      text = ""
      errorMessage = nil
    } catch {
      isSaving = false
      errorMessage = error.localizedDescription.uppercased()
    }
  }
}

private struct PetGlyph: View {
  let isSaving: Bool

  var body: some View {
    ZStack {
      UnevenRoundedRectangle(
        topLeadingRadius: 22,
        bottomLeadingRadius: 19,
        bottomTrailingRadius: 22,
        topTrailingRadius: 25
      )
      .fill(BrainCacheColors.ink)
      .overlay {
        UnevenRoundedRectangle(
          topLeadingRadius: 22,
          bottomLeadingRadius: 19,
          bottomTrailingRadius: 22,
          topTrailingRadius: 25
        )
        .stroke(BrainCacheColors.strongBorder, lineWidth: 1)
      }

      HStack(spacing: 17) {
        Capsule()
          .fill(BrainCacheColors.paper)
          .frame(width: 6, height: isSaving ? 3 : 8)
        Capsule()
          .fill(BrainCacheColors.paper)
          .frame(width: 6, height: isSaving ? 3 : 8)
      }
      .offset(y: -4)

      Capsule()
        .stroke(isSaving ? BrainCacheColors.signal : BrainCacheColors.muted, lineWidth: 1)
        .frame(width: 10, height: isSaving ? 10 : 3)
        .offset(y: 13)
    }
    .frame(width: 56, height: 49)
    .scaleEffect(isSaving ? CGSize(width: 1.06, height: 0.94) : CGSize(width: 1, height: 1))
    .animation(.easeOut(duration: 0.16), value: isSaving)
  }
}
