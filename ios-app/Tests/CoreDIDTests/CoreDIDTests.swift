import XCTest
@testable import CoreDID
@testable import CoreCommon
@testable import CoreSecurity

final class CoreDIDTests: XCTestCase {

    var didManager: DIDManager!

    override func setUp() {
        super.setUp()
        didManager = DIDManager.shared
    }

    // MARK: - DID Generation Tests

    func testGenerateDID() throws {
        let did = try didManager.generateDID()

        XCTAssertNotNil(did)
        XCTAssertTrue(did.hasPrefix("did:key:"))
        XCTAssertTrue(did.count > 20) // Should have significant length
    }

    func testGenerateUniqueDIDs() throws {
        let did1 = try didManager.generateDID()
        let did2 = try didManager.generateDID()

        XCTAssertNotEqual(did1, did2)
    }

    // MARK: - DID Document Tests

    func testCreateDIDDocument() throws {
        let did = try didManager.generateDID()
        let document = try didManager.createDIDDocument(did: did)

        XCTAssertNotNil(document)
        XCTAssertEqual(document.id, did)
        XCTAssertFalse(document.verificationMethod.isEmpty)
        XCTAssertFalse(document.authentication.isEmpty)
    }

    func testDIDDocumentContainsPublicKey() throws {
        let did = try didManager.generateDID()
        let document = try didManager.createDIDDocument(did: did)

        let verificationMethod = document.verificationMethod.first
        XCTAssertNotNil(verificationMethod)
        XCTAssertNotNil(verificationMethod?.publicKeyMultibase)
    }

    // MARK: - Key Management Tests

    func testStoreAndRetrievePrivateKey() throws {
        let did = try didManager.generateDID()

        // Verify we can retrieve the private key
        let privateKey = try didManager.getPrivateKey(for: did)
        XCTAssertNotNil(privateKey)
    }

    func testPrivateKeyNotFoundForUnknownDID() {
        let unknownDID = "did:key:unknown123"

        XCTAssertThrowsError(try didManager.getPrivateKey(for: unknownDID)) { error in
            XCTAssertTrue(error is DIDError)
        }
    }

    // MARK: - Signing Tests

    func testSignAndVerify() throws {
        let did = try didManager.generateDID()
        let message = "Hello, World!".data(using: .utf8)!

        // Sign
        let signature = try didManager.sign(message: message, with: did)
        XCTAssertNotNil(signature)
        XCTAssertTrue(signature.count > 0)

        // Verify
        let isValid = try didManager.verify(
            message: message,
            signature: signature,
            for: did
        )
        XCTAssertTrue(isValid)
    }

    func testSignatureVerificationFailsForTamperedMessage() throws {
        let did = try didManager.generateDID()
        let message = "Original message".data(using: .utf8)!
        let tamperedMessage = "Tampered message".data(using: .utf8)!

        let signature = try didManager.sign(message: message, with: did)

        let isValid = try didManager.verify(
            message: tamperedMessage,
            signature: signature,
            for: did
        )
        XCTAssertFalse(isValid)
    }

    // MARK: - Key Export/Import Tests

    func testExportAndImportKeys() throws {
        let originalDID = try didManager.generateDID()
        let message = "Test message".data(using: .utf8)!
        let originalSignature = try didManager.sign(message: message, with: originalDID)

        // Export
        let exportedData = try didManager.exportKeyPair(for: originalDID, password: "testPassword")
        XCTAssertNotNil(exportedData)

        // Import into new DID manager (simulate)
        let importedDID = try didManager.importKeyPair(
            from: exportedData,
            password: "testPassword"
        )

        // Verify imported DID can verify original signature
        let isValid = try didManager.verify(
            message: message,
            signature: originalSignature,
            for: importedDID
        )
        XCTAssertTrue(isValid)
    }

    func testImportFailsWithWrongPassword() throws {
        let did = try didManager.generateDID()
        let exportedData = try didManager.exportKeyPair(for: did, password: "correctPassword")

        XCTAssertThrowsError(
            try didManager.importKeyPair(from: exportedData, password: "wrongPassword")
        )
    }

    // MARK: - DID Resolution Tests

    func testResolveDID() throws {
        let did = try didManager.generateDID()
        _ = try didManager.createDIDDocument(did: did)

        let resolvedDocument = try didManager.resolve(did: did)
        XCTAssertNotNil(resolvedDocument)
        XCTAssertEqual(resolvedDocument?.id, did)
    }

    func testResolveMalformedDID() {
        let malformedDID = "not-a-valid-did"

        XCTAssertThrowsError(try didManager.resolve(did: malformedDID)) { error in
            XCTAssertTrue(error is DIDError)
        }
    }

    // MARK: - DID Deactivation Tests

    func testDeactivateDID() throws {
        let did = try didManager.generateDID()

        // Deactivate
        try didManager.deactivate(did: did)

        // Verify deactivated
        XCTAssertThrowsError(try didManager.getPrivateKey(for: did))
    }

    // MARK: - Multiple DID Management Tests

    func testManageMultipleDIDs() throws {
        let did1 = try didManager.generateDID()
        let did2 = try didManager.generateDID()
        let did3 = try didManager.generateDID()

        let allDIDs = didManager.listDIDs()

        XCTAssertTrue(allDIDs.contains(did1))
        XCTAssertTrue(allDIDs.contains(did2))
        XCTAssertTrue(allDIDs.contains(did3))
    }
}

// MARK: - DID Error Tests

final class DIDErrorTests: XCTestCase {

    func testDIDErrorDescriptions() {
        let generationError = DIDError.generationFailed("test")
        XCTAssertTrue(generationError.localizedDescription.contains("generation"))

        let keyNotFoundError = DIDError.keyNotFound("did:key:test")
        XCTAssertTrue(keyNotFoundError.localizedDescription.contains("not found"))

        let invalidDIDError = DIDError.invalidDID("test")
        XCTAssertTrue(invalidDIDError.localizedDescription.contains("Invalid"))
    }
}
