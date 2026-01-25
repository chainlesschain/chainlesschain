import XCTest
import SQLite
@testable import ChainlessChain

@MainActor
final class WorkspaceManagerTests: XCTestCase {

    var manager: WorkspaceManager!
    var orgManager: OrganizationManager!
    var testDB: Connection!
    var testOrgId: String!
    var testUserDID: String!

    override func setUp() async throws {
        try await super.setUp()

        // Create in-memory database for testing
        testDB = try Connection(.inMemory)

        // Initialize database tables
        try await EnterpriseDB.migrate(db: testDB)

        // Get manager instances
        manager = WorkspaceManager.shared
        manager.setDatabase(testDB)

        orgManager = OrganizationManager.shared
        orgManager.setDatabase(testDB)

        // Create test organization
        testUserDID = "did:example:testuser123"
        let org = try await orgManager.createOrganization(
            name: "Test Organization",
            ownerDID: testUserDID,
            settings: OrganizationSettings()
        )
        testOrgId = org.id
    }

    override func tearDown() async throws {
        try? await EnterpriseDB.dropAllTables(db: testDB)
        testDB = nil
        manager = nil
        orgManager = nil
        testOrgId = nil
        testUserDID = nil

        try await super.tearDown()
    }

    // MARK: - Workspace CRUD Tests

    func testCreateWorkspace() async throws {
        // When
        let workspace = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "Development",
            description: "Dev workspace",
            type: .development,
            color: "#1890ff",
            icon: "hammer",
            visibility: .members,
            allowedRoles: [],
            creatorDID: testUserDID
        )

        // Then
        XCTAssertFalse(workspace.id.isEmpty)
        XCTAssertEqual(workspace.name, "Development")
        XCTAssertEqual(workspace.description, "Dev workspace")
        XCTAssertEqual(workspace.type, .development)
        XCTAssertEqual(workspace.color, "#1890ff")
        XCTAssertEqual(workspace.icon, "hammer")
        XCTAssertEqual(workspace.visibility, .members)
        XCTAssertFalse(workspace.archived)

        // Verify creator is added as owner
        let members = try await manager.getWorkspaceMembers(workspaceId: workspace.id)
        XCTAssertEqual(members.count, 1)
        XCTAssertEqual(members.first?.memberDID, testUserDID)
        XCTAssertEqual(members.first?.role, .owner)
    }

    func testCreateDefaultWorkspace() async throws {
        // When
        let workspace = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "Default Workspace",
            type: .default,
            creatorDID: testUserDID
        )

        // Then
        XCTAssertTrue(workspace.isDefault)
    }

    func testUpdateWorkspace() async throws {
        // Given
        let workspace = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "Original Name",
            creatorDID: testUserDID
        )

        // When
        try await manager.updateWorkspace(
            workspaceId: workspace.id,
            name: "Updated Name",
            description: "Updated Description",
            color: "#ff0000",
            icon: "folder.fill"
        )

        // Then
        let updated = try await manager.getWorkspace(workspaceId: workspace.id)
        XCTAssertEqual(updated?.name, "Updated Name")
        XCTAssertEqual(updated?.description, "Updated Description")
        XCTAssertEqual(updated?.color, "#ff0000")
        XCTAssertEqual(updated?.icon, "folder.fill")
    }

    func testDeleteWorkspace() async throws {
        // Given
        let workspace = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "To Delete",
            creatorDID: testUserDID
        )

        // When
        try await manager.deleteWorkspace(
            workspaceId: workspace.id,
            userDID: testUserDID
        )

        // Then
        let deleted = try await manager.getWorkspace(workspaceId: workspace.id)
        XCTAssertNil(deleted)
    }

    func testCannotDeleteDefaultWorkspace() async throws {
        // Given
        let workspace = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "Default",
            type: .default,
            creatorDID: testUserDID
        )

        // When/Then
        do {
            try await manager.deleteWorkspace(
                workspaceId: workspace.id,
                userDID: testUserDID
            )
            XCTFail("Should not allow deleting default workspace")
        } catch {
            XCTAssertTrue(error is WorkspaceError)
        }
    }

    func testArchiveWorkspace() async throws {
        // Given
        let workspace = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "To Archive",
            creatorDID: testUserDID
        )

        // When
        try await manager.archiveWorkspace(
            workspaceId: workspace.id,
            userDID: testUserDID
        )

        // Then
        let archived = try await manager.getWorkspace(workspaceId: workspace.id)
        XCTAssertTrue(archived?.archived ?? false)
    }

    func testUnarchiveWorkspace() async throws {
        // Given
        let workspace = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "Archived",
            creatorDID: testUserDID
        )

        try await manager.archiveWorkspace(
            workspaceId: workspace.id,
            userDID: testUserDID
        )

        // When
        try await manager.unarchiveWorkspace(
            workspaceId: workspace.id,
            userDID: testUserDID
        )

        // Then
        let unarchived = try await manager.getWorkspace(workspaceId: workspace.id)
        XCTAssertFalse(unarchived?.archived ?? true)
    }

    // MARK: - Member Management Tests

    func testAddWorkspaceMember() async throws {
        // Given
        let workspace = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "Team Workspace",
            creatorDID: testUserDID
        )

        let memberDID = "did:example:member456"

        // When
        try await manager.addWorkspaceMember(
            workspaceId: workspace.id,
            memberDID: memberDID,
            displayName: "Team Member",
            role: .member
        )

        // Then
        let members = try await manager.getWorkspaceMembers(workspaceId: workspace.id)
        XCTAssertEqual(members.count, 2)

        let addedMember = members.first(where: { $0.memberDID == memberDID })
        XCTAssertNotNil(addedMember)
        XCTAssertEqual(addedMember?.displayName, "Team Member")
        XCTAssertEqual(addedMember?.role, .member)
    }

    func testRemoveWorkspaceMember() async throws {
        // Given
        let workspace = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "Team Workspace",
            creatorDID: testUserDID
        )

        let memberDID = "did:example:member456"
        try await manager.addWorkspaceMember(
            workspaceId: workspace.id,
            memberDID: memberDID,
            displayName: "Team Member",
            role: .member
        )

        // When
        try await manager.removeWorkspaceMember(
            workspaceId: workspace.id,
            memberDID: memberDID
        )

        // Then
        let members = try await manager.getWorkspaceMembers(workspaceId: workspace.id)
        XCTAssertEqual(members.count, 1) // Only owner
        XCTAssertNil(members.first(where: { $0.memberDID == memberDID }))
    }

    func testUpdateWorkspaceMemberRole() async throws {
        // Given
        let workspace = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "Team Workspace",
            creatorDID: testUserDID
        )

        let memberDID = "did:example:member456"
        try await manager.addWorkspaceMember(
            workspaceId: workspace.id,
            memberDID: memberDID,
            displayName: "Team Member",
            role: .member
        )

        // When
        try await manager.updateWorkspaceMemberRole(
            workspaceId: workspace.id,
            memberDID: memberDID,
            newRole: .admin
        )

        // Then
        let members = try await manager.getWorkspaceMembers(workspaceId: workspace.id)
        let updatedMember = members.first(where: { $0.memberDID == memberDID })
        XCTAssertEqual(updatedMember?.role, .admin)
    }

    // MARK: - Resource Management Tests

    func testAddResource() async throws {
        // Given
        let workspace = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "Project Workspace",
            creatorDID: testUserDID
        )

        // When
        try await manager.addResource(
            workspaceId: workspace.id,
            resourceType: .note,
            resourceId: "note_123",
            resourceName: "Project Plan",
            userDID: testUserDID
        )

        // Then
        let resources = try await manager.getWorkspaceResources(workspaceId: workspace.id)
        XCTAssertEqual(resources.count, 1)

        let resource = resources.first
        XCTAssertEqual(resource?.resourceType, .note)
        XCTAssertEqual(resource?.resourceId, "note_123")
        XCTAssertEqual(resource?.resourceName, "Project Plan")
    }

    func testAddMultipleResourceTypes() async throws {
        // Given
        let workspace = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "Multi Resource",
            creatorDID: testUserDID
        )

        // When
        try await manager.addResource(
            workspaceId: workspace.id,
            resourceType: .note,
            resourceId: "note_1",
            resourceName: "Note 1",
            userDID: testUserDID
        )

        try await manager.addResource(
            workspaceId: workspace.id,
            resourceType: .project,
            resourceId: "project_1",
            resourceName: "Project 1",
            userDID: testUserDID
        )

        try await manager.addResource(
            workspaceId: workspace.id,
            resourceType: .file,
            resourceId: "file_1",
            resourceName: "File 1",
            userDID: testUserDID
        )

        // Then
        let resources = try await manager.getWorkspaceResources(workspaceId: workspace.id)
        XCTAssertEqual(resources.count, 3)

        let resourceTypes = Set(resources.map { $0.resourceType })
        XCTAssertTrue(resourceTypes.contains(.note))
        XCTAssertTrue(resourceTypes.contains(.project))
        XCTAssertTrue(resourceTypes.contains(.file))
    }

    func testRemoveResource() async throws {
        // Given
        let workspace = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "Project Workspace",
            creatorDID: testUserDID
        )

        try await manager.addResource(
            workspaceId: workspace.id,
            resourceType: .note,
            resourceId: "note_123",
            resourceName: "Project Plan",
            userDID: testUserDID
        )

        // When
        try await manager.removeResource(
            workspaceId: workspace.id,
            resourceId: "note_123",
            userDID: testUserDID
        )

        // Then
        let resources = try await manager.getWorkspaceResources(workspaceId: workspace.id)
        XCTAssertEqual(resources.count, 0)
    }

    // MARK: - Visibility & Access Control Tests

    func testVisibilityMembers() async throws {
        // Given
        let workspace = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "Public Workspace",
            visibility: .members,
            creatorDID: testUserDID
        )

        let memberDID = "did:example:member456"

        // Add member to organization
        try await orgManager.addMember(
            orgId: testOrgId,
            memberDID: memberDID,
            displayName: "Org Member",
            role: .viewer
        )

        // When
        let canAccess = try await manager.canAccessWorkspace(
            workspaceId: workspace.id,
            userDID: memberDID
        )

        // Then
        XCTAssertTrue(canAccess)
    }

    func testVisibilityAdmins() async throws {
        // Given
        let workspace = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "Admin Only",
            visibility: .admins,
            creatorDID: testUserDID
        )

        let regularMemberDID = "did:example:member456"
        let adminDID = "did:example:admin789"

        // Add regular member
        try await orgManager.addMember(
            orgId: testOrgId,
            memberDID: regularMemberDID,
            displayName: "Regular Member",
            role: .viewer
        )

        // Add admin
        try await orgManager.addMember(
            orgId: testOrgId,
            memberDID: adminDID,
            displayName: "Admin",
            role: .admin
        )

        // When
        let regularCanAccess = try await manager.canAccessWorkspace(
            workspaceId: workspace.id,
            userDID: regularMemberDID
        )

        let adminCanAccess = try await manager.canAccessWorkspace(
            workspaceId: workspace.id,
            userDID: adminDID
        )

        // Then
        XCTAssertFalse(regularCanAccess)
        XCTAssertTrue(adminCanAccess)
    }

    // MARK: - Activity Log Tests

    func testActivityLogging() async throws {
        // Given
        let workspace = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "Activity Test",
            creatorDID: testUserDID
        )

        // Add some activities
        try await manager.addResource(
            workspaceId: workspace.id,
            resourceType: .note,
            resourceId: "note_1",
            resourceName: "Note 1",
            userDID: testUserDID
        )

        try await manager.addWorkspaceMember(
            workspaceId: workspace.id,
            memberDID: "did:example:member456",
            displayName: "Member",
            role: .member
        )

        // When
        let activities = try await manager.getWorkspaceActivities(
            workspaceId: workspace.id,
            limit: 10
        )

        // Then
        XCTAssertGreaterThanOrEqual(activities.count, 2)

        let resourceActivity = activities.first(where: { $0.action == .addResource })
        XCTAssertNotNil(resourceActivity)

        let memberActivity = activities.first(where: { $0.action == .addMember })
        XCTAssertNotNil(memberActivity)
    }

    // MARK: - Query Tests

    func testGetWorkspaces() async throws {
        // Given
        _ = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "Workspace 1",
            type: .development,
            creatorDID: testUserDID
        )

        _ = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "Workspace 2",
            type: .testing,
            creatorDID: testUserDID
        )

        // When
        let workspaces = try await manager.getWorkspaces(orgId: testOrgId)

        // Then
        XCTAssertEqual(workspaces.count, 2)
    }

    func testGetWorkspacesByType() async throws {
        // Given
        _ = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "Dev 1",
            type: .development,
            creatorDID: testUserDID
        )

        _ = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "Dev 2",
            type: .development,
            creatorDID: testUserDID
        )

        _ = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "Test 1",
            type: .testing,
            creatorDID: testUserDID
        )

        // When
        let allWorkspaces = try await manager.getWorkspaces(orgId: testOrgId)
        let devWorkspaces = allWorkspaces.filter { $0.type == .development }

        // Then
        XCTAssertEqual(allWorkspaces.count, 3)
        XCTAssertEqual(devWorkspaces.count, 2)
    }

    // MARK: - Edge Cases

    func testGetNonExistentWorkspace() async throws {
        // When
        let workspace = try await manager.getWorkspace(workspaceId: "non_existent_id")

        // Then
        XCTAssertNil(workspace)
    }

    func testAddResourceToNonExistentWorkspace() async throws {
        // When/Then
        do {
            try await manager.addResource(
                workspaceId: "non_existent_id",
                resourceType: .note,
                resourceId: "note_1",
                resourceName: "Note",
                userDID: testUserDID
            )
            XCTFail("Should throw error for non-existent workspace")
        } catch {
            XCTAssertTrue(error is WorkspaceError)
        }
    }

    func testEmptyWorkspaceName() async throws {
        // When/Then
        do {
            _ = try await manager.createWorkspace(
                orgId: testOrgId,
                name: "",
                creatorDID: testUserDID
            )
            XCTFail("Should not allow empty workspace name")
        } catch {
            XCTAssertTrue(error is WorkspaceError)
        }
    }

    // MARK: - Performance Tests

    func testBulkResourceCreation() async throws {
        // Given
        let workspace = try await manager.createWorkspace(
            orgId: testOrgId,
            name: "Large Workspace",
            creatorDID: testUserDID
        )

        // When - Add 50 resources
        for i in 1...50 {
            try await manager.addResource(
                workspaceId: workspace.id,
                resourceType: .note,
                resourceId: "note_\(i)",
                resourceName: "Note \(i)",
                userDID: testUserDID
            )
        }

        // Then
        let resources = try await manager.getWorkspaceResources(workspaceId: workspace.id)
        XCTAssertEqual(resources.count, 50)
    }

    func testMultipleWorkspacesPerOrganization() async throws {
        // When - Create 20 workspaces
        for i in 1...20 {
            _ = try await manager.createWorkspace(
                orgId: testOrgId,
                name: "Workspace \(i)",
                type: i % 2 == 0 ? .development : .testing,
                creatorDID: testUserDID
            )
        }

        // Then
        let workspaces = try await manager.getWorkspaces(orgId: testOrgId)
        XCTAssertEqual(workspaces.count, 20)
    }
}
