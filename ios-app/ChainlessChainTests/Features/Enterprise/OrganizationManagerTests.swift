import XCTest
import SQLite
@testable import ChainlessChain

@MainActor
final class OrganizationManagerTests: XCTestCase {

    var manager: OrganizationManager!
    var testDB: Connection!
    var rbacManager: RBACManager!

    override func setUp() async throws {
        try await super.setUp()

        // Create in-memory database for testing
        testDB = try Connection(.inMemory)

        // Initialize database tables
        try await EnterpriseDB.migrate(db: testDB)

        // Get manager instance and set test database
        manager = OrganizationManager.shared
        manager.setDatabase(testDB)

        // Initialize RBAC manager
        rbacManager = RBACManager.shared
        rbacManager.setDatabase(testDB)
    }

    override func tearDown() async throws {
        // Clean up test data
        try? await EnterpriseDB.dropAllTables(db: testDB)
        testDB = nil
        manager = nil
        rbacManager = nil

        try await super.tearDown()
    }

    // MARK: - Organization CRUD Tests

    func testCreateOrganization() async throws {
        // Given
        let ownerDID = "did:example:owner123"
        let settings = OrganizationSettings(
            allowPublicJoin: false,
            requireApproval: true,
            defaultMemberRole: .viewer
        )

        // When
        let org = try await manager.createOrganization(
            name: "Test Org",
            description: "Test Description",
            type: .company,
            visibility: .private,
            ownerDID: ownerDID,
            settings: settings
        )

        // Then
        XCTAssertFalse(org.id.isEmpty)
        XCTAssertEqual(org.name, "Test Org")
        XCTAssertEqual(org.description, "Test Description")
        XCTAssertEqual(org.type, .company)
        XCTAssertEqual(org.visibility, .private)
        XCTAssertEqual(org.ownerDID, ownerDID)

        // Verify owner is added as member
        let members = try await manager.getMembers(orgId: org.id)
        XCTAssertEqual(members.count, 1)
        XCTAssertEqual(members.first?.memberDID, ownerDID)
        XCTAssertEqual(members.first?.role, .owner)
    }

    func testCreateOrganizationWithDuplicateName() async throws {
        // Given
        let ownerDID = "did:example:owner123"
        let settings = OrganizationSettings()

        _ = try await manager.createOrganization(
            name: "Duplicate Org",
            ownerDID: ownerDID,
            settings: settings
        )

        // When/Then - Should not throw, as different orgs can have same name
        let org2 = try await manager.createOrganization(
            name: "Duplicate Org",
            ownerDID: ownerDID,
            settings: settings
        )

        XCTAssertNotEqual(org2.id, "")
    }

    func testUpdateOrganization() async throws {
        // Given
        let ownerDID = "did:example:owner123"
        let org = try await manager.createOrganization(
            name: "Original Name",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        // When
        try await manager.updateOrganization(
            orgId: org.id,
            name: "Updated Name",
            description: "Updated Description",
            avatar: "https://example.com/avatar.png"
        )

        // Then
        let updated = try await manager.getOrganization(orgId: org.id)
        XCTAssertEqual(updated?.name, "Updated Name")
        XCTAssertEqual(updated?.description, "Updated Description")
        XCTAssertEqual(updated?.avatar, "https://example.com/avatar.png")
    }

    func testDeleteOrganization() async throws {
        // Given
        let ownerDID = "did:example:owner123"
        let org = try await manager.createOrganization(
            name: "To Delete",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        // When
        try await manager.deleteOrganization(orgId: org.id, userDID: ownerDID)

        // Then
        let deleted = try await manager.getOrganization(orgId: org.id)
        XCTAssertNil(deleted)
    }

    func testDeleteOrganizationRequiresOwner() async throws {
        // Given
        let ownerDID = "did:example:owner123"
        let nonOwnerDID = "did:example:user456"

        let org = try await manager.createOrganization(
            name: "Protected Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        // When/Then
        do {
            try await manager.deleteOrganization(orgId: org.id, userDID: nonOwnerDID)
            XCTFail("Should require owner permission to delete")
        } catch {
            // Expected to throw
            XCTAssertTrue(error is OrganizationError)
        }
    }

    // MARK: - Member Management Tests

    func testAddMember() async throws {
        // Given
        let ownerDID = "did:example:owner123"
        let memberDID = "did:example:member456"

        let org = try await manager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        // When
        try await manager.addMember(
            orgId: org.id,
            memberDID: memberDID,
            displayName: "Test Member",
            role: .editor
        )

        // Then
        let members = try await manager.getMembers(orgId: org.id)
        XCTAssertEqual(members.count, 2) // Owner + new member

        let addedMember = members.first(where: { $0.memberDID == memberDID })
        XCTAssertNotNil(addedMember)
        XCTAssertEqual(addedMember?.displayName, "Test Member")
        XCTAssertEqual(addedMember?.role, .editor)
    }

    func testAddDuplicateMember() async throws {
        // Given
        let ownerDID = "did:example:owner123"
        let memberDID = "did:example:member456"

        let org = try await manager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        try await manager.addMember(
            orgId: org.id,
            memberDID: memberDID,
            displayName: "Test Member",
            role: .editor
        )

        // When/Then
        do {
            try await manager.addMember(
                orgId: org.id,
                memberDID: memberDID,
                displayName: "Duplicate Member",
                role: .viewer
            )
            XCTFail("Should not allow duplicate members")
        } catch {
            // Expected to throw
            XCTAssertTrue(error is OrganizationError)
        }
    }

    func testRemoveMember() async throws {
        // Given
        let ownerDID = "did:example:owner123"
        let memberDID = "did:example:member456"

        let org = try await manager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        try await manager.addMember(
            orgId: org.id,
            memberDID: memberDID,
            displayName: "Test Member",
            role: .editor
        )

        // When
        try await manager.removeMember(orgId: org.id, memberDID: memberDID)

        // Then
        let members = try await manager.getMembers(orgId: org.id)
        XCTAssertEqual(members.count, 1) // Only owner
        XCTAssertNil(members.first(where: { $0.memberDID == memberDID }))
    }

    func testCannotRemoveOwner() async throws {
        // Given
        let ownerDID = "did:example:owner123"

        let org = try await manager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        // When/Then
        do {
            try await manager.removeMember(orgId: org.id, memberDID: ownerDID)
            XCTFail("Should not allow removing owner")
        } catch {
            // Expected to throw
            XCTAssertTrue(error is OrganizationError)
        }
    }

    func testUpdateMemberRole() async throws {
        // Given
        let ownerDID = "did:example:owner123"
        let memberDID = "did:example:member456"

        let org = try await manager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        try await manager.addMember(
            orgId: org.id,
            memberDID: memberDID,
            displayName: "Test Member",
            role: .viewer
        )

        // When
        try await manager.updateMemberRole(
            orgId: org.id,
            memberDID: memberDID,
            newRole: .admin
        )

        // Then
        let members = try await manager.getMembers(orgId: org.id)
        let updatedMember = members.first(where: { $0.memberDID == memberDID })
        XCTAssertEqual(updatedMember?.role, .admin)
    }

    // MARK: - Invitation Tests

    func testCreateInvitation() async throws {
        // Given
        let ownerDID = "did:example:owner123"
        let org = try await manager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        let expireAt = Date().addingTimeInterval(86400 * 7) // 7 days

        // When
        let invitation = try await manager.createInvitation(
            orgId: org.id,
            role: .editor,
            maxUses: 10,
            expireAt: expireAt,
            userDID: ownerDID
        )

        // Then
        XCTAssertFalse(invitation.inviteCode.isEmpty)
        XCTAssertEqual(invitation.orgId, org.id)
        XCTAssertEqual(invitation.role, .editor)
        XCTAssertEqual(invitation.maxUses, 10)
        XCTAssertEqual(invitation.usedCount, 0)
        XCTAssertTrue(invitation.isValid)
    }

    func testJoinWithInvite() async throws {
        // Given
        let ownerDID = "did:example:owner123"
        let newMemberDID = "did:example:newmember789"

        let org = try await manager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        let invitation = try await manager.createInvitation(
            orgId: org.id,
            role: .editor,
            maxUses: 1,
            expireAt: nil,
            userDID: ownerDID
        )

        // When
        try await manager.joinWithInvite(
            inviteCode: invitation.inviteCode,
            memberDID: newMemberDID,
            displayName: "New Member"
        )

        // Then
        let members = try await manager.getMembers(orgId: org.id)
        XCTAssertEqual(members.count, 2)

        let newMember = members.first(where: { $0.memberDID == newMemberDID })
        XCTAssertNotNil(newMember)
        XCTAssertEqual(newMember?.role, .editor)

        // Verify invitation used count
        let invitations = try await manager.getInvitations(orgId: org.id)
        let usedInvite = invitations.first(where: { $0.id == invitation.id })
        XCTAssertEqual(usedInvite?.usedCount, 1)
        XCTAssertFalse(usedInvite?.isValid ?? true) // Should be invalid after max uses
    }

    func testJoinWithExpiredInvite() async throws {
        // Given
        let ownerDID = "did:example:owner123"
        let newMemberDID = "did:example:newmember789"

        let org = try await manager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        let expiredDate = Date().addingTimeInterval(-86400) // Yesterday
        let invitation = try await manager.createInvitation(
            orgId: org.id,
            role: .editor,
            maxUses: 10,
            expireAt: expiredDate,
            userDID: ownerDID
        )

        // When/Then
        do {
            try await manager.joinWithInvite(
                inviteCode: invitation.inviteCode,
                memberDID: newMemberDID,
                displayName: "New Member"
            )
            XCTFail("Should not allow joining with expired invite")
        } catch {
            // Expected to throw
            XCTAssertTrue(error is OrganizationError)
        }
    }

    func testJoinWithInvalidInviteCode() async throws {
        // Given
        let newMemberDID = "did:example:newmember789"

        // When/Then
        do {
            try await manager.joinWithInvite(
                inviteCode: "INVALID_CODE",
                memberDID: newMemberDID,
                displayName: "New Member"
            )
            XCTFail("Should not allow joining with invalid invite code")
        } catch {
            // Expected to throw
            XCTAssertTrue(error is OrganizationError)
        }
    }

    // MARK: - Activity Log Tests

    func testActivityLogging() async throws {
        // Given
        let ownerDID = "did:example:owner123"
        let org = try await manager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        // Add some activities
        try await manager.addMember(
            orgId: org.id,
            memberDID: "did:example:member1",
            displayName: "Member 1",
            role: .editor
        )

        try await manager.addMember(
            orgId: org.id,
            memberDID: "did:example:member2",
            displayName: "Member 2",
            role: .viewer
        )

        // When
        let activities = try await manager.getActivities(orgId: org.id, limit: 10)

        // Then
        XCTAssertGreaterThanOrEqual(activities.count, 2)

        // Verify activity types
        let addMemberActivities = activities.filter { $0.action == .addMember }
        XCTAssertEqual(addMemberActivities.count, 2)
    }

    // MARK: - Load Organizations Tests

    func testLoadOrganizations() async throws {
        // Given
        let ownerDID = "did:example:owner123"

        _ = try await manager.createOrganization(
            name: "Org 1",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        _ = try await manager.createOrganization(
            name: "Org 2",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        // When
        try await manager.loadOrganizations()

        // Then
        XCTAssertEqual(manager.organizations.count, 2)
    }

    // MARK: - Edge Cases

    func testGetNonExistentOrganization() async throws {
        // When
        let org = try await manager.getOrganization(orgId: "non_existent_id")

        // Then
        XCTAssertNil(org)
    }

    func testGetMembersOfNonExistentOrganization() async throws {
        // When/Then
        do {
            _ = try await manager.getMembers(orgId: "non_existent_id")
            XCTFail("Should throw error for non-existent organization")
        } catch {
            // Expected to throw
            XCTAssertTrue(error is OrganizationError)
        }
    }

    func testEmptyOrganizationName() async throws {
        // Given
        let ownerDID = "did:example:owner123"

        // When/Then
        do {
            _ = try await manager.createOrganization(
                name: "",
                ownerDID: ownerDID,
                settings: OrganizationSettings()
            )
            XCTFail("Should not allow empty organization name")
        } catch {
            // Expected to throw
            XCTAssertTrue(error is OrganizationError)
        }
    }

    // MARK: - Performance Tests

    func testBulkMemberCreation() async throws {
        // Given
        let ownerDID = "did:example:owner123"
        let org = try await manager.createOrganization(
            name: "Large Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        // When - Add 100 members
        for i in 1...100 {
            try await manager.addMember(
                orgId: org.id,
                memberDID: "did:example:member\(i)",
                displayName: "Member \(i)",
                role: .viewer
            )
        }

        // Then
        let members = try await manager.getMembers(orgId: org.id)
        XCTAssertEqual(members.count, 101) // 100 members + owner
    }
}
