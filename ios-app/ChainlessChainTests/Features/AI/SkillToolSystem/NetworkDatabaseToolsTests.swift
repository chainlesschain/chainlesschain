/**
 * NetworkDatabaseToolsTests.swift
 *
 * Unit tests for NetworkDatabaseTools (15 tools).
 * Tests network tools (7) and database tools (8).
 */

import XCTest
import SQLite3
@testable import ChainlessChain

@MainActor
final class NetworkDatabaseToolsTests: XCTestCase {

    // MARK: - Properties

    var toolManager: ToolManager!
    var testDatabasePath: String!
    var tempDownloadPath: String!

    // MARK: - Setup & Teardown

    override func setUp() async throws {
        toolManager = ToolManager.shared
        toolManager.registerNetworkDatabaseTools()

        // Setup test paths
        let tempDir = NSTemporaryDirectory()
        testDatabasePath = tempDir + "test.db"
        tempDownloadPath = tempDir + "downloads/"

        // Create directories
        try? FileManager.default.createDirectory(atPath: tempDownloadPath, withIntermediateDirectories: true)

        // Create test database
        try createTestDatabase()
    }

    override func tearDown() async throws {
        // Clean up
        try? FileManager.default.removeItem(atPath: testDatabasePath)
        try? FileManager.default.removeItem(atPath: tempDownloadPath)

        toolManager = nil
    }

    // MARK: - Test Database Creation

    private func createTestDatabase() throws {
        var db: OpaquePointer?

        guard sqlite3_open(testDatabasePath, &db) == SQLITE_OK else {
            throw NSError(domain: "TestError", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot open database"])
        }

        defer {
            sqlite3_close(db)
        }

        // Create users table
        let createTableSQL = """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            age INTEGER,
            email TEXT
        );
        """

        var createStatement: OpaquePointer?
        if sqlite3_prepare_v2(db, createTableSQL, -1, &createStatement, nil) == SQLITE_OK {
            if sqlite3_step(createStatement) == SQLITE_DONE {
                // Success
            }
        }
        sqlite3_finalize(createStatement)

        // Insert test data
        let insertSQL = "INSERT INTO users (name, age, email) VALUES (?, ?, ?);"
        let testUsers = [
            ("Alice", 30, "alice@example.com"),
            ("Bob", 25, "bob@example.com"),
            ("Charlie", 35, "charlie@example.com")
        ]

        for user in testUsers {
            var insertStatement: OpaquePointer?
            if sqlite3_prepare_v2(db, insertSQL, -1, &insertStatement, nil) == SQLITE_OK {
                sqlite3_bind_text(insertStatement, 1, (user.0 as NSString).utf8String, -1, nil)
                sqlite3_bind_int(insertStatement, 2, Int32(user.1))
                sqlite3_bind_text(insertStatement, 3, (user.2 as NSString).utf8String, -1, nil)

                if sqlite3_step(insertStatement) == SQLITE_DONE {
                    // Success
                }
            }
            sqlite3_finalize(insertStatement)
        }
    }

    // MARK: - HTTP GET Tests

    func testHTTPGet() async throws {
        // Given - Use httpbin.org for testing (public API)
        let url = "https://httpbin.org/get"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.http.get",
            input: ["url": url]
        )

        // Then
        XCTAssertNotNil(result)

        if let response = result as? [String: Any] {
            XCTAssertNotNil(response["statusCode"])
            XCTAssertNotNil(response["headers"])
            XCTAssertNotNil(response["body"])

            let statusCode = response["statusCode"] as? Int
            XCTAssertEqual(statusCode, 200)
        } else {
            XCTFail("Result should be a response dictionary")
        }
    }

    func testHTTPGetWithHeaders() async throws {
        let url = "https://httpbin.org/headers"
        let headers = ["X-Test-Header": "TestValue"]

        let result = try await toolManager.execute(
            toolId: "tool.http.get",
            input: [
                "url": url,
                "headers": headers
            ]
        )

        XCTAssertNotNil(result)

        if let response = result as? [String: Any] {
            XCTAssertEqual(response["statusCode"] as? Int, 200)
        }
    }

    func testHTTPGetInvalidURL() async throws {
        do {
            _ = try await toolManager.execute(
                toolId: "tool.http.get",
                input: ["url": "not a valid url"]
            )
            XCTFail("Should throw error for invalid URL")
        } catch {
            // Expected
            XCTAssertTrue(true)
        }
    }

    // MARK: - HTTP POST Tests

    func testHTTPPost() async throws {
        // Given
        let url = "https://httpbin.org/post"
        let body = ["name": "Test", "value": "123"]

        // When
        let result = try await toolManager.execute(
            toolId: "tool.http.post",
            input: [
                "url": url,
                "body": body
            ]
        )

        // Then
        XCTAssertNotNil(result)

        if let response = result as? [String: Any] {
            XCTAssertEqual(response["statusCode"] as? Int, 200)
        }
    }

    func testHTTPPostWithHeaders() async throws {
        let url = "https://httpbin.org/post"
        let body = ["test": "data"]
        let headers = ["X-Custom-Header": "CustomValue"]

        let result = try await toolManager.execute(
            toolId: "tool.http.post",
            input: [
                "url": url,
                "body": body,
                "headers": headers
            ]
        )

        if let response = result as? [String: Any] {
            XCTAssertEqual(response["statusCode"] as? Int, 200)
        }
    }

    // MARK: - Download File Tests

    func testDownloadFile() async throws {
        // Given - Download a small test file
        let url = "https://httpbin.org/image/png"
        let outputPath = tempDownloadPath + "test.png"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.http.download",
            input: [
                "url": url,
                "outputPath": outputPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: outputPath))

        // Verify file size > 0
        let attributes = try FileManager.default.attributesOfItem(atPath: outputPath)
        let fileSize = attributes[.size] as? Int ?? 0
        XCTAssertGreaterThan(fileSize, 0)
    }

    // MARK: - Check URL Tests

    func testCheckURL() async throws {
        // Test valid URL
        let result = try await toolManager.execute(
            toolId: "tool.http.check",
            input: ["url": "https://www.google.com"]
        )

        XCTAssertNotNil(result)

        if let checkResult = result as? [String: Any] {
            XCTAssertNotNil(checkResult["isReachable"])
            XCTAssertNotNil(checkResult["statusCode"])

            let isReachable = checkResult["isReachable"] as? Bool
            XCTAssertTrue(isReachable ?? false)
        }
    }

    func testCheckURLInvalid() async throws {
        let result = try await toolManager.execute(
            toolId: "tool.http.check",
            input: ["url": "https://this-domain-should-not-exist-12345.com"]
        )

        if let checkResult = result as? [String: Any] {
            let isReachable = checkResult["isReachable"] as? Bool
            // May be false or network error
            XCTAssertNotNil(isReachable)
        }
    }

    // MARK: - Ping Tests

    func testPing() async throws {
        // Test ping to Google
        let result = try await toolManager.execute(
            toolId: "tool.network.ping",
            input: ["host": "https://www.google.com"]
        )

        XCTAssertNotNil(result)

        if let pingResult = result as? [String: Any] {
            XCTAssertNotNil(pingResult["success"])
            XCTAssertNotNil(pingResult["responseTime"])
        }
    }

    // MARK: - DNS Lookup Tests

    func testDNSLookup() async throws {
        // Test DNS lookup for google.com
        let result = try await toolManager.execute(
            toolId: "tool.network.dns",
            input: ["domain": "google.com"]
        )

        XCTAssertNotNil(result)

        if let dnsResult = result as? [String: Any] {
            XCTAssertNotNil(dnsResult["addresses"])

            if let addresses = dnsResult["addresses"] as? [String] {
                XCTAssertGreaterThan(addresses.count, 0)
            }
        }
    }

    func testDNSLookupInvalidDomain() async throws {
        do {
            _ = try await toolManager.execute(
                toolId: "tool.network.dns",
                input: ["domain": ""]
            )
            XCTFail("Should throw error for empty domain")
        } catch {
            // Expected
            XCTAssertTrue(true)
        }
    }

    // MARK: - Public IP Tests

    func testPublicIP() async throws {
        // Test getting public IP
        let result = try await toolManager.execute(
            toolId: "tool.network.publicip",
            input: [:]
        )

        XCTAssertNotNil(result)

        if let ipResult = result as? [String: Any] {
            XCTAssertNotNil(ipResult["ip"])

            let ip = ipResult["ip"] as? String
            XCTAssertNotNil(ip)
            XCTAssertFalse(ip?.isEmpty ?? true)
        }
    }

    // MARK: - SQLite Query Tests

    func testSQLiteQuery() async throws {
        // Given
        let query = "SELECT * FROM users"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.sqlite.query",
            input: [
                "dbPath": testDatabasePath,
                "query": query
            ]
        )

        // Then
        XCTAssertNotNil(result)

        if let rows = result as? [[String: Any]] {
            XCTAssertEqual(rows.count, 3)

            // Verify first row
            let firstRow = rows[0]
            XCTAssertEqual(firstRow["name"] as? String, "Alice")
            XCTAssertEqual(firstRow["age"] as? Int, 30)
        } else {
            XCTFail("Result should be an array of rows")
        }
    }

    func testSQLiteQueryWithWhere() async throws {
        let query = "SELECT * FROM users WHERE age > 28"

        let result = try await toolManager.execute(
            toolId: "tool.sqlite.query",
            input: [
                "dbPath": testDatabasePath,
                "query": query
            ]
        )

        if let rows = result as? [[String: Any]] {
            XCTAssertEqual(rows.count, 2)  // Alice (30) and Charlie (35)
        }
    }

    func testSQLiteQueryInvalidSQL() async throws {
        do {
            _ = try await toolManager.execute(
                toolId: "tool.sqlite.query",
                input: [
                    "dbPath": testDatabasePath,
                    "query": "INVALID SQL SYNTAX"
                ]
            )
            XCTFail("Should throw error for invalid SQL")
        } catch {
            // Expected
            XCTAssertTrue(true)
        }
    }

    // MARK: - SQLite Execute Tests

    func testSQLiteExecuteInsert() async throws {
        // Given
        let insertSQL = "INSERT INTO users (name, age, email) VALUES ('Diana', 28, 'diana@example.com')"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.sqlite.execute",
            input: [
                "dbPath": testDatabasePath,
                "sql": insertSQL
            ]
        )

        // Then
        XCTAssertNotNil(result)

        // Verify insert worked
        let queryResult = try await toolManager.execute(
            toolId: "tool.sqlite.query",
            input: [
                "dbPath": testDatabasePath,
                "query": "SELECT * FROM users WHERE name = 'Diana'"
            ]
        )

        if let rows = queryResult as? [[String: Any]] {
            XCTAssertEqual(rows.count, 1)
        }
    }

    func testSQLiteExecuteUpdate() async throws {
        let updateSQL = "UPDATE users SET age = 31 WHERE name = 'Alice'"

        let result = try await toolManager.execute(
            toolId: "tool.sqlite.execute",
            input: [
                "dbPath": testDatabasePath,
                "sql": updateSQL
            ]
        )

        XCTAssertNotNil(result)

        // Verify update
        let queryResult = try await toolManager.execute(
            toolId: "tool.sqlite.query",
            input: [
                "dbPath": testDatabasePath,
                "query": "SELECT age FROM users WHERE name = 'Alice'"
            ]
        )

        if let rows = queryResult as? [[String: Any]] {
            XCTAssertEqual(rows[0]["age"] as? Int, 31)
        }
    }

    func testSQLiteExecuteDelete() async throws {
        let deleteSQL = "DELETE FROM users WHERE name = 'Bob'"

        let result = try await toolManager.execute(
            toolId: "tool.sqlite.execute",
            input: [
                "dbPath": testDatabasePath,
                "sql": deleteSQL
            ]
        )

        XCTAssertNotNil(result)

        // Verify delete
        let queryResult = try await toolManager.execute(
            toolId: "tool.sqlite.query",
            input: [
                "dbPath": testDatabasePath,
                "query": "SELECT * FROM users"
            ]
        )

        if let rows = queryResult as? [[String: Any]] {
            XCTAssertEqual(rows.count, 2)  // Should be 2 rows left
        }
    }

    // MARK: - SQLite Tables Tests

    func testSQLiteTables() async throws {
        // When
        let result = try await toolManager.execute(
            toolId: "tool.sqlite.tables",
            input: ["dbPath": testDatabasePath]
        )

        // Then
        XCTAssertNotNil(result)

        if let tables = result as? [String] {
            XCTAssertTrue(tables.contains("users"))
        } else {
            XCTFail("Result should be an array of table names")
        }
    }

    // MARK: - SQLite Schema Tests

    func testSQLiteSchema() async throws {
        // When
        let result = try await toolManager.execute(
            toolId: "tool.sqlite.schema",
            input: [
                "dbPath": testDatabasePath,
                "table": "users"
            ]
        )

        // Then
        XCTAssertNotNil(result)

        if let schema = result as? [[String: Any]] {
            XCTAssertGreaterThan(schema.count, 0)

            // Verify columns
            let columnNames = schema.map { $0["name"] as? String }
            XCTAssertTrue(columnNames.contains("id"))
            XCTAssertTrue(columnNames.contains("name"))
            XCTAssertTrue(columnNames.contains("age"))
            XCTAssertTrue(columnNames.contains("email"))
        } else {
            XCTFail("Result should be schema array")
        }
    }

    func testSQLiteSchemaInvalidTable() async throws {
        do {
            _ = try await toolManager.execute(
                toolId: "tool.sqlite.schema",
                input: [
                    "dbPath": testDatabasePath,
                    "table": "nonexistent_table"
                ]
            )
            XCTFail("Should throw error for nonexistent table")
        } catch {
            // Expected
            XCTAssertTrue(true)
        }
    }

    // MARK: - SQLite Export Tests

    func testSQLiteExport() async throws {
        // When
        let result = try await toolManager.execute(
            toolId: "tool.sqlite.export",
            input: [
                "dbPath": testDatabasePath,
                "table": "users"
            ]
        )

        // Then
        XCTAssertNotNil(result)

        if let jsonString = result as? String {
            XCTAssertFalse(jsonString.isEmpty)

            // Verify it's valid JSON
            if let jsonData = jsonString.data(using: .utf8),
               let jsonArray = try? JSONSerialization.jsonObject(with: jsonData) as? [[String: Any]] {
                XCTAssertEqual(jsonArray.count, 3)
            } else {
                XCTFail("Export should produce valid JSON")
            }
        } else {
            XCTFail("Result should be a JSON string")
        }
    }

    // MARK: - SQLite Backup Tests

    func testSQLiteBackup() async throws {
        // Given
        let backupPath = testDatabasePath + ".backup"

        // When
        let result = try await toolManager.execute(
            toolId: "tool.sqlite.backup",
            input: [
                "dbPath": testDatabasePath,
                "backupPath": backupPath
            ]
        )

        // Then
        XCTAssertNotNil(result)
        XCTAssertTrue(FileManager.default.fileExists(atPath: backupPath))

        // Verify backup is valid
        var backupDb: OpaquePointer?
        XCTAssertEqual(sqlite3_open(backupPath, &backupDb), SQLITE_OK)
        sqlite3_close(backupDb)

        // Clean up
        try? FileManager.default.removeItem(atPath: backupPath)
    }

    // MARK: - SQLite Optimize Tests

    func testSQLiteOptimize() async throws {
        // When
        let result = try await toolManager.execute(
            toolId: "tool.sqlite.optimize",
            input: ["dbPath": testDatabasePath]
        )

        // Then
        XCTAssertNotNil(result)

        if let success = result as? Bool {
            XCTAssertTrue(success)
        }
    }

    // MARK: - Performance Tests

    func testHTTPGetPerformance() throws {
        let url = "https://httpbin.org/get"

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.http.get",
                    input: ["url": url]
                )
            }
        }
    }

    func testSQLiteQueryPerformance() throws {
        let query = "SELECT * FROM users"

        measure {
            Task {
                _ = try? await toolManager.execute(
                    toolId: "tool.sqlite.query",
                    input: [
                        "dbPath": testDatabasePath,
                        "query": query
                    ]
                )
            }
        }
    }

    func testSQLiteInsertPerformance() throws {
        measure {
            Task {
                let insertSQL = "INSERT INTO users (name, age, email) VALUES ('Test', 99, 'test@test.com')"
                _ = try? await toolManager.execute(
                    toolId: "tool.sqlite.execute",
                    input: [
                        "dbPath": testDatabasePath,
                        "sql": insertSQL
                    ]
                )
            }
        }
    }

    // MARK: - Integration Tests

    func testHTTPAndDatabase() async throws {
        // Test workflow: HTTP request -> save to database
        // 1. Get data from HTTP
        let httpResult = try await toolManager.execute(
            toolId: "tool.http.get",
            input: ["url": "https://httpbin.org/uuid"]
        )

        XCTAssertNotNil(httpResult)

        // 2. Save to database (simplified test)
        let insertSQL = "INSERT INTO users (name, age, email) VALUES ('HTTPTest', 99, 'http@test.com')"
        let dbResult = try await toolManager.execute(
            toolId: "tool.sqlite.execute",
            input: [
                "dbPath": testDatabasePath,
                "sql": insertSQL
            ]
        )

        XCTAssertNotNil(dbResult)
    }
}
