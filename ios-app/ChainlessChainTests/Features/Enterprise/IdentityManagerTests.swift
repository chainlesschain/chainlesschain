import XCTest
import SQLite
@testable import ChainlessChain

@MainActor
final class IdentityManagerTests: XCTestCase {

    var manager: IdentityManager!
    var testDB: Connection!

    override func setUp() async throws {
        try await super.setUp()

        // Create in-memory database for testing
        testDB = try Connection(.inMemory)

        // Initialize database tables
        try await EnterpriseDB.migrate(db: testDB)

        // Get manager instance
        manager = IdentityManager.shared
        manager.setDatabase(testDB)

        // Initialize manager
        try await manager.initialize()
    }

    override func tearDown() async throws {
        try? await EnterpriseDB.dropAllTables(db: testDB)
        testDB = nil
        manager = nil

        try await super.tearDown()
    }

    // MARK: - Identity Creation Tests

    func testCreatePersonalIdentity() async throws {
        // When
        let identity = try await manager.createIdentity(
            did: "did:example:alice123",
            displayName: "Alice",
            avatar: "https://example.com/alice.png"
        )

        // Then
        XCTAssertFalse(identity.id.isEmpty)
        XCTAssertEqual(identity.did, "did:example:alice123")
        XCTAssertEqual(identity.displayName, "Alice")
        XCTAssertEqual(identity.avatar, "https://example.com/alice.png")
        XCTAssertNil(identity.orgId)
        XCTAssertTrue(identity.isPersonal)
        XCTAssertFalse(identity.isOrganization)
    }

    func testCreateOrganizationIdentity() async throws {
        // When
        let identity = try await manager.createIdentity(
            did: "did:example:bob456",
            displayName: "Bob",
            orgId: "org_123",
            orgName: "Acme Corp",
            role: "admin"
        )

        // Then
        XCTAssertEqual(identity.orgId, "org_123")
        XCTAssertEqual(identity.orgName, "Acme Corp")
        XCTAssertEqual(identity.role, "admin")
        XCTAssertTrue(identity.isOrganization)
        XCTAssertFalse(identity.isPersonal)
    }

    func testFirstIdentityIsAutomaticallyActive() async throws {
        // When
        let identity = try await manager.createIdentity(
            did: "did:example:first",
            displayName: "First Identity"
        )

        // Then
        XCTAssertTrue(identity.isActive)
        XCTAssertEqual(manager.currentIdentity?.id, identity.id)
    }

    func testSecondIdentityIsNotActive() async throws {
        // Given
        _ = try await manager.createIdentity(
            did: "did:example:first",
            displayName: "First"
        )

        // When
        let second = try await manager.createIdentity(
            did: "did:example:second",
            displayName: "Second"
        )

        // Then
        XCTAssertFalse(second.isActive)
        XCTAssertNotEqual(manager.currentIdentity?.id, second.id)
    }

    func testCannotCreateDuplicateIdentity() async throws {
        // Given
        _ = try await manager.createIdentity(
            did: "did:example:duplicate",
            displayName: "Original"
        )

        // When/Then
        do {
            _ = try await manager.createIdentity(
                did: "did:example:duplicate",
                displayName: "Duplicate"
            )
            XCTFail("Should not allow duplicate DID")
        } catch {
            XCTAssertTrue(error is IdentityError)
        }
    }

    // MARK: - Identity Update Tests

    func testUpdateIdentity() async throws {
        // Given
        let identity = try await manager.createIdentity(
            did: "did:example:update",
            displayName: "Original Name"
        )

        // When
        try await manager.updateIdentity(
            id: identity.id,
            displayName: "Updated Name",
            avatar: "https://example.com/new.png"
        )

        // Then
        let updated = manager.getIdentityByID(identity.id)
        XCTAssertEqual(updated?.displayName, "Updated Name")
        XCTAssertEqual(updated?.avatar, "https://example.com/new.png")
    }

    func testUpdateNonExistentIdentity() async throws {
        // When/Then
        do {
            try await manager.updateIdentity(
                id: "non_existent_id",
                displayName: "New Name"
            )
            XCTFail("Should throw error for non-existent identity")
        } catch {
            XCTAssertTrue(error is IdentityError)
        }
    }

    // MARK: - Identity Deletion Tests

    func testDeleteIdentity() async throws {
        // Given
        let first = try await manager.createIdentity(
            did: "did:example:first",
            displayName: "First"
        )

        let second = try await manager.createIdentity(
            did: "did:example:second",
            displayName: "Second"
        )

        // When
        try await manager.deleteIdentity(id: second.id)

        // Then
        XCTAssertEqual(manager.identities.count, 1)
        XCTAssertNil(manager.getIdentityByID(second.id))
    }

    func testCannotDeleteActiveIdentity() async throws {
        // Given
        let identity = try await manager.createIdentity(
            did: "did:example:active",
            displayName: "Active"
        )

        // When/Then
        do {
            try await manager.deleteIdentity(id: identity.id)
            XCTFail("Should not allow deleting active identity")
        } catch {
            XCTAssertTrue(error is IdentityError)
        }
    }

    // MARK: - Identity Switching Tests

    func testSwitchIdentity() async throws {
        // Given
        let first = try await manager.createIdentity(
            did: "did:example:first",
            displayName: "First"
        )

        let second = try await manager.createIdentity(
            did: "did:example:second",
            displayName: "Second"
        )

        // When
        try await manager.switchIdentity(to: second)

        // Then
        XCTAssertEqual(manager.currentIdentity?.id, second.id)
        XCTAssertTrue(manager.getIdentityByID(second.id)?.isActive ?? false)
        XCTAssertFalse(manager.getIdentityByID(first.id)?.isActive ?? true)
    }

    func testSwitchIdentityByDID() async throws {
        // Given
        _ = try await manager.createIdentity(
            did: "did:example:first",
            displayName: "First"
        )

        _ = try await manager.createIdentity(
            did: "did:example:second",
            displayName: "Second"
        )

        // When
        try await manager.switchIdentityByDID("did:example:second")

        // Then
        XCTAssertEqual(manager.currentIdentity?.did, "did:example:second")
    }

    func testSwitchToNonExistentIdentity() async throws {
        // When/Then
        do {
            try await manager.switchIdentityByDID("did:example:nonexistent")
            XCTFail("Should throw error for non-existent identity")
        } catch {
            XCTAssertTrue(error is IdentityError)
        }
    }

    func testLastUsedAtUpdatedOnSwitch() async throws {
        // Given
        _ = try await manager.createIdentity(
            did: "did:example:first",
            displayName: "First"
        )

        let second = try await manager.createIdentity(
            did: "did:example:second",
            displayName: "Second"
        )

        // When
        try await manager.switchIdentity(to: second)

        // Then
        let updated = manager.getIdentityByID(second.id)
        XCTAssertNotNil(updated?.lastUsedAt)
    }

    // MARK: - Query Methods Tests

    func testGetCurrentIdentity() async throws {
        // Given
        let identity = try await manager.createIdentity(
            did: "did:example:current",
            displayName: "Current"
        )

        // When
        let current = manager.getCurrentIdentity()

        // Then
        XCTAssertEqual(current?.id, identity.id)
    }

    func testListIdentities() async throws {
        // Given
        _ = try await manager.createIdentity(
            did: "did:example:one",
            displayName: "One"
        )

        _ = try await manager.createIdentity(
            did: "did:example:two",
            displayName: "Two"
        )

        // When
        let identities = manager.listIdentities()

        // Then
        XCTAssertEqual(identities.count, 2)
    }

    func testGetPersonalIdentities() async throws {
        // Given
        _ = try await manager.createIdentity(
            did: "did:example:personal1",
            displayName: "Personal 1"
        )

        _ = try await manager.createIdentity(
            did: "did:example:personal2",
            displayName: "Personal 2"
        )

        _ = try await manager.createIdentity(
            did: "did:example:org",
            displayName: "Org User",
            orgId: "org_123",
            orgName: "Company"
        )

        // When
        let personalIdentities = manager.getPersonalIdentities()

        // Then
        XCTAssertEqual(personalIdentities.count, 2)
        XCTAssertTrue(personalIdentities.allSatisfy { $0.isPersonal })
    }

    func testGetOrganizationIdentities() async throws {
        // Given
        _ = try await manager.createIdentity(
            did: "did:example:personal",
            displayName: "Personal"
        )

        _ = try await manager.createIdentity(
            did: "did:example:org1",
            displayName: "Org User 1",
            orgId: "org_123"
        )

        _ = try await manager.createIdentity(
            did: "did:example:org2",
            displayName: "Org User 2",
            orgId: "org_456"
        )

        // When
        let orgIdentities = manager.getOrganizationIdentities()

        // Then
        XCTAssertEqual(orgIdentities.count, 2)
        XCTAssertTrue(orgIdentities.allSatisfy { $0.isOrganization })
    }

    func testGetIdentitiesByOrg() async throws {
        // Given
        _ = try await manager.createIdentity(
            did: "did:example:org1user1",
            displayName: "Org1 User 1",
            orgId: "org_123"
        )

        _ = try await manager.createIdentity(
            did: "did:example:org1user2",
            displayName: "Org1 User 2",
            orgId: "org_123"
        )

        _ = try await manager.createIdentity(
            did: "did:example:org2user",
            displayName: "Org2 User",
            orgId: "org_456"
        )

        // When
        let org123Identities = manager.getIdentitiesByOrg(orgId: "org_123")

        // Then
        XCTAssertEqual(org123Identities.count, 2)
        XCTAssertTrue(org123Identities.allSatisfy { $0.orgId == "org_123" })
    }

    func testGetIdentityByDID() async throws {
        // Given
        _ = try await manager.createIdentity(
            did: "did:example:findme",
            displayName: "Find Me"
        )

        // When
        let identity = manager.getIdentityByDID("did:example:findme")

        // Then
        XCTAssertNotNil(identity)
        XCTAssertEqual(identity?.displayName, "Find Me")
    }

    func testHasIdentity() async throws {
        // Given
        _ = try await manager.createIdentity(
            did: "did:example:exists",
            displayName: "Exists"
        )

        // When
        let exists = manager.hasIdentity(did: "did:example:exists")
        let notExists = manager.hasIdentity(did: "did:example:notexists")

        // Then
        XCTAssertTrue(exists)
        XCTAssertFalse(notExists)
    }

    // MARK: - Organization Integration Tests

    func testSyncIdentityFromOrganization() async throws {
        // Given
        let org = Organization(
            id: "org_123",
            did: "did:example:org123",
            name: "Test Organization",
            ownerDID: "did:example:owner",
            settings: OrganizationSettings(),
            createdAt: Date(),
            updatedAt: Date()
        )

        let member = OrganizationMember(
            id: "member_1",
            orgId: "org_123",
            memberDID: "did:example:member",
            displayName: "Test Member",
            role: .editor,
            status: .active,
            joinedAt: Date()
        )

        // When
        try await manager.syncIdentityFromOrganization(member: member, org: org)

        // Then
        let identity = manager.getIdentityByDID("did:example:member")
        XCTAssertNotNil(identity)
        XCTAssertEqual(identity?.orgId, "org_123")
        XCTAssertEqual(identity?.orgName, "Test Organization")
        XCTAssertEqual(identity?.role, "editor")
    }

    func testSyncUpdatesExistingIdentity() async throws {
        // Given
        let org = Organization(
            id: "org_123",
            did: "did:example:org123",
            name: "Test Organization",
            ownerDID: "did:example:owner",
            settings: OrganizationSettings(),
            createdAt: Date(),
            updatedAt: Date()
        )

        let member = OrganizationMember(
            id: "member_1",
            orgId: "org_123",
            memberDID: "did:example:member",
            displayName: "Original Name",
            role: .viewer,
            status: .active,
            joinedAt: Date()
        )

        try await manager.syncIdentityFromOrganization(member: member, org: org)

        // Update member
        var updatedMember = member
        updatedMember.displayName = "Updated Name"
        updatedMember.role = .admin

        // When
        try await manager.syncIdentityFromOrganization(member: updatedMember, org: org)

        // Then
        let identity = manager.getIdentityByDID("did:example:member")
        XCTAssertEqual(identity?.displayName, "Updated Name")
        XCTAssertEqual(identity?.role, "admin")
    }

    func testRemoveIdentityForOrganization() async throws {
        // Given
        _ = try await manager.createIdentity(
            did: "did:example:personal",
            displayName: "Personal"
        )

        let orgIdentity = try await manager.createIdentity(
            did: "did:example:orgmember",
            displayName: "Org Member",
            orgId: "org_123"
        )

        // Switch to org identity
        try await manager.switchIdentity(to: orgIdentity)

        // When
        try await manager.removeIdentityForOrganization(
            orgId: "org_123",
            memberDID: "did:example:orgmember"
        )

        // Then
        XCTAssertNil(manager.getIdentityByDID("did:example:orgmember"))
        // Should have switched to another identity
        XCTAssertNotEqual(manager.currentIdentity?.did, "did:example:orgmember")
    }

    func testBatchSyncOrganizationIdentities() async throws {
        // Given
        let org = Organization(
            id: "org_123",
            did: "did:example:org123",
            name: "Test Organization",
            ownerDID: "did:example:owner",
            settings: OrganizationSettings(),
            createdAt: Date(),
            updatedAt: Date()
        )

        let members = [
            OrganizationMember(
                id: "member_1",
                orgId: "org_123",
                memberDID: "did:example:member1",
                displayName: "Member 1",
                role: .admin,
                status: .active,
                joinedAt: Date()
            ),
            OrganizationMember(
                id: "member_2",
                orgId: "org_123",
                memberDID: "did:example:member2",
                displayName: "Member 2",
                role: .editor,
                status: .active,
                joinedAt: Date()
            )
        ]

        // When
        try await manager.syncOrganizationIdentities(org: org, members: members)

        // Then
        let orgIdentities = manager.getIdentitiesByOrg(orgId: "org_123")
        XCTAssertEqual(orgIdentities.count, 2)
    }

    // MARK: - Display Label Tests

    func testPersonalIdentityDisplayLabel() async throws {
        // Given
        let identity = try await manager.createIdentity(
            did: "did:example:personal",
            displayName: "Alice"
        )

        // Then
        XCTAssertEqual(identity.displayLabel, "Alice")
    }

    func testOrganizationIdentityDisplayLabel() async throws {
        // Given
        let identity = try await manager.createIdentity(
            did: "did:example:orgmember",
            displayName: "Bob",
            orgId: "org_123",
            orgName: "Acme Corp"
        )

        // Then
        XCTAssertEqual(identity.displayLabel, "Bob @ Acme Corp")
    }

    func testRoleDisplayName() async throws {
        // Given
        let identity = try await manager.createIdentity(
            did: "did:example:admin",
            displayName: "Admin User",
            orgId: "org_123",
            orgName: "Company",
            role: "admin"
        )

        // Then
        XCTAssertEqual(identity.roleDisplayName, "管理员")
    }

    // MARK: - Edge Cases

    func testNoIdentities() {
        // When
        let current = manager.getCurrentIdentity()
        let identities = manager.listIdentities()

        // Then
        XCTAssertNil(current)
        XCTAssertEqual(identities.count, 0)
    }

    func testIdentitySortedByLastUsed() async throws {
        // Given
        let first = try await manager.createIdentity(
            did: "did:example:first",
            displayName: "First"
        )

        let second = try await manager.createIdentity(
            did: "did:example:second",
            displayName: "Second"
        )

        let third = try await manager.createIdentity(
            did: "did:example:third",
            displayName: "Third"
        )

        // Use second, then third
        try await manager.switchIdentity(to: second)
        try await manager.switchIdentity(to: third)

        // When
        let identities = manager.listIdentities()

        // Then - Should be sorted by last used (third, second, first)
        XCTAssertEqual(identities[0].id, third.id)
        XCTAssertEqual(identities[1].id, second.id)
        XCTAssertEqual(identities[2].id, first.id)
    }

    // MARK: - Performance Tests

    func testManyIdentities() async throws {
        // When - Create 50 identities
        for i in 1...50 {
            _ = try await manager.createIdentity(
                did: "did:example:user\(i)",
                displayName: "User \(i)",
                orgId: i % 2 == 0 ? "org_even" : nil
            )
        }

        // Then
        let allIdentities = manager.listIdentities()
        let personalIdentities = manager.getPersonalIdentities()
        let orgIdentities = manager.getOrganizationIdentities()

        XCTAssertEqual(allIdentities.count, 50)
        XCTAssertEqual(personalIdentities.count, 25)
        XCTAssertEqual(orgIdentities.count, 25)
    }
}
