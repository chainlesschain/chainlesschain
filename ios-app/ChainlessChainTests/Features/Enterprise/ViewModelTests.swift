import XCTest
import SQLite
@testable import ChainlessChain

@MainActor
final class ViewModelTests: XCTestCase {

    var testDB: Connection!
    var orgManager: OrganizationManager!
    var workspaceManager: WorkspaceManager!
    var identityManager: IdentityManager!

    override func setUp() async throws {
        try await super.setUp()

        // Create in-memory database for testing
        testDB = try Connection(.inMemory)

        // Initialize database tables
        try await EnterpriseDB.migrate(db: testDB)

        // Get manager instances
        orgManager = OrganizationManager.shared
        orgManager.setDatabase(testDB)

        workspaceManager = WorkspaceManager.shared
        workspaceManager.setDatabase(testDB)

        identityManager = IdentityManager.shared
        identityManager.setDatabase(testDB)
        try await identityManager.initialize()
    }

    override func tearDown() async throws {
        try? await EnterpriseDB.dropAllTables(db: testDB)
        testDB = nil
        orgManager = nil
        workspaceManager = nil
        identityManager = nil

        try await super.tearDown()
    }

    // MARK: - OrganizationViewModel Tests

    func testOrganizationViewModelLoadOrganizations() async throws {
        // Given
        let viewModel = OrganizationViewModel()
        let ownerDID = "did:example:owner123"

        _ = try await orgManager.createOrganization(
            name: "Org 1",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        _ = try await orgManager.createOrganization(
            name: "Org 2",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        // When
        await viewModel.loadOrganizations()

        // Then
        XCTAssertEqual(viewModel.organizations.count, 2)
        XCTAssertFalse(viewModel.isLoading)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testOrganizationViewModelCreateOrganization() async throws {
        // Given
        let viewModel = OrganizationViewModel()
        let ownerDID = "did:example:owner123"

        // When
        await viewModel.createOrganization(
            name: "New Org",
            description: "Test Description",
            type: .company,
            visibility: .private,
            ownerDID: ownerDID
        )

        // Then
        XCTAssertNotNil(viewModel.currentOrganization)
        XCTAssertEqual(viewModel.currentOrganization?.name, "New Org")
        XCTAssertNotNil(viewModel.successMessage)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testOrganizationViewModelUpdateOrganization() async throws {
        // Given
        let viewModel = OrganizationViewModel()
        let ownerDID = "did:example:owner123"

        let org = try await orgManager.createOrganization(
            name: "Original Name",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        // When
        await viewModel.updateOrganization(
            orgId: org.id,
            name: "Updated Name",
            description: "Updated Description"
        )

        // Then
        XCTAssertNotNil(viewModel.successMessage)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testOrganizationViewModelDeleteOrganization() async throws {
        // Given
        let viewModel = OrganizationViewModel()
        let ownerDID = "did:example:owner123"

        let org = try await orgManager.createOrganization(
            name: "To Delete",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        viewModel.currentOrganization = org

        // When
        await viewModel.deleteOrganization(orgId: org.id, userDID: ownerDID)

        // Then
        XCTAssertNil(viewModel.currentOrganization)
        XCTAssertNotNil(viewModel.successMessage)
    }

    func testOrganizationViewModelAddMember() async throws {
        // Given
        let viewModel = OrganizationViewModel()
        let ownerDID = "did:example:owner123"
        let memberDID = "did:example:member456"

        let org = try await orgManager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        // When
        await viewModel.addMember(
            orgId: org.id,
            memberDID: memberDID,
            displayName: "Test Member",
            role: .editor
        )

        // Then
        XCTAssertNotNil(viewModel.successMessage)
        XCTAssertNil(viewModel.errorMessage)
    }

    func testOrganizationViewModelCreateInvitation() async throws {
        // Given
        let viewModel = OrganizationViewModel()
        let ownerDID = "did:example:owner123"

        // Create test identity
        _ = try await identityManager.createIdentity(
            did: ownerDID,
            displayName: "Owner"
        )

        let org = try await orgManager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        // When
        let invitation = await viewModel.createInvitation(
            orgId: org.id,
            role: .editor,
            maxUses: 10,
            expiresInDays: 7,
            userDID: ownerDID
        )

        // Then
        XCTAssertNotNil(invitation)
        XCTAssertEqual(invitation?.role, .editor)
        XCTAssertNotNil(viewModel.successMessage)
    }

    func testOrganizationViewModelJoinWithInvite() async throws {
        // Given
        let viewModel = OrganizationViewModel()
        let ownerDID = "did:example:owner123"
        let newMemberDID = "did:example:newmember789"

        // Create test identity
        _ = try await identityManager.createIdentity(
            did: newMemberDID,
            displayName: "New Member"
        )

        let org = try await orgManager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        let invitation = try await orgManager.createInvitation(
            orgId: org.id,
            role: .editor,
            maxUses: 1,
            expireAt: nil,
            userDID: ownerDID
        )

        // When
        let success = await viewModel.joinWithInvite(
            inviteCode: invitation.inviteCode,
            memberDID: newMemberDID,
            displayName: "New Member"
        )

        // Then
        XCTAssertTrue(success)
        XCTAssertNotNil(viewModel.successMessage)
    }

    func testOrganizationViewModelSearchOrganizations() async throws {
        // Given
        let viewModel = OrganizationViewModel()
        let ownerDID = "did:example:owner123"

        _ = try await orgManager.createOrganization(
            name: "Apple Inc",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        _ = try await orgManager.createOrganization(
            name: "Google LLC",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        _ = try await orgManager.createOrganization(
            name: "Microsoft Corp",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        await viewModel.loadOrganizations()

        // When
        let appleResults = viewModel.searchOrganizations(query: "Apple")
        let allResults = viewModel.searchOrganizations(query: "")

        // Then
        XCTAssertEqual(appleResults.count, 1)
        XCTAssertEqual(allResults.count, 3)
    }

    func testOrganizationViewModelFilterByType() async throws {
        // Given
        let viewModel = OrganizationViewModel()
        let ownerDID = "did:example:owner123"

        _ = try await orgManager.createOrganization(
            name: "Startup 1",
            type: .startup,
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        _ = try await orgManager.createOrganization(
            name: "Company 1",
            type: .company,
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        await viewModel.loadOrganizations()

        // When
        let startups = viewModel.filterOrganizations(by: .startup)

        // Then
        XCTAssertEqual(startups.count, 1)
        XCTAssertEqual(startups.first?.type, .startup)
    }

    func testOrganizationViewModelClearMessages() {
        // Given
        let viewModel = OrganizationViewModel()
        viewModel.errorMessage = "Error"
        viewModel.successMessage = "Success"

        // When
        viewModel.clearMessages()

        // Then
        XCTAssertNil(viewModel.errorMessage)
        XCTAssertNil(viewModel.successMessage)
    }

    // MARK: - WorkspaceViewModel Tests

    func testWorkspaceViewModelLoadWorkspaces() async throws {
        // Given
        let viewModel = WorkspaceViewModel()
        let ownerDID = "did:example:owner123"

        let org = try await orgManager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        _ = try await workspaceManager.createWorkspace(
            orgId: org.id,
            name: "Workspace 1",
            creatorDID: ownerDID
        )

        _ = try await workspaceManager.createWorkspace(
            orgId: org.id,
            name: "Workspace 2",
            creatorDID: ownerDID
        )

        // When
        await viewModel.loadWorkspaces(orgId: org.id)

        // Then
        XCTAssertEqual(viewModel.workspaces.count, 2)
        XCTAssertFalse(viewModel.isLoading)
    }

    func testWorkspaceViewModelCreateWorkspace() async throws {
        // Given
        let viewModel = WorkspaceViewModel()
        let ownerDID = "did:example:owner123"

        // Create test identity
        _ = try await identityManager.createIdentity(
            did: ownerDID,
            displayName: "Owner"
        )

        let org = try await orgManager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        // When
        await viewModel.createWorkspace(
            orgId: org.id,
            name: "New Workspace",
            description: "Test Description",
            type: .development,
            color: "#1890ff",
            icon: "hammer",
            visibility: .members,
            allowedRoles: [],
            creatorDID: ownerDID
        )

        // Then
        XCTAssertNotNil(viewModel.currentWorkspace)
        XCTAssertEqual(viewModel.currentWorkspace?.name, "New Workspace")
        XCTAssertNotNil(viewModel.successMessage)
    }

    func testWorkspaceViewModelUpdateWorkspace() async throws {
        // Given
        let viewModel = WorkspaceViewModel()
        let ownerDID = "did:example:owner123"

        let org = try await orgManager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        let workspace = try await workspaceManager.createWorkspace(
            orgId: org.id,
            name: "Original Name",
            creatorDID: ownerDID
        )

        // When
        await viewModel.updateWorkspace(
            workspaceId: workspace.id,
            name: "Updated Name",
            description: "Updated Description"
        )

        // Then
        XCTAssertNotNil(viewModel.successMessage)
    }

    func testWorkspaceViewModelArchiveWorkspace() async throws {
        // Given
        let viewModel = WorkspaceViewModel()
        let ownerDID = "did:example:owner123"

        // Create test identity
        _ = try await identityManager.createIdentity(
            did: ownerDID,
            displayName: "Owner"
        )

        let org = try await orgManager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        let workspace = try await workspaceManager.createWorkspace(
            orgId: org.id,
            name: "To Archive",
            creatorDID: ownerDID
        )

        // When
        await viewModel.archiveWorkspace(
            workspaceId: workspace.id,
            userDID: ownerDID
        )

        // Then
        XCTAssertNotNil(viewModel.successMessage)
    }

    func testWorkspaceViewModelAddMember() async throws {
        // Given
        let viewModel = WorkspaceViewModel()
        let ownerDID = "did:example:owner123"
        let memberDID = "did:example:member456"

        let org = try await orgManager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        let workspace = try await workspaceManager.createWorkspace(
            orgId: org.id,
            name: "Team Workspace",
            creatorDID: ownerDID
        )

        // When
        await viewModel.addMember(
            workspaceId: workspace.id,
            memberDID: memberDID,
            displayName: "Team Member",
            role: .member
        )

        // Then
        XCTAssertNotNil(viewModel.successMessage)
    }

    func testWorkspaceViewModelAddResource() async throws {
        // Given
        let viewModel = WorkspaceViewModel()
        let ownerDID = "did:example:owner123"

        // Create test identity
        _ = try await identityManager.createIdentity(
            did: ownerDID,
            displayName: "Owner"
        )

        let org = try await orgManager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        let workspace = try await workspaceManager.createWorkspace(
            orgId: org.id,
            name: "Project Workspace",
            creatorDID: ownerDID
        )

        // When
        await viewModel.addResource(
            workspaceId: workspace.id,
            resourceType: .note,
            resourceId: "note_123",
            resourceName: "Project Plan",
            userDID: ownerDID
        )

        // Then
        XCTAssertNotNil(viewModel.successMessage)
    }

    func testWorkspaceViewModelSearchWorkspaces() async throws {
        // Given
        let viewModel = WorkspaceViewModel()
        let ownerDID = "did:example:owner123"

        let org = try await orgManager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        _ = try await workspaceManager.createWorkspace(
            orgId: org.id,
            name: "Development Environment",
            creatorDID: ownerDID
        )

        _ = try await workspaceManager.createWorkspace(
            orgId: org.id,
            name: "Production Server",
            creatorDID: ownerDID
        )

        await viewModel.loadWorkspaces(orgId: org.id)

        // When
        let devResults = viewModel.searchWorkspaces(query: "Development")
        let allResults = viewModel.searchWorkspaces(query: "")

        // Then
        XCTAssertEqual(devResults.count, 1)
        XCTAssertEqual(allResults.count, 2)
    }

    func testWorkspaceViewModelFilterByType() async throws {
        // Given
        let viewModel = WorkspaceViewModel()
        let ownerDID = "did:example:owner123"

        let org = try await orgManager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        _ = try await workspaceManager.createWorkspace(
            orgId: org.id,
            name: "Dev 1",
            type: .development,
            creatorDID: ownerDID
        )

        _ = try await workspaceManager.createWorkspace(
            orgId: org.id,
            name: "Test 1",
            type: .testing,
            creatorDID: ownerDID
        )

        await viewModel.loadWorkspaces(orgId: org.id)

        // When
        let devWorkspaces = viewModel.filterWorkspaces(by: .development)

        // Then
        XCTAssertEqual(devWorkspaces.count, 1)
        XCTAssertEqual(devWorkspaces.first?.type, .development)
    }

    func testWorkspaceViewModelGetActiveWorkspaces() async throws {
        // Given
        let viewModel = WorkspaceViewModel()
        let ownerDID = "did:example:owner123"

        let org = try await orgManager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        let active = try await workspaceManager.createWorkspace(
            orgId: org.id,
            name: "Active",
            creatorDID: ownerDID
        )

        let archived = try await workspaceManager.createWorkspace(
            orgId: org.id,
            name: "Archived",
            creatorDID: ownerDID
        )

        try await workspaceManager.archiveWorkspace(
            workspaceId: archived.id,
            userDID: ownerDID
        )

        await viewModel.loadWorkspaces(orgId: org.id)

        // When
        let activeWorkspaces = viewModel.getActiveWorkspaces()
        let archivedWorkspaces = viewModel.getArchivedWorkspaces()

        // Then
        XCTAssertEqual(activeWorkspaces.count, 1)
        XCTAssertEqual(archivedWorkspaces.count, 1)
        XCTAssertEqual(activeWorkspaces.first?.id, active.id)
        XCTAssertEqual(archivedWorkspaces.first?.id, archived.id)
    }

    func testWorkspaceViewModelGetDefaultWorkspace() async throws {
        // Given
        let viewModel = WorkspaceViewModel()
        let ownerDID = "did:example:owner123"

        let org = try await orgManager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        _ = try await workspaceManager.createWorkspace(
            orgId: org.id,
            name: "Regular",
            type: .development,
            creatorDID: ownerDID
        )

        let defaultWorkspace = try await workspaceManager.createWorkspace(
            orgId: org.id,
            name: "Default",
            type: .default,
            creatorDID: ownerDID
        )

        await viewModel.loadWorkspaces(orgId: org.id)

        // When
        let found = viewModel.getDefaultWorkspace()

        // Then
        XCTAssertNotNil(found)
        XCTAssertEqual(found?.id, defaultWorkspace.id)
        XCTAssertTrue(found?.isDefault ?? false)
    }

    // MARK: - ViewModel Integration Tests

    func testViewModelErrorHandling() async throws {
        // Given
        let viewModel = OrganizationViewModel()

        // When - Try to update non-existent organization
        await viewModel.updateOrganization(
            orgId: "non_existent_id",
            name: "New Name"
        )

        // Then
        XCTAssertNotNil(viewModel.errorMessage)
        XCTAssertNil(viewModel.successMessage)
    }

    func testViewModelLoadingState() async throws {
        // Given
        let viewModel = OrganizationViewModel()
        let ownerDID = "did:example:owner123"

        _ = try await orgManager.createOrganization(
            name: "Test Org",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        // When
        let loadTask = Task {
            await viewModel.loadOrganizations()
        }

        // Then - Check loading state (may be brief)
        await loadTask.value
        XCTAssertFalse(viewModel.isLoading)
    }

    func testViewModelPublishedPropertiesUpdate() async throws {
        // Given
        let viewModel = OrganizationViewModel()
        let ownerDID = "did:example:owner123"

        var organizationCountChanges: [Int] = []
        let cancellable = viewModel.$organizations
            .sink { orgs in
                organizationCountChanges.append(orgs.count)
            }

        // When
        _ = try await orgManager.createOrganization(
            name: "Org 1",
            ownerDID: ownerDID,
            settings: OrganizationSettings()
        )

        await viewModel.loadOrganizations()

        // Then
        XCTAssertGreaterThan(organizationCountChanges.count, 1)
        cancellable.cancel()
    }
}
