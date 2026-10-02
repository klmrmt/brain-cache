import Foundation

enum CaptureDeepLink {
    static let captureURL = URL(string: "braincache://capture")!

    static func matches(_ url: URL) -> Bool {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.caseInsensitiveCompare("braincache") == .orderedSame,
              components.percentEncodedHost?.caseInsensitiveCompare("capture") == .orderedSame else {
            return false
        }

        return components.user == nil
            && components.password == nil
            && components.port == nil
            && components.path.isEmpty
            && components.query == nil
            && components.fragment == nil
    }
}
