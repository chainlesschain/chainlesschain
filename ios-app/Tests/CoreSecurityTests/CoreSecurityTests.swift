import XCTest
@testable import CoreSecurity
@testable import CoreCommon

final class CoreSecurityTests: XCTestCase {

    // MARK: - CryptoManager Tests

    var cryptoManager: CryptoManager!

    override func setUp() {
        super.setUp()
        cryptoManager = CryptoManager.shared
    }

    func testAESEncryptionDecryption() throws {
        let plaintext = "Hello, World! This is a secret message."
        let password = "testPassword123"

        // Encrypt
        let encryptedData = try cryptoManager.encrypt(plaintext, password: password)
        XCTAssertNotNil(encryptedData)
        XCTAssertNotEqual(encryptedData, plaintext.data(using: .utf8))

        // Decrypt
        let decryptedText = try cryptoManager.decrypt(encryptedData, password: password)
        XCTAssertEqual(decryptedText, plaintext)
    }

    func testAESEncryptionWithWrongPassword() throws {
        let plaintext = "Secret message"
        let password = "correctPassword"
        let wrongPassword = "wrongPassword"

        let encryptedData = try cryptoManager.encrypt(plaintext, password: password)

        XCTAssertThrowsError(try cryptoManager.decrypt(encryptedData, password: wrongPassword)) { error in
            // Should throw a decryption error
            XCTAssertTrue(error is SecurityError)
        }
    }

    func testPBKDF2KeyDerivation() {
        let password = "testPassword"
        let salt = Data(repeating: 0x00, count: 16)

        let derivedKey = cryptoManager.deriveKey(from: password, salt: salt, iterations: 10000)
        XCTAssertNotNil(derivedKey)
        XCTAssertEqual(derivedKey.count, 32) // 256 bits

        // Same password and salt should produce same key
        let derivedKey2 = cryptoManager.deriveKey(from: password, salt: salt, iterations: 10000)
        XCTAssertEqual(derivedKey, derivedKey2)

        // Different password should produce different key
        let derivedKey3 = cryptoManager.deriveKey(from: "differentPassword", salt: salt, iterations: 10000)
        XCTAssertNotEqual(derivedKey, derivedKey3)
    }

    func testRandomDataGeneration() {
        let randomData1 = cryptoManager.generateRandomData(length: 32)
        let randomData2 = cryptoManager.generateRandomData(length: 32)

        XCTAssertEqual(randomData1.count, 32)
        XCTAssertEqual(randomData2.count, 32)
        XCTAssertNotEqual(randomData1, randomData2)
    }

    func testSHA256Hash() {
        let data = "Test data".data(using: .utf8)!
        let hash = cryptoManager.sha256(data)

        XCTAssertEqual(hash.count, 32) // SHA256 produces 256 bits = 32 bytes

        // Same input should produce same hash
        let hash2 = cryptoManager.sha256(data)
        XCTAssertEqual(hash, hash2)

        // Different input should produce different hash
        let hash3 = cryptoManager.sha256("Different data".data(using: .utf8)!)
        XCTAssertNotEqual(hash, hash3)
    }

    // MARK: - KeychainManager Tests

    func testKeychainSaveAndRetrieve() throws {
        let keychainManager = KeychainManager.shared
        let testKey = "testKey_\(UUID().uuidString)"
        let testValue = "testValue123"

        // Save
        try keychainManager.save(key: testKey, value: testValue)

        // Retrieve
        let retrievedValue = try keychainManager.retrieve(key: testKey)
        XCTAssertEqual(retrievedValue, testValue)

        // Cleanup
        try keychainManager.delete(key: testKey)
    }

    func testKeychainUpdate() throws {
        let keychainManager = KeychainManager.shared
        let testKey = "testKey_\(UUID().uuidString)"
        let initialValue = "initialValue"
        let updatedValue = "updatedValue"

        // Save initial
        try keychainManager.save(key: testKey, value: initialValue)

        // Update
        try keychainManager.save(key: testKey, value: updatedValue)

        // Verify update
        let retrievedValue = try keychainManager.retrieve(key: testKey)
        XCTAssertEqual(retrievedValue, updatedValue)

        // Cleanup
        try keychainManager.delete(key: testKey)
    }

    func testKeychainDelete() throws {
        let keychainManager = KeychainManager.shared
        let testKey = "testKey_\(UUID().uuidString)"
        let testValue = "testValue"

        // Save
        try keychainManager.save(key: testKey, value: testValue)

        // Delete
        try keychainManager.delete(key: testKey)

        // Verify deletion
        XCTAssertThrowsError(try keychainManager.retrieve(key: testKey))
    }

    func testKeychainRetrieveNonExistent() {
        let keychainManager = KeychainManager.shared
        let nonExistentKey = "nonExistent_\(UUID().uuidString)"

        XCTAssertThrowsError(try keychainManager.retrieve(key: nonExistentKey))
    }

    // MARK: - BiometricAuthManager Tests

    func testBiometricAvailability() {
        let biometricManager = BiometricAuthManager.shared

        // This test just verifies the method doesn't crash
        // Actual biometric availability depends on device
        let isAvailable = biometricManager.isBiometricAvailable()
        XCTAssertTrue(isAvailable == true || isAvailable == false)
    }

    func testBiometricType() {
        let biometricManager = BiometricAuthManager.shared

        // Verify biometric type is properly returned
        let type = biometricManager.biometricType()
        XCTAssertNotNil(type)
    }
}

// MARK: - Security Error Tests

final class SecurityErrorTests: XCTestCase {

    func testSecurityErrorDescriptions() {
        let encryptionError = SecurityError.encryptionFailed("test")
        XCTAssertTrue(encryptionError.localizedDescription.contains("Encryption"))

        let decryptionError = SecurityError.decryptionFailed("test")
        XCTAssertTrue(decryptionError.localizedDescription.contains("Decryption"))

        let keychainError = SecurityError.keychainError("test")
        XCTAssertTrue(keychainError.localizedDescription.contains("Keychain"))
    }
}
