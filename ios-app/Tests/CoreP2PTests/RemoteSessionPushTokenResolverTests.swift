import XCTest
@testable import CoreP2P

/// Covers the iOS multi-provider push-token resolution used at pair time: first
/// non-blank token wins, nil/blank providers are skipped, an all-unavailable set
/// resolves to nil (host → relay + local notifications), plus the APNs provider's
/// tag + blank/nil normalization. Mirrors the Android
/// `RemoteSessionPushTokenResolverTest`.
final class RemoteSessionPushTokenResolverTests: XCTestCase {

    private struct StubProvider: RemoteSessionPushTokenProvider {
        let provider: String
        let value: String?
        func token() async -> String? { value }
    }

    // MARK: Resolver ordering

    func testReturnsFirstProviderThatYieldsAToken() async {
        let resolver = RemoteSessionPushTokenResolver(providers: [
            StubProvider(provider: "apns", value: "apns-tok"),
            StubProvider(provider: "voip", value: "voip-tok"),
        ])
        let resolved = await resolver.resolve()
        XCTAssertEqual(resolved?.token, "apns-tok")
        XCTAssertEqual(resolved?.provider, "apns")
    }

    func testFallsThroughWhenEarlierProviderUnavailable() async {
        let resolver = RemoteSessionPushTokenResolver(providers: [
            StubProvider(provider: "apns", value: nil),
            StubProvider(provider: "voip", value: "voip-tok"),
        ])
        let resolved = await resolver.resolve()
        XCTAssertEqual(resolved?.provider, "voip")
    }

    func testBlankTokenTreatedAsUnavailableAndKeepsLooking() async {
        let resolver = RemoteSessionPushTokenResolver(providers: [
            StubProvider(provider: "apns", value: "   "),
            StubProvider(provider: "voip", value: "voip-tok"),
        ])
        let resolved = await resolver.resolve()
        XCTAssertEqual(resolved?.provider, "voip")
    }

    func testResolvesNilWhenEveryProviderUnavailable() async {
        let resolver = RemoteSessionPushTokenResolver(providers: [
            StubProvider(provider: "apns", value: nil),
            StubProvider(provider: "voip", value: nil),
        ])
        let resolved = await resolver.resolve()
        XCTAssertNil(resolved)
    }

    func testResolvesNilForEmptyProviderList() async {
        let resolver = RemoteSessionPushTokenResolver(providers: [])
        let resolved = await resolver.resolve()
        XCTAssertNil(resolved)
    }

    // MARK: APNsPushTokenProvider

    func testApnsProviderExposesTagAndReadsSource() async {
        let provider = APNsPushTokenProvider(source: { "device-apns-token" })
        XCTAssertEqual(provider.provider, "apns")
        let token = await provider.token()
        XCTAssertEqual(token, "device-apns-token")
    }

    func testApnsProviderTreatsBlankAndNilAsNil() async {
        let blank = APNsPushTokenProvider(source: { "   " })
        let nilSource = APNsPushTokenProvider(source: { nil })
        let blankToken = await blank.token()
        let nilToken = await nilSource.token()
        XCTAssertNil(blankToken)
        XCTAssertNil(nilToken)
    }

    func testApnsProviderResolvesEndToEndThroughResolver() async {
        let resolver = RemoteSessionPushTokenResolver(providers: [
            APNsPushTokenProvider(source: { "apns-e2e" }),
        ])
        let resolved = await resolver.resolve()
        XCTAssertEqual(resolved?.token, "apns-e2e")
        XCTAssertEqual(resolved?.provider, "apns")
    }
}
