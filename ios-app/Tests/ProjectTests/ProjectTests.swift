import XCTest
import SQLite3
@testable import ChainlessChain
@testable import CoreCommon

final class ProjectTests: XCTestCase {

    var projectManager: ProjectManager!
    var projectRepository: ProjectRepository!

    override func setUp() async throws {
        try await super.setUp()
        // Initialize shared instances for testing
        projectManager = ProjectManager.shared
        projectRepository = ProjectRepository.shared
    }

    override func tearDown() async throws {
        // Clean up test data
        for project in projectManager.projects {
            try? projectManager.deleteProject(projectId: project.id)
        }
        try await super.tearDown()
    }

    // MARK: - Project Creation Tests

    func testCreateProject() async throws {
        let project = try await MainActor.run {
            try projectManager.createProject(
                name: "Test Project",
                description: "A test project",
                type: .document,
                tags: ["test", "unit-test"]
            )
        }

        XCTAssertNotNil(project)
        XCTAssertEqual(project.name, "Test Project")
        XCTAssertEqual(project.description, "A test project")
        XCTAssertEqual(project.type, .document)
        XCTAssertEqual(project.status, .active)
    }

    func testCreateProjectWithEmptyName() async throws {
        await MainActor.run {
            XCTAssertThrowsError(try projectManager.createProject(name: "")) { error in
                XCTAssertTrue(error is ProjectError)
            }
        }
    }

    func testCreateProjectWithWhitespaceName() async throws {
        await MainActor.run {
            XCTAssertThrowsError(try projectManager.createProject(name: "   ")) { error in
                XCTAssertTrue(error is ProjectError)
            }
        }
    }

    func testCreateProjectWithLongName() async throws {
        let longName = String(repeating: "a", count: 150)
        await MainActor.run {
            XCTAssertThrowsError(try projectManager.createProject(name: longName)) { error in
                XCTAssertTrue(error is ProjectError)
            }
        }
    }

    func testCreateProjectWithAllTypes() async throws {
        let types: [ProjectType] = [.document, .code, .web, .app, .design, .other]

        for type in types {
            let project = try await MainActor.run {
                try projectManager.createProject(
                    name: "Project \(type.displayName)",
                    type: type
                )
            }
            XCTAssertEqual(project.type, type)
        }
    }

    // MARK: - Project Update Tests

    func testUpdateProject() async throws {
        let project = try await MainActor.run {
            try projectManager.createProject(name: "Original Name")
        }

        var updatedProject = project
        updatedProject.name = "Updated Name"
        updatedProject.description = "Updated description"

        try await MainActor.run {
            try projectManager.updateProject(updatedProject)
        }

        await MainActor.run {
            projectManager.loadProjects()
        }

        let found = await MainActor.run {
            projectManager.projects.first { $0.id == project.id }
        }

        XCTAssertNotNil(found)
        XCTAssertEqual(found?.name, "Updated Name")
        XCTAssertEqual(found?.description, "Updated description")
    }

    func testUpdateProjectStatus() async throws {
        let project = try await MainActor.run {
            try projectManager.createProject(name: "Status Test")
        }

        XCTAssertEqual(project.status, .active)

        try await MainActor.run {
            try projectManager.updateProjectStatus(projectId: project.id, status: .completed)
        }

        await MainActor.run {
            projectManager.loadProjects()
        }

        let found = await MainActor.run {
            projectManager.projects.first { $0.id == project.id }
        }

        XCTAssertEqual(found?.status, .completed)
    }

    // MARK: - Project Deletion Tests

    func testDeleteProject() async throws {
        let project = try await MainActor.run {
            try projectManager.createProject(name: "To Delete")
        }

        let initialCount = await MainActor.run { projectManager.projects.count }

        try await MainActor.run {
            try projectManager.deleteProject(projectId: project.id)
        }

        let finalCount = await MainActor.run { projectManager.projects.count }

        XCTAssertEqual(finalCount, initialCount - 1)

        let found = await MainActor.run {
            projectManager.projects.first { $0.id == project.id }
        }
        XCTAssertNil(found)
    }

    // MARK: - Project Search Tests

    func testSearchProjects() async throws {
        _ = try await MainActor.run {
            try projectManager.createProject(name: "Alpha Project")
        }
        _ = try await MainActor.run {
            try projectManager.createProject(name: "Beta Project")
        }
        _ = try await MainActor.run {
            try projectManager.createProject(name: "Gamma Test")
        }

        await MainActor.run {
            projectManager.searchProjects(query: "Project")
        }

        let searchResults = await MainActor.run { projectManager.projects }

        // Should find Alpha and Beta (both contain "Project")
        XCTAssertGreaterThanOrEqual(searchResults.count, 2)
        XCTAssertTrue(searchResults.contains { $0.name.contains("Project") })
    }

    func testSearchProjectsEmptyQuery() async throws {
        _ = try await MainActor.run {
            try projectManager.createProject(name: "Search Test 1")
        }
        _ = try await MainActor.run {
            try projectManager.createProject(name: "Search Test 2")
        }

        await MainActor.run {
            projectManager.searchProjects(query: "")
        }

        // Empty query should load all projects
        let results = await MainActor.run { projectManager.projects }
        XCTAssertGreaterThanOrEqual(results.count, 2)
    }

    // MARK: - File Operations Tests

    func testCreateFile() async throws {
        let project = try await MainActor.run {
            try projectManager.createProject(name: "File Test Project")
        }

        let file = try await MainActor.run {
            try projectManager.createFile(
                projectId: project.id,
                name: "test.txt",
                type: "txt",
                content: "Test content"
            )
        }

        XCTAssertNotNil(file)
        XCTAssertEqual(file.name, "test.txt")
        XCTAssertEqual(file.content, "Test content")
        XCTAssertFalse(file.isDirectory)
    }

    func testCreateDirectory() async throws {
        let project = try await MainActor.run {
            try projectManager.createProject(name: "Directory Test")
        }

        let dir = try await MainActor.run {
            try projectManager.createFile(
                projectId: project.id,
                name: "subdir",
                type: "directory",
                isDirectory: true
            )
        }

        XCTAssertTrue(dir.isDirectory)
    }

    func testCreateFileWithPathTraversal() async throws {
        let project = try await MainActor.run {
            try projectManager.createProject(name: "Security Test")
        }

        // Should reject path traversal attempts
        await MainActor.run {
            XCTAssertThrowsError(try projectManager.createFile(
                projectId: project.id,
                name: "../../../etc/passwd",
                type: "txt"
            )) { error in
                XCTAssertTrue(error is ProjectError)
            }
        }
    }

    func testCreateFileWithInvalidName() async throws {
        let project = try await MainActor.run {
            try projectManager.createProject(name: "Invalid File Test")
        }

        await MainActor.run {
            // Empty name
            XCTAssertThrowsError(try projectManager.createFile(
                projectId: project.id,
                name: "",
                type: "txt"
            ))

            // Name with null byte
            XCTAssertThrowsError(try projectManager.createFile(
                projectId: project.id,
                name: "file\0.txt",
                type: "txt"
            ))
        }
    }

    func testUpdateFileContent() async throws {
        let project = try await MainActor.run {
            try projectManager.createProject(name: "Update File Test")
        }

        let file = try await MainActor.run {
            try projectManager.createFile(
                projectId: project.id,
                name: "update.txt",
                type: "txt",
                content: "Original content"
            )
        }

        try await MainActor.run {
            try projectManager.updateFileContent(file: file, content: "Updated content")
        }

        await MainActor.run {
            projectManager.loadProjectFiles(projectId: project.id)
        }

        let updatedFile = await MainActor.run {
            projectManager.currentFiles.first { $0.id == file.id }
        }

        XCTAssertEqual(updatedFile?.content, "Updated content")
    }

    func testDeleteFile() async throws {
        let project = try await MainActor.run {
            try projectManager.createProject(name: "Delete File Test")
        }

        let file = try await MainActor.run {
            try projectManager.createFile(
                projectId: project.id,
                name: "to_delete.txt",
                type: "txt"
            )
        }

        try await MainActor.run {
            try projectManager.deleteFile(file)
        }

        await MainActor.run {
            projectManager.loadProjectFiles(projectId: project.id)
        }

        let found = await MainActor.run {
            projectManager.currentFiles.first { $0.id == file.id }
        }

        XCTAssertNil(found)
    }

    // MARK: - Sharing Tests

    func testGenerateShareToken() async throws {
        let project = try await MainActor.run {
            try projectManager.createProject(name: "Share Test")
        }

        let token = try await MainActor.run {
            try projectManager.generateShareToken(projectId: project.id)
        }

        XCTAssertFalse(token.isEmpty)

        let found = await MainActor.run {
            projectManager.projects.first { $0.id == project.id }
        }

        XCTAssertTrue(found?.isShared ?? false)
        XCTAssertEqual(found?.shareToken, token)
    }

    func testCancelShare() async throws {
        let project = try await MainActor.run {
            try projectManager.createProject(name: "Cancel Share Test")
        }

        _ = try await MainActor.run {
            try projectManager.generateShareToken(projectId: project.id)
        }

        try await MainActor.run {
            try projectManager.cancelShare(projectId: project.id)
        }

        await MainActor.run {
            projectManager.loadProjects()
        }

        let found = await MainActor.run {
            projectManager.projects.first { $0.id == project.id }
        }

        XCTAssertFalse(found?.isShared ?? true)
        XCTAssertNil(found?.shareToken)
    }

    // MARK: - Export Tests

    func testExportProject() async throws {
        let project = try await MainActor.run {
            try projectManager.createProject(
                name: "Export Test",
                description: "A project to export"
            )
        }

        _ = try await MainActor.run {
            try projectManager.createFile(
                projectId: project.id,
                name: "readme.md",
                type: "md",
                content: "# Readme"
            )
        }

        let exportData = try await MainActor.run {
            try projectManager.exportProject(projectId: project.id)
        }

        XCTAssertFalse(exportData.isEmpty)

        // Verify exported data can be decoded
        let decoded = try JSONDecoder().decode(ProjectExportData.self, from: exportData)
        XCTAssertEqual(decoded.project.name, "Export Test")
        XCTAssertFalse(decoded.files.isEmpty)
    }

    // MARK: - Statistics Tests

    func testStatistics() async throws {
        // Create some projects with different statuses
        let project1 = try await MainActor.run {
            try projectManager.createProject(name: "Stats Active")
        }
        _ = try await MainActor.run {
            try projectManager.createProject(name: "Stats Active 2")
        }

        try await MainActor.run {
            try projectManager.updateProjectStatus(projectId: project1.id, status: .completed)
        }

        await MainActor.run {
            projectManager.loadStatistics()
        }

        let stats = await MainActor.run { projectManager.statistics }

        XCTAssertNotNil(stats)
        XCTAssertGreaterThan(stats?.totalProjects ?? 0, 0)
    }

    // MARK: - Selection Tests

    func testSelectProject() async throws {
        let project = try await MainActor.run {
            try projectManager.createProject(name: "Selection Test")
        }

        await MainActor.run {
            projectManager.selectProject(project)
        }

        let currentProject = await MainActor.run { projectManager.currentProject }

        XCTAssertNotNil(currentProject)
        XCTAssertEqual(currentProject?.id, project.id)
    }

    func testClearSelection() async throws {
        let project = try await MainActor.run {
            try projectManager.createProject(name: "Clear Selection Test")
        }

        await MainActor.run {
            projectManager.selectProject(project)
            projectManager.clearSelection()
        }

        let currentProject = await MainActor.run { projectManager.currentProject }
        let currentFiles = await MainActor.run { projectManager.currentFiles }

        XCTAssertNil(currentProject)
        XCTAssertTrue(currentFiles.isEmpty)
    }

    // MARK: - Activity History Tests

    func testGetProjectActivities() async throws {
        let project = try await MainActor.run {
            try projectManager.createProject(name: "Activity Test")
        }

        // Create a file to generate an activity
        _ = try await MainActor.run {
            try projectManager.createFile(
                projectId: project.id,
                name: "activity.txt",
                type: "txt"
            )
        }

        let activities = await MainActor.run {
            projectManager.getProjectActivities(projectId: project.id)
        }

        // Should have at least one activity (file creation)
        XCTAssertGreaterThan(activities.count, 0)
    }
}

// MARK: - Repository Tests

final class ProjectRepositoryTests: XCTestCase {

    var repository: ProjectRepository!

    override func setUp() async throws {
        try await super.setUp()
        repository = ProjectRepository.shared
    }

    override func tearDown() async throws {
        // Clean up test projects
        let projects = try? repository.getAllProjects()
        for project in projects ?? [] {
            try? repository.deleteProject(id: project.id)
        }
        try await super.tearDown()
    }

    func testCreateAndGetProject() async throws {
        let project = ProjectEntity(
            name: "Repo Test Project",
            description: "Test description",
            type: .code
        )

        try await MainActor.run {
            try repository.createProject(project)
        }

        let retrieved = try await MainActor.run {
            try repository.getProject(id: project.id)
        }

        XCTAssertNotNil(retrieved)
        XCTAssertEqual(retrieved?.name, "Repo Test Project")
        XCTAssertEqual(retrieved?.type, .code)
    }

    func testGetAllProjectsWithFilter() async throws {
        // Create projects with different types
        let docProject = ProjectEntity(name: "Doc Project", type: .document)
        let codeProject = ProjectEntity(name: "Code Project", type: .code)

        try await MainActor.run {
            try repository.createProject(docProject)
            try repository.createProject(codeProject)
        }

        let docProjects = try await MainActor.run {
            try repository.getAllProjects(type: .document)
        }

        let codeProjects = try await MainActor.run {
            try repository.getAllProjects(type: .code)
        }

        XCTAssertTrue(docProjects.allSatisfy { $0.type == .document })
        XCTAssertTrue(codeProjects.allSatisfy { $0.type == .code })
    }

    func testSearchProjects() async throws {
        let project1 = ProjectEntity(name: "Alpha Search", description: "First project")
        let project2 = ProjectEntity(name: "Beta Test", description: "Alpha description")

        try await MainActor.run {
            try repository.createProject(project1)
            try repository.createProject(project2)
        }

        let results = try await MainActor.run {
            try repository.searchProjects(query: "Alpha")
        }

        // Should find both (one in name, one in description)
        XCTAssertGreaterThanOrEqual(results.count, 2)
    }

    func testProjectFileOperations() async throws {
        let project = ProjectEntity(name: "File Repo Test")
        try await MainActor.run {
            try repository.createProject(project)
        }

        let file = ProjectFileEntity(
            projectId: project.id,
            name: "test.swift",
            path: "test.swift",
            type: "swift",
            content: "print(\"Hello\")"
        )

        try await MainActor.run {
            try repository.createProjectFile(file)
        }

        let files = try await MainActor.run {
            try repository.getProjectFiles(projectId: project.id)
        }

        XCTAssertEqual(files.count, 1)
        XCTAssertEqual(files.first?.name, "test.swift")
    }

    func testProjectActivityLogging() async throws {
        let project = ProjectEntity(name: "Activity Repo Test")
        try await MainActor.run {
            try repository.createProject(project)
            try repository.logActivity(
                projectId: project.id,
                action: "test_action",
                description: "Test activity"
            )
        }

        let activities = try await MainActor.run {
            try repository.getProjectActivities(projectId: project.id)
        }

        XCTAssertGreaterThan(activities.count, 0)
        XCTAssertTrue(activities.contains { $0.action == "test_action" })
    }

    func testProjectStatistics() async throws {
        // Create some test projects
        let activeProject = ProjectEntity(name: "Active Stats", status: .active)
        var completedProject = ProjectEntity(name: "Completed Stats")
        completedProject.status = .completed

        try await MainActor.run {
            try repository.createProject(activeProject)
            try repository.createProject(completedProject)
        }

        let stats = try await MainActor.run {
            try repository.getStatistics()
        }

        XCTAssertGreaterThan(stats.totalProjects, 0)
    }
}
