import Accessibility
import SwiftUI

struct CaptureView: View {
    @ObservedObject var model: CaptureViewModel

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @FocusState private var captureIsFocused: Bool

    var body: some View {
        ZStack {
            BrainCacheTheme.ink
                .ignoresSafeArea()
            QuietGrid()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    capturePanel
                    recovery
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 92)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            primaryAction
        }
        .preferredColorScheme(.dark)
        .tint(BrainCacheTheme.signal)
        .task {
            await Task.yield()
            captureIsFocused = true
            await model.loadRecoveryIfNeeded()
        }
        .onChange(of: model.focusRequest) {
            captureIsFocused = true
        }
        .onChange(of: model.saveState) { _, newState in
            announce(newState)
        }
        .animation(
            reduceMotion ? nil : .easeOut(duration: 0.15),
            value: model.saveState
        )
    }

    private var header: some View {
        HStack(spacing: 10) {
            PassiveBlob()
            Text("BRAIN CACHE")
                .brainCacheLabel(size: 11)
                .tracking(1.3)
                .foregroundStyle(BrainCacheTheme.paper)
            Spacer()
            Text("IPHONE")
                .brainCacheLabel(size: 9)
                .tracking(1)
                .foregroundStyle(BrainCacheTheme.subtle)
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Brain Cache for iPhone")
    }

    private var capturePanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("DUMP TO CACHE")
                .brainCacheLabel()
                .tracking(1.15)
                .foregroundStyle(BrainCacheTheme.signal)

            ZStack(alignment: .topLeading) {
                if model.draft.isEmpty {
                    Text("What’s taking up space in your head?")
                        .font(.system(.body, design: .monospaced))
                        .foregroundStyle(BrainCacheTheme.subtle)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 8)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }

                TextEditor(
                    text: Binding(
                        get: { model.draft },
                        set: { model.updateDraft($0) }
                    )
                )
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(BrainCacheTheme.paper)
                .scrollContentBackground(.hidden)
                .background(.clear)
                .frame(minHeight: 176)
                .focused($captureIsFocused)
                .accessibilityLabel("Thought")
                .accessibilityHint("Type a thought. Return inserts a new line.")
                .accessibilityIdentifier("capture.editor")
            }

            status
        }
        .padding(16)
        .background(BrainCacheTheme.raised)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(
                    captureIsFocused ? BrainCacheTheme.strongBorder : BrainCacheTheme.border,
                    lineWidth: 1
                )
        }
    }

    @ViewBuilder
    private var status: some View {
        HStack(alignment: .top, spacing: 10) {
            statusGlyph
                .frame(width: 16, height: 16)
            Text(statusText)
                .brainCacheLabel(size: 10)
                .tracking(0.65)
                .foregroundStyle(statusColor)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .frame(minHeight: 44, alignment: .top)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(statusAccessibilityLabel)
        .accessibilityIdentifier("capture.status")
    }

    @ViewBuilder
    private var statusGlyph: some View {
        switch model.saveState {
        case .idle:
            Circle()
                .fill(BrainCacheTheme.muted)
                .frame(width: 5, height: 5)
                .padding(.top, 5)
        case .saving:
            ProgressView()
                .controlSize(.small)
                .tint(BrainCacheTheme.signal)
        case .saved:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(BrainCacheTheme.saved)
        case .emptyInput, .persistenceError:
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(BrainCacheTheme.error)
        }
    }

    private var statusText: String {
        switch model.saveState {
        case .idle:
            "LOCAL ONLY · SAVES WITHOUT NETWORK"
        case .saving:
            "WRITING LOCALLY…"
        case .saved:
            "SAVED LOCALLY"
        case .emptyInput:
            "GIVE BLOB SOMETHING TO REMEMBER."
        case .persistenceError:
            "COULDN’T SAVE LOCALLY. YOUR THOUGHT IS STILL HERE."
        }
    }

    private var statusAccessibilityLabel: String {
        switch model.saveState {
        case .idle:
            "Local only. Saves without network."
        case .saving:
            "Writing locally."
        case .saved:
            "Saved locally."
        case .emptyInput:
            "Give Blob something to remember."
        case .persistenceError:
            "Couldn’t save locally. Your thought is still here. Try again."
        }
    }

    private var statusColor: Color {
        switch model.saveState {
        case .idle:
            BrainCacheTheme.muted
        case .saving:
            BrainCacheTheme.signal
        case .saved:
            BrainCacheTheme.saved
        case .emptyInput, .persistenceError:
            BrainCacheTheme.error
        }
    }

    private var recovery: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("LAST SAVED ON THIS IPHONE")
                .brainCacheLabel()
                .tracking(1.15)
                .foregroundStyle(BrainCacheTheme.muted)

            Group {
                switch model.recoveryState {
                case .loading:
                    HStack(spacing: 10) {
                        ProgressView()
                            .controlSize(.small)
                            .tint(BrainCacheTheme.muted)
                        Text("READING LOCAL CACHE…")
                            .brainCacheLabel(size: 9)
                            .tracking(0.7)
                            .foregroundStyle(BrainCacheTheme.muted)
                    }
                    .frame(minHeight: 44)
                    .accessibilityLabel("Reading the local cache.")
                case .loaded(let thought):
                    if let thought {
                        recoveredThought(thought)
                    } else {
                        Text("NOTHING CACHED HERE YET.")
                            .brainCacheLabel(size: 9)
                            .tracking(0.7)
                            .foregroundStyle(BrainCacheTheme.subtle)
                            .frame(minHeight: 44, alignment: .leading)
                            .accessibilityLabel("Nothing cached here yet.")
                    }
                case .loadError:
                    VStack(alignment: .leading, spacing: 12) {
                        Text("COULDN’T READ THE LOCAL CACHE.")
                            .brainCacheLabel(size: 9)
                            .tracking(0.7)
                            .foregroundStyle(BrainCacheTheme.error)
                        Button("TRY LOADING AGAIN") {
                            Task { await model.loadRecovery() }
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .accessibilityIdentifier("recovery.retry")
                    }
                }
            }
        }
        .padding(16)
        .background(BrainCacheTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(BrainCacheTheme.border, lineWidth: 1)
        }
        .accessibilityIdentifier("recovery.card")
    }

    private func recoveredThought(_ thought: Thought) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(thought.body)
                .font(.system(.callout, design: .monospaced))
                .foregroundStyle(BrainCacheTheme.paper)
                .lineSpacing(4)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)

            Text("IPHONE · \(thought.createdAt.formatted(date: .abbreviated, time: .shortened))")
                .brainCacheLabel(size: 9)
                .tracking(0.6)
                .foregroundStyle(BrainCacheTheme.subtle)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "Last saved on this iPhone. \(thought.body). Saved \(thought.createdAt.formatted(date: .abbreviated, time: .shortened))."
        )
    }

    private var primaryAction: some View {
        Button {
            Task { await model.save() }
        } label: {
            Text(model.primaryActionLabel)
                .brainCacheLabel(size: 11)
                .tracking(1)
                .frame(maxWidth: .infinity, minHeight: 50)
        }
        .foregroundStyle(BrainCacheTheme.ink)
        .background(model.primaryActionDisabled ? BrainCacheTheme.muted : BrainCacheTheme.paper)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .disabled(model.primaryActionDisabled)
        .padding(.horizontal, 20)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(BrainCacheTheme.ink.opacity(0.98))
        .accessibilityHint(model.isRetryingSave ? "Retries the same local save." : "Saves this thought locally.")
        .accessibilityIdentifier("capture.save")
    }

    private func announce(_ state: CaptureSaveState) {
        switch state {
        case .saved, .emptyInput, .persistenceError:
            AccessibilityNotification.Announcement(statusAccessibilityLabel).post()
        case .idle, .saving:
            break
        }
    }
}

private struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .brainCacheLabel(size: 10)
            .tracking(0.75)
            .foregroundStyle(BrainCacheTheme.paper)
            .frame(minHeight: 44)
            .padding(.horizontal, 14)
            .background(configuration.isPressed ? BrainCacheTheme.raised : BrainCacheTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(BrainCacheTheme.strongBorder, lineWidth: 1)
            }
    }
}
