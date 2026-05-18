import XCTest
@testable import CoreCommon

/// Phase 6.10 — `UpdateChecker` semver 比较 + App Store Lookup 解码测试。
///
/// **mock URLSession**：用 URLProtocol stub 拦截 itunes.apple.com/lookup 请求。
final class UpdateCheckerTests: XCTestCase {

    // MARK: - Semver compare unit tests

    func testCompareSemverEqualsSame() {
        XCTAssertEqual(UpdateChecker.compareSemver(local: "5.0.3", remote: "5.0.3"), .same)
        XCTAssertEqual(UpdateChecker.compareSemver(local: "1.0", remote: "1.0.0"), .same)
    }

    func testCompareSemverLocalSmaller() {
        XCTAssertEqual(UpdateChecker.compareSemver(local: "5.0.3", remote: "5.0.4"), .ascending)
        XCTAssertEqual(UpdateChecker.compareSemver(local: "5.0.3", remote: "5.1.0"), .ascending)
        XCTAssertEqual(UpdateChecker.compareSemver(local: "4.9.9", remote: "5.0.0"), .ascending)
        // 多段 vs 少段：1.0 < 1.0.1
        XCTAssertEqual(UpdateChecker.compareSemver(local: "1.0", remote: "1.0.1"), .ascending)
    }

    func testCompareSemverLocalBigger() {
        XCTAssertEqual(UpdateChecker.compareSemver(local: "5.0.4", remote: "5.0.3"), .descending)
        XCTAssertEqual(UpdateChecker.compareSemver(local: "6.0.0", remote: "5.99.99"), .descending)
    }

    func testCompareSemverHandlesNonNumeric() {
        // 非数字段视为 0
        XCTAssertEqual(UpdateChecker.compareSemver(local: "5.0.beta", remote: "5.0.0"), .same)
        XCTAssertEqual(UpdateChecker.compareSemver(local: "5.0.0", remote: "5.0.x"), .same)
    }

    // MARK: - End-to-end check via mock URLSession

    func testCheckReturnsAvailableWhenRemoteNewer() async throws {
        let session = mockSession(json: """
        {
            "resultCount": 1,
            "results": [{
                "version": "5.0.5",
                "trackViewUrl": "https://apps.apple.com/app/id1234567890"
            }]
        }
        """)
        let checker = UpdateChecker(
            urlSession: session,
            bundleIdProvider: { "com.chainlesschain.ChainlessChain" },
            localVersionProvider: { "5.0.3" }
        )
        let result = await checker.check()
        if case .available(let v, let url) = result {
            XCTAssertEqual(v, "5.0.5")
            XCTAssertEqual(url, "https://apps.apple.com/app/id1234567890")
        } else {
            XCTFail("Expected .available, got \(result)")
        }
    }

    func testCheckReturnsUpToDateWhenSame() async throws {
        let session = mockSession(json: """
        {"resultCount": 1, "results": [{"version": "5.0.3"}]}
        """)
        let checker = UpdateChecker(
            urlSession: session,
            bundleIdProvider: { "com.chainlesschain.ChainlessChain" },
            localVersionProvider: { "5.0.3" }
        )
        let result = await checker.check()
        XCTAssertEqual(result, .upToDate)
    }

    func testCheckReturnsUpToDateWhenLocalNewer() async throws {
        let session = mockSession(json: """
        {"resultCount": 1, "results": [{"version": "5.0.3"}]}
        """)
        let checker = UpdateChecker(
            urlSession: session,
            bundleIdProvider: { "com.chainlesschain.ChainlessChain" },
            localVersionProvider: { "5.0.5" }  // TestFlight 用户可能本地比 App Store 新
        )
        let result = await checker.check()
        XCTAssertEqual(result, .upToDate)
    }

    func testCheckReturnsNotListedWhenEmpty() async throws {
        let session = mockSession(json: """
        {"resultCount": 0, "results": []}
        """)
        let checker = UpdateChecker(
            urlSession: session,
            bundleIdProvider: { "com.chainlesschain.ChainlessChain" },
            localVersionProvider: { "5.0.3" }
        )
        let result = await checker.check()
        XCTAssertEqual(result, .notListed)
    }

    func testCheckReturnsNotListedOnHttpError() async throws {
        let session = mockSession(json: "{}", statusCode: 500)
        let checker = UpdateChecker(
            urlSession: session,
            bundleIdProvider: { "com.chainlesschain.ChainlessChain" },
            localVersionProvider: { "5.0.3" }
        )
        let result = await checker.check()
        XCTAssertEqual(result, .notListed)
    }

    func testCheckReturnsNotListedOnMalformedJson() async throws {
        let session = mockSession(json: "not-json")
        let checker = UpdateChecker(
            urlSession: session,
            bundleIdProvider: { "com.chainlesschain.ChainlessChain" },
            localVersionProvider: { "5.0.3" }
        )
        let result = await checker.check()
        XCTAssertEqual(result, .notListed)
    }

    func testCheckSendsBundleIdAndCountryQuery() async throws {
        MockURLProtocol.lastRequest = nil
        let session = mockSession(json: """
        {"resultCount": 0, "results": []}
        """)
        let checker = UpdateChecker(
            urlSession: session,
            bundleIdProvider: { "com.test.app" },
            localVersionProvider: { "1.0.0" },
            country: "jp"
        )
        _ = await checker.check()
        let url = MockURLProtocol.lastRequest?.url?.absoluteString ?? ""
        XCTAssertTrue(url.contains("bundleId=com.test.app"), "URL should contain bundleId param; got: \(url)")
        XCTAssertTrue(url.contains("country=jp"), "URL should contain country param; got: \(url)")
    }

    // MARK: - Mock URLSession helpers

    private func mockSession(json: String, statusCode: Int = 200) -> URLSession {
        MockURLProtocol.stubResponseJson = json
        MockURLProtocol.stubStatusCode = statusCode
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        return URLSession(configuration: config)
    }
}

/// URLProtocol stub — 让 URLSession 拦截走 in-memory 响应（不发真网络）。
final class MockURLProtocol: URLProtocol {
    nonisolated(unsafe) static var stubResponseJson: String = "{}"
    nonisolated(unsafe) static var stubStatusCode: Int = 200
    nonisolated(unsafe) static var lastRequest: URLRequest? = nil

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lastRequest = request
        let url = request.url!
        let response = HTTPURLResponse(
            url: url, statusCode: Self.stubStatusCode,
            httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if let data = Self.stubResponseJson.data(using: .utf8) {
            client?.urlProtocol(self, didLoad: data)
        }
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
