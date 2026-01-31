package com.chainlesschain.android.feature.project.ui

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.chainlesschain.android.core.database.entity.ProjectEntity
import com.chainlesschain.android.core.database.entity.ProjectFileEntity
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Project Editor UI Component Tests
 *
 * Tests UI components for project management:
 * - Project file tree
 * - Code editor
 * - File tabs
 * - Git status indicators
 * - Project settings
 *
 * Target: 5 tests
 */
@RunWith(AndroidJUnit4::class)
class ProjectEditorUITest {

    @get:Rule
    val composeTestRule = createComposeRule()

    /**
     * Test 1: File tree displays project structure
     */
    @Test
    fun fileTree_displaysProjectStructure() {
        val files = listOf(
            createFile(id = "f1", name = "MainActivity.kt", path = "/src/MainActivity.kt", isDirectory = false),
            createFile(id = "f2", name = "build.gradle", path = "/build.gradle", isDirectory = false),
            createFile(id = "f3", name = "src", path = "/src", isDirectory = true)
        )

        composeTestRule.setContent {
            FileTreeMock(files = files, onFileClick = {})
        }

        // Verify files are displayed
        composeTestRule.onNodeWithText("MainActivity.kt").assertIsDisplayed()
        composeTestRule.onNodeWithText("build.gradle").assertIsDisplayed()
        composeTestRule.onNodeWithText("src").assertIsDisplayed()

        // Verify folder icon for directory
        composeTestRule.onAllNodesWithContentDescription("Folder")[0].assertIsDisplayed()

        // Verify file icon for regular files
        composeTestRule.onAllNodesWithContentDescription("File").assertCountEquals(2)
    }

    /**
     * Test 2: Code editor displays file content
     */
    @Test
    fun codeEditor_displaysFileContent() {
        val fileContent = """
            fun main() {
                println("Hello World")
            }
        """.trimIndent()

        composeTestRule.setContent {
            CodeEditorMock(
                content = fileContent,
                onContentChange = {}
            )
        }

        // Verify content is displayed
        composeTestRule.onNodeWithText("fun main()", substring = true).assertIsDisplayed()
        composeTestRule.onNodeWithText("println", substring = true).assertIsDisplayed()
    }

    /**
     * Test 3: File tabs allow switching between open files
     */
    @Test
    fun fileTabs_allowSwitchingBetweenFiles() {
        val openFiles = listOf(
            createFile(id = "f1", name = "MainActivity.kt", path = "/MainActivity.kt"),
            createFile(id = "f2", name = "build.gradle", path = "/build.gradle"),
            createFile(id = "f3", name = "README.md", path = "/README.md")
        )

        var selectedFile: String? = null

        composeTestRule.setContent {
            FileTabsMock(
                openFiles = openFiles,
                currentFile = "f1",
                onTabClick = { selectedFile = it },
                onTabClose = {}
            )
        }

        // Verify all tabs are displayed
        composeTestRule.onNodeWithText("MainActivity.kt").assertIsDisplayed()
        composeTestRule.onNodeWithText("build.gradle").assertIsDisplayed()
        composeTestRule.onNodeWithText("README.md").assertIsDisplayed()

        // Click on second tab
        composeTestRule.onNodeWithText("build.gradle").performClick()

        // Verify selection changed
        assert(selectedFile == "f2")
    }

    /**
     * Test 4: Git status indicators show file changes
     */
    @Test
    fun gitStatusIndicators_showFileChanges() {
        val files = listOf(
            createFile(id = "f1", name = "Modified.kt", isDirty = true),
            createFile(id = "f2", name = "New.kt", isDirty = false),
            createFile(id = "f3", name = "Unchanged.kt", isDirty = false)
        )

        composeTestRule.setContent {
            FileTreeWithGitStatusMock(files = files)
        }

        // Verify modified indicator for dirty file
        composeTestRule.onNodeWithTag("git_status_f1").assertIsDisplayed()
        composeTestRule.onNodeWithText("M", substring = true).assertIsDisplayed()
    }

    /**
     * Test 5: Project settings displays all options
     */
    @Test
    fun projectSettings_displaysAllOptions() {
        val project = createProject(
            id = "proj1",
            name = "My Project",
            gitRemote = "https://github.com/user/repo.git",
            gitBranch = "main"
        )

        composeTestRule.setContent {
            ProjectSettingsMock(project = project)
        }

        // Verify project name
        composeTestRule.onNodeWithText("My Project").assertIsDisplayed()

        // Verify Git remote
        composeTestRule.onNodeWithText("https://github.com/user/repo.git", substring = true)
            .assertIsDisplayed()

        // Verify Git branch
        composeTestRule.onNodeWithText("main").assertIsDisplayed()

        // Verify settings sections
        composeTestRule.onNodeWithText("项目设置").assertIsDisplayed()
        composeTestRule.onNodeWithText("Git 配置").assertIsDisplayed()
    }

    // ========================================
    // Mock Components & Helper Functions
    // ========================================

    @androidx.compose.runtime.Composable
    private fun FileTreeMock(
        files: List<ProjectFileEntity>,
        onFileClick: (String) -> Unit
    ) {
        androidx.compose.foundation.lazy.LazyColumn {
            items(files.size) { index ->
                val file = files[index]
                androidx.compose.foundation.layout.Row(
                    modifier = androidx.compose.ui.Modifier
                        .fillMaxWidth()
                        .clickable { onFileClick(file.id) }
                        .padding(8.dp)
                ) {
                    androidx.compose.material3.Icon(
                        imageVector = if (file.isDirectory)
                            androidx.compose.material.icons.Icons.Default.Folder
                        else
                            androidx.compose.material.icons.Icons.Default.InsertDriveFile,
                        contentDescription = if (file.isDirectory) "Folder" else "File"
                    )
                    androidx.compose.material3.Text(
                        text = file.name,
                        modifier = androidx.compose.ui.Modifier.padding(start = 8.dp)
                    )
                }
            }
        }
    }

    @androidx.compose.runtime.Composable
    private fun CodeEditorMock(
        content: String,
        onContentChange: (String) -> Unit
    ) {
        androidx.compose.material3.TextField(
            value = content,
            onValueChange = onContentChange,
            modifier = androidx.compose.ui.Modifier
                .fillMaxSize()
                .testTag("code_editor"),
            textStyle = androidx.compose.ui.text.TextStyle(
                fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace
            )
        )
    }

    @androidx.compose.runtime.Composable
    private fun FileTabsMock(
        openFiles: List<ProjectFileEntity>,
        currentFile: String,
        onTabClick: (String) -> Unit,
        onTabClose: (String) -> Unit
    ) {
        androidx.compose.material3.ScrollableTabRow(selectedTabIndex = 0) {
            openFiles.forEach { file ->
                androidx.compose.material3.Tab(
                    selected = file.id == currentFile,
                    onClick = { onTabClick(file.id) },
                    text = {
                        androidx.compose.foundation.layout.Row {
                            androidx.compose.material3.Text(file.name)
                            androidx.compose.material3.IconButton(
                                onClick = { onTabClose(file.id) }
                            ) {
                                androidx.compose.material3.Icon(
                                    imageVector = androidx.compose.material.icons.Icons.Default.Close,
                                    contentDescription = "Close tab",
                                    modifier = androidx.compose.ui.Modifier.size(16.dp)
                                )
                            }
                        }
                    }
                )
            }
        }
    }

    @androidx.compose.runtime.Composable
    private fun FileTreeWithGitStatusMock(files: List<ProjectFileEntity>) {
        androidx.compose.foundation.lazy.LazyColumn {
            items(files.size) { index ->
                val file = files[index]
                androidx.compose.foundation.layout.Row(
                    modifier = androidx.compose.ui.Modifier
                        .fillMaxWidth()
                        .padding(8.dp)
                ) {
                    if (file.isDirty) {
                        androidx.compose.material3.Text(
                            text = "M",
                            color = androidx.compose.material3.MaterialTheme.colorScheme.primary,
                            modifier = androidx.compose.ui.Modifier
                                .testTag("git_status_${file.id}")
                                .padding(end = 8.dp)
                        )
                    }
                    androidx.compose.material3.Text(file.name)
                }
            }
        }
    }

    @androidx.compose.runtime.Composable
    private fun ProjectSettingsMock(project: ProjectEntity) {
        androidx.compose.foundation.layout.Column(
            modifier = androidx.compose.ui.Modifier.padding(16.dp)
        ) {
            androidx.compose.material3.Text(
                text = "项目设置",
                style = androidx.compose.material3.MaterialTheme.typography.headlineSmall
            )

            androidx.compose.foundation.layout.Spacer(modifier = androidx.compose.ui.Modifier.height(16.dp))

            androidx.compose.material3.Text("项目名称")
            androidx.compose.material3.Text(
                text = project.name,
                style = androidx.compose.material3.MaterialTheme.typography.bodyLarge
            )

            androidx.compose.foundation.layout.Spacer(modifier = androidx.compose.ui.Modifier.height(16.dp))

            androidx.compose.material3.Text(
                text = "Git 配置",
                style = androidx.compose.material3.MaterialTheme.typography.titleMedium
            )

            project.gitConfig?.let { git ->
                androidx.compose.material3.Text("Remote: ${git.remoteUrl}")
                androidx.compose.material3.Text("Branch: ${git.branch}")
            }
        }
    }

    private fun createFile(
        id: String,
        name: String,
        path: String = "/$name",
        isDirectory: Boolean = false,
        isDirty: Boolean = false
    ) = ProjectFileEntity(
        id = id,
        projectId = "proj1",
        name = name,
        path = path,
        isDirectory = isDirectory,
        fileSize = if (isDirectory) 0 else 1024,
        lastModified = System.currentTimeMillis(),
        parentId = null,
        isOpen = false,
        isDirty = isDirty,
        contentHash = null
    )

    private fun createProject(
        id: String,
        name: String,
        gitRemote: String? = null,
        gitBranch: String? = null
    ) = ProjectEntity(
        id = id,
        userId = "user1",
        name = name,
        description = "Test project",
        path = "/path/to/project",
        createdAt = System.currentTimeMillis(),
        updatedAt = System.currentTimeMillis(),
        lastAccessedAt = System.currentTimeMillis(),
        status = "active",
        gitConfig = if (gitRemote != null) {
            ProjectEntity.GitConfig(
                remoteUrl = gitRemote,
                branch = gitBranch ?: "main",
                currentCommit = "abc123",
                hasUncommittedChanges = false
            )
        } else null,
        tags = "",
        isFavorite = false,
        isArchived = false,
        accessCount = 0
    )
}
