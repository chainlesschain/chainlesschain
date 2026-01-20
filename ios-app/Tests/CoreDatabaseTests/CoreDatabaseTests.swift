import XCTest
import SQLite3
@testable import CoreDatabase
@testable import CoreCommon

final class CoreDatabaseTests: XCTestCase {

    var database: DatabaseManager!

    override func setUp() async throws {
        try await super.setUp()
        // Use in-memory database for testing
        database = DatabaseManager.shared
        try await database.initialize(password: "testPassword123")
    }

    override func tearDown() async throws {
        // Clean up test tables
        try? database.execute("DROP TABLE IF EXISTS test_table")
        try await super.tearDown()
    }

    // MARK: - Database Initialization Tests

    func testDatabaseInitialization() async throws {
        XCTAssertTrue(database.isInitialized)
    }

    func testDatabaseReinitialization() async throws {
        // Should not throw on re-initialization
        try await database.initialize(password: "testPassword123")
        XCTAssertTrue(database.isInitialized)
    }

    // MARK: - Table Creation Tests

    func testCreateTable() throws {
        let createSQL = """
            CREATE TABLE IF NOT EXISTS test_table (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                value INTEGER,
                created_at INTEGER NOT NULL
            )
        """

        XCTAssertNoThrow(try database.execute(createSQL))

        // Verify table exists
        let tableExists = try checkTableExists("test_table")
        XCTAssertTrue(tableExists)
    }

    func testCreateIndex() throws {
        try database.execute("""
            CREATE TABLE IF NOT EXISTS test_index_table (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            )
        """)

        XCTAssertNoThrow(try database.execute(
            "CREATE INDEX IF NOT EXISTS idx_test_name ON test_index_table(name)"
        ))
    }

    // MARK: - CRUD Operations Tests

    func testInsertAndQuery() throws {
        // Create table
        try database.execute("""
            CREATE TABLE IF NOT EXISTS test_crud (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                age INTEGER
            )
        """)

        // Insert
        let insertSQL = "INSERT INTO test_crud (id, name, age) VALUES (?, ?, ?)"
        _ = try database.query(insertSQL, parameters: ["1", "John", 25]) { _ in () }

        // Query
        let results: [TestPerson] = try database.query(
            "SELECT id, name, age FROM test_crud WHERE id = ?",
            parameters: ["1"]
        ) { stmt in
            TestPerson(
                id: String(cString: sqlite3_column_text(stmt, 0)),
                name: String(cString: sqlite3_column_text(stmt, 1)),
                age: Int(sqlite3_column_int(stmt, 2))
            )
        }

        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results[0].name, "John")
        XCTAssertEqual(results[0].age, 25)
    }

    func testUpdate() throws {
        try database.execute("""
            CREATE TABLE IF NOT EXISTS test_update (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            )
        """)

        // Insert
        _ = try database.query(
            "INSERT INTO test_update (id, name) VALUES (?, ?)",
            parameters: ["1", "Original"]
        ) { _ in () }

        // Update
        _ = try database.query(
            "UPDATE test_update SET name = ? WHERE id = ?",
            parameters: ["Updated", "1"]
        ) { _ in () }

        // Verify
        let result: String? = try database.queryOne(
            "SELECT name FROM test_update WHERE id = ?",
            parameters: ["1"]
        ) { stmt in
            String(cString: sqlite3_column_text(stmt, 0))
        }

        XCTAssertEqual(result, "Updated")
    }

    func testDelete() throws {
        try database.execute("""
            CREATE TABLE IF NOT EXISTS test_delete (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL
            )
        """)

        // Insert
        _ = try database.query(
            "INSERT INTO test_delete (id, name) VALUES (?, ?)",
            parameters: ["1", "ToDelete"]
        ) { _ in () }

        // Delete
        try database.execute("DELETE FROM test_delete WHERE id = '1'")

        // Verify
        let count: Int? = try database.queryOne(
            "SELECT COUNT(*) FROM test_delete WHERE id = ?",
            parameters: ["1"]
        ) { stmt in
            Int(sqlite3_column_int(stmt, 0))
        }

        XCTAssertEqual(count, 0)
    }

    // MARK: - Transaction Tests

    func testTransactionSuccess() throws {
        try database.execute("""
            CREATE TABLE IF NOT EXISTS test_transaction (
                id TEXT PRIMARY KEY,
                value INTEGER
            )
        """)

        try database.transaction {
            _ = try database.query(
                "INSERT INTO test_transaction (id, value) VALUES (?, ?)",
                parameters: ["1", 100]
            ) { _ in () }

            _ = try database.query(
                "INSERT INTO test_transaction (id, value) VALUES (?, ?)",
                parameters: ["2", 200]
            ) { _ in () }
        }

        // Verify both inserts succeeded
        let count: Int? = try database.queryOne(
            "SELECT COUNT(*) FROM test_transaction"
        ) { stmt in
            Int(sqlite3_column_int(stmt, 0))
        }

        XCTAssertEqual(count, 2)
    }

    func testTransactionRollback() throws {
        try database.execute("""
            CREATE TABLE IF NOT EXISTS test_rollback (
                id TEXT PRIMARY KEY,
                value INTEGER
            )
        """)

        // Insert initial data
        _ = try database.query(
            "INSERT INTO test_rollback (id, value) VALUES (?, ?)",
            parameters: ["1", 100]
        ) { _ in () }

        do {
            try database.transaction {
                _ = try database.query(
                    "INSERT INTO test_rollback (id, value) VALUES (?, ?)",
                    parameters: ["2", 200]
                ) { _ in () }

                // Force an error
                throw DatabaseError.executionFailed("Intentional rollback")
            }
        } catch {
            // Expected
        }

        // Verify rollback - only original row should exist
        let count: Int? = try database.queryOne(
            "SELECT COUNT(*) FROM test_rollback"
        ) { stmt in
            Int(sqlite3_column_int(stmt, 0))
        }

        XCTAssertEqual(count, 1)
    }

    // MARK: - QueryOne Tests

    func testQueryOneReturnsNilForEmptyResult() throws {
        try database.execute("""
            CREATE TABLE IF NOT EXISTS test_empty (
                id TEXT PRIMARY KEY
            )
        """)

        let result: String? = try database.queryOne(
            "SELECT id FROM test_empty WHERE id = ?",
            parameters: ["nonexistent"]
        ) { stmt in
            String(cString: sqlite3_column_text(stmt, 0))
        }

        XCTAssertNil(result)
    }

    // MARK: - Null Handling Tests

    func testNullableColumns() throws {
        try database.execute("""
            CREATE TABLE IF NOT EXISTS test_nullable (
                id TEXT PRIMARY KEY,
                nullable_value TEXT
            )
        """)

        // Insert with NULL
        _ = try database.query(
            "INSERT INTO test_nullable (id, nullable_value) VALUES (?, ?)",
            parameters: ["1", nil as String?]
        ) { _ in () }

        // Query
        let result: (String, String?)? = try database.queryOne(
            "SELECT id, nullable_value FROM test_nullable WHERE id = ?",
            parameters: ["1"]
        ) { stmt in
            let id = String(cString: sqlite3_column_text(stmt, 0))
            let nullableValue: String? = sqlite3_column_type(stmt, 1) != SQLITE_NULL ?
                String(cString: sqlite3_column_text(stmt, 1)) : nil
            return (id, nullableValue)
        }

        XCTAssertNotNil(result)
        XCTAssertEqual(result?.0, "1")
        XCTAssertNil(result?.1)
    }

    // MARK: - Blob Storage Tests

    func testBlobStorage() throws {
        try database.execute("""
            CREATE TABLE IF NOT EXISTS test_blob (
                id TEXT PRIMARY KEY,
                data BLOB NOT NULL
            )
        """)

        let testData = Data([0x48, 0x65, 0x6C, 0x6C, 0x6F])

        // Insert
        _ = try database.query(
            "INSERT INTO test_blob (id, data) VALUES (?, ?)",
            parameters: ["1", testData]
        ) { _ in () }

        // Query
        let retrievedData: Data? = try database.queryOne(
            "SELECT data FROM test_blob WHERE id = ?",
            parameters: ["1"]
        ) { stmt in
            let blobPointer = sqlite3_column_blob(stmt, 0)
            let blobSize = Int(sqlite3_column_bytes(stmt, 0))
            guard let ptr = blobPointer, blobSize > 0 else { return nil }
            return Data(bytes: ptr, count: blobSize)
        }

        XCTAssertEqual(retrievedData, testData)
    }

    // MARK: - Helper Methods

    private func checkTableExists(_ tableName: String) throws -> Bool {
        let result: Int? = try database.queryOne(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
            parameters: [tableName]
        ) { stmt in
            Int(sqlite3_column_int(stmt, 0))
        }
        return (result ?? 0) > 0
    }
}

// MARK: - Test Models

private struct TestPerson {
    let id: String
    let name: String
    let age: Int
}
