import Foundation
import Testing

@testable import BrainCache

struct CaptureDeepLinkTests {
    @Test(
        "The canonical capture URL is accepted without carrying thought data",
        arguments: [
            "braincache://capture",
            "BRAINCACHE://CAPTURE"
        ]
    )
    func acceptsCaptureURL(_ rawURL: String) throws {
        let url = try #require(URL(string: rawURL))
        #expect(CaptureDeepLink.matches(url))
    }

    @Test(
        "Only the exact non-mutating capture route is accepted",
        arguments: [
            "other://capture",
            "braincache://other",
            "braincache://capture/path",
            "braincache://capture/",
            "braincache://capture?",
            "braincache://capture?body=secret",
            "braincache://capture#",
            "braincache://capture#fragment",
            "braincache://user@capture",
            "braincache://capture:42",
            "braincache://%63apture",
            "braincache://capture.",
            "braincache:capture",
            "https://braincache/capture"
        ]
    )
    func rejectsUnexpectedURLShape(_ rawURL: String) throws {
        let url = try #require(URL(string: rawURL))
        #expect(!CaptureDeepLink.matches(url))
    }
}
