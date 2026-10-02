@preconcurrency import UIKit
@preconcurrency import UniformTypeIdentifiers

@MainActor
final class ShareViewController: UIViewController, UITextViewDelegate {
    private let scrollView = UIScrollView()
    private let header = UIStackView()
    private let titleLabel = UILabel()
    private let editor = UITextView()
    private let saveButton = UIButton(type: .system)
    private let cancelButton = UIButton(type: .system)
    private let statusLabel = UILabel()

    private let operation = ShareCaptureOperation(
        store: FileThoughtStore.shareExtensionStore()
    )
    private var preparedAttempt: CaptureAttempt?
    private var isSaving = false

    override func viewDidLoad() {
        super.viewDidLoad()
        configureView()
        loadSharedItem()
    }

    private func configureView() {
        view.backgroundColor = UIColor(red: 7 / 255, green: 7 / 255, blue: 6 / 255, alpha: 1)

        titleLabel.text = "DUMP TO CACHE"
        titleLabel.textColor = UIColor(red: 242 / 255, green: 184 / 255, blue: 75 / 255, alpha: 1)
        titleLabel.textAlignment = .center
        titleLabel.accessibilityTraits = .header

        cancelButton.setTitle("CANCEL", for: .normal)
        cancelButton.tintColor = UIColor(red: 145 / 255, green: 141 / 255, blue: 131 / 255, alpha: 1)
        cancelButton.addTarget(self, action: #selector(cancel), for: .touchUpInside)

        var saveConfiguration = UIButton.Configuration.filled()
        saveConfiguration.title = "CACHE IT"
        saveConfiguration.baseBackgroundColor = UIColor(red: 243 / 255, green: 240 / 255, blue: 231 / 255, alpha: 1)
        saveConfiguration.baseForegroundColor = UIColor(red: 7 / 255, green: 7 / 255, blue: 6 / 255, alpha: 1)
        saveConfiguration.cornerStyle = .medium
        saveConfiguration.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 18, bottom: 12, trailing: 18)
        saveButton.configuration = saveConfiguration
        saveButton.addTarget(self, action: #selector(save), for: .touchUpInside)
        saveButton.isEnabled = false

        header.addArrangedSubview(cancelButton)
        header.addArrangedSubview(titleLabel)
        header.addArrangedSubview(saveButton)
        header.spacing = 12
        titleLabel.setContentHuggingPriority(.defaultLow, for: .horizontal)

        editor.delegate = self
        editor.backgroundColor = UIColor(red: 24 / 255, green: 24 / 255, blue: 22 / 255, alpha: 1)
        editor.textColor = UIColor(red: 243 / 255, green: 240 / 255, blue: 231 / 255, alpha: 1)
        editor.tintColor = UIColor(red: 242 / 255, green: 184 / 255, blue: 75 / 255, alpha: 1)
        editor.layer.cornerRadius = 14
        editor.layer.borderColor = UIColor(red: 71 / 255, green: 68 / 255, blue: 61 / 255, alpha: 1).cgColor
        editor.layer.borderWidth = 1
        editor.textContainerInset = UIEdgeInsets(top: 14, left: 12, bottom: 14, right: 12)
        editor.accessibilityLabel = "Shared thought"

        statusLabel.text = "LOADING SHARED ITEM…"
        statusLabel.textColor = UIColor(red: 145 / 255, green: 141 / 255, blue: 131 / 255, alpha: 1)
        statusLabel.numberOfLines = 0

        let stack = UIStackView(arrangedSubviews: [header, editor, statusLabel])
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.keyboardDismissMode = .interactive
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scrollView)
        scrollView.addSubview(stack)

        updateTypography()
        updateHeaderLayout()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(contentSizeCategoryDidChange),
            name: UIContentSizeCategory.didChangeNotification,
            object: nil
        )

        NSLayoutConstraint.activate([
            cancelButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 44),
            cancelButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            saveButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            scrollView.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            stack.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 16),
            stack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -16),
            stack.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor, constant: -40),
            editor.heightAnchor.constraint(greaterThanOrEqualToConstant: 180)
        ])
    }

    @objc private func contentSizeCategoryDidChange() {
        updateTypography()
        updateHeaderLayout()
    }

    private func updateTypography() {
        titleLabel.font = scaledMonospacedFont(size: 11, weight: .semibold, textStyle: .caption1)
        titleLabel.adjustsFontForContentSizeCategory = true
        cancelButton.titleLabel?.font = scaledMonospacedFont(size: 11, weight: .semibold, textStyle: .caption1)
        cancelButton.titleLabel?.adjustsFontForContentSizeCategory = true
        editor.font = scaledMonospacedFont(size: 16, weight: .regular, textStyle: .body)
        editor.adjustsFontForContentSizeCategory = true
        statusLabel.font = scaledMonospacedFont(size: 10, weight: .semibold, textStyle: .caption2)
        statusLabel.adjustsFontForContentSizeCategory = true

        var configuration = saveButton.configuration
        configuration?.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = UIFontMetrics(forTextStyle: .callout).scaledFont(
                for: .monospacedSystemFont(ofSize: 12, weight: .bold)
            )
            return outgoing
        }
        saveButton.configuration = configuration
        saveButton.titleLabel?.adjustsFontForContentSizeCategory = true
    }

    private func updateHeaderLayout() {
        let usesAccessibilityLayout = traitCollection.preferredContentSizeCategory.isAccessibilityCategory
        header.axis = usesAccessibilityLayout ? .vertical : .horizontal
        header.alignment = usesAccessibilityLayout ? .fill : .center
    }

    private func scaledMonospacedFont(
        size: CGFloat,
        weight: UIFont.Weight,
        textStyle: UIFont.TextStyle
    ) -> UIFont {
        UIFontMetrics(forTextStyle: textStyle).scaledFont(
            for: .monospacedSystemFont(ofSize: size, weight: weight)
        )
    }

    private func loadSharedItem() {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
            .flatMap { $0.attachments ?? [] }

        guard providers.count == 1, let provider = providers.first else {
            show(
                providers.isEmpty ? ShareCaptureError.empty : ShareCaptureError.multipleItems
            )
            return
        }

        let representation = ShareItemRepresentationClassifier.classify(
            canLoadURL: provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
            canLoadText: provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier)
        )
        switch representation {
        case .url:
            provider.loadItem(forTypeIdentifier: UTType.url.identifier) { [weak self] item, error in
                let result = Self.loadedURL(item, error: error)
                DispatchQueue.main.async {
                    self?.finishLoading(result)
                }
            }
        case .text:
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { [weak self] item, error in
                let result = Self.loadedText(item, error: error)
                DispatchQueue.main.async {
                    self?.finishLoading(result)
                }
            }
        case .unsupported:
            show(ShareCaptureError.unsupported)
        }
    }

    nonisolated private static func loadedURL(
        _ item: NSSecureCoding?,
        error: Error?
    ) -> Result<SharedItem, ShareCaptureError> {
        guard error == nil else { return .failure(.unsupported) }
        let url: URL?
        if let value = item as? URL {
            url = value
        } else if let value = item as? NSURL {
            url = value as URL
        } else if let value = item as? String {
            url = URL(string: value)
        } else {
            url = nil
        }

        guard let url else { return .failure(.unsupported) }
        return .success(.url(url))
    }

    nonisolated private static func loadedText(
        _ item: NSSecureCoding?,
        error: Error?
    ) -> Result<SharedItem, ShareCaptureError> {
        guard error == nil, let text = item as? String else {
            return .failure(.unsupported)
        }
        return .success(.text(text))
    }

    private func finishLoading(_ result: Result<SharedItem, ShareCaptureError>) {
        switch result {
        case let .success(item):
            finishLoading(item)
        case let .failure(error):
            show(error)
        }
    }

    private func finishLoading(_ item: SharedItem) {
        do {
            editor.text = try ShareItemParser.editableBody(from: [item])
            updateStatus(
                "REVIEW OR ADD A NOTE, THEN SAVE LOCALLY.",
                color: UIColor(red: 145 / 255, green: 141 / 255, blue: 131 / 255, alpha: 1),
                announce: true
            )
            saveButton.isEnabled = true
            editor.becomeFirstResponder()
        } catch {
            show(error)
        }
    }

    func textViewDidChange(_ textView: UITextView) {
        preparedAttempt = nil
        saveButton.isEnabled = !CaptureOperation.normalize(textView.text).isEmpty && !isSaving
    }

    @objc private func save() {
        guard !isSaving else { return }

        let attempt: CaptureAttempt
        do {
            attempt = try preparedAttempt ?? operation.prepare(editor.text)
            preparedAttempt = attempt
        } catch {
            show(error)
            return
        }

        // Once Save begins the attempt is durable intent: the editor and Cancel
        // stay locked, and every retry reuses this UUID, timestamp, and body.
        isSaving = true
        editor.isEditable = false
        editor.resignFirstResponder()
        cancelButton.isEnabled = false
        saveButton.isEnabled = false
        setSaveButtonTitle("CACHE IT")
        updateStatus(
            "WRITING LOCALLY…",
            color: UIColor(red: 242 / 255, green: 184 / 255, blue: 75 / 255, alpha: 1),
            announce: true
        )

        Task {
            do {
                _ = try await operation.save(attempt)
                updateStatus(
                    "SAVED LOCALLY",
                    color: UIColor(red: 112 / 255, green: 201 / 255, blue: 151 / 255, alpha: 1),
                    announce: true
                )
                if UIAccessibility.isVoiceOverRunning {
                    try? await Task.sleep(for: .milliseconds(800))
                }
                extensionContext?.completeRequest(returningItems: nil)
            } catch {
                isSaving = false
                setSaveButtonTitle("TRY AGAIN")
                saveButton.isEnabled = true
                show(error)
            }
        }
    }

    @objc private func cancel() {
        let error = NSError(
            domain: NSCocoaErrorDomain,
            code: NSUserCancelledError,
            userInfo: nil
        )
        extensionContext?.cancelRequest(withError: error)
    }

    private func show(_ error: Error) {
        let message = (error as? LocalizedError)?.errorDescription?.uppercased()
            ?? "BRAIN CACHE COULD NOT SAVE THIS ITEM."
        updateStatus(
            message,
            color: UIColor(red: 229 / 255, green: 110 / 255, blue: 104 / 255, alpha: 1),
            announce: true
        )
        if preparedAttempt == nil {
            saveButton.isEnabled = !CaptureOperation.normalize(editor.text).isEmpty && !isSaving
        }
    }

    private func updateStatus(_ message: String, color: UIColor, announce: Bool) {
        statusLabel.text = message
        statusLabel.textColor = color
        guard announce else { return }

        view.layoutIfNeeded()
        let statusRect = statusLabel.convert(statusLabel.bounds, to: scrollView)
        scrollView.scrollRectToVisible(statusRect, animated: true)
        UIAccessibility.post(notification: .announcement, argument: message)
    }

    private func setSaveButtonTitle(_ title: String) {
        var configuration = saveButton.configuration
        configuration?.title = title
        saveButton.configuration = configuration
    }
}
