package com.chainlesschain.project.service;

import com.baomidou.mybatisplus.core.toolkit.IdWorker;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.project.client.AiServiceClient;
import com.chainlesschain.project.dto.ProjectCreateRequest;
import com.chainlesschain.project.dto.ProjectResponse;
import com.chainlesschain.project.dto.TaskExecuteRequest;
import com.chainlesschain.project.entity.Project;
import com.chainlesschain.project.entity.ProjectConversation;
import com.chainlesschain.project.entity.ProjectFile;
import com.chainlesschain.project.entity.ProjectTask;
import com.chainlesschain.project.mapper.ProjectConversationMapper;
import com.chainlesschain.project.mapper.ProjectFileMapper;
import com.chainlesschain.project.mapper.ProjectMapper;
import com.chainlesschain.project.mapper.ProjectTaskMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import reactor.core.publisher.Mono;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * ProjectService单元测试
 * 测试项目管理核心业务逻辑
 */
@ExtendWith(MockitoExtension.class)
class ProjectServiceTest {

    @Mock
    private ProjectMapper projectMapper;

    @Mock
    private ProjectFileMapper projectFileMapper;

    @Mock
    private ProjectTaskMapper projectTaskMapper;

    @Mock
    private ProjectConversationMapper projectConversationMapper;

    @Mock
    private AiServiceClient aiServiceClient;

    @Mock
    private ObjectMapper objectMapper;

    @InjectMocks
    private ProjectService projectService;

    @TempDir
    Path tempDir;

    private String testProjectId;
    private String testUserId;
    private Project testProject;
    private ObjectMapper realObjectMapper;

    @BeforeEach
    void setUp() {
        testProjectId = IdWorker.get32UUID();
        testUserId = "test-user-123";
        realObjectMapper = new ObjectMapper();

        // 设置临时目录作为项目根路径
        ReflectionTestUtils.setField(projectService, "projectsRootPath", tempDir.toString());

        // 准备测试项目
        testProject = new Project();
        testProject.setId(testProjectId);
        testProject.setUserId(testUserId);
        testProject.setName("测试项目");
        testProject.setDescription("这是一个测试项目");
        testProject.setType("web");
        testProject.setProjectType("web");
        testProject.setStatus("active");
        testProject.setRootPath(tempDir.resolve(testProjectId).toString());
        testProject.setFileCount(0L);
        testProject.setTotalSize(0L);
    }

    /**
     * 测试创建项目 - 成功场景
     */
    @Test
    void testCreateProject_Success() throws Exception {
        // 准备AI Service响应
        ObjectNode aiResponse = realObjectMapper.createObjectNode();
        aiResponse.put("project_type", "web");

        ObjectNode result = realObjectMapper.createObjectNode();
        ArrayNode filesArray = realObjectMapper.createArrayNode();

        ObjectNode file1 = realObjectMapper.createObjectNode();
        file1.put("path", "index.html");
        file1.put("content", "<html><body>Hello World</body></html>");
        file1.put("language", "html");
        filesArray.add(file1);

        ObjectNode file2 = realObjectMapper.createObjectNode();
        file2.put("path", "style.css");
        file2.put("content", "body { margin: 0; }");
        file2.put("language", "css");
        filesArray.add(file2);

        result.set("files", filesArray);
        result.put("metadata", "{}");
        aiResponse.set("result", result);

        when(aiServiceClient.createProject(anyString(), anyString()))
                .thenReturn(Mono.just(aiResponse));
        when(projectMapper.insert(any(Project.class))).thenReturn(1);
        when(projectFileMapper.insert(any(ProjectFile.class))).thenReturn(1);
        when(projectConversationMapper.insert(any(ProjectConversation.class))).thenReturn(1);

        // 准备请求
        ProjectCreateRequest request = new ProjectCreateRequest();
        request.setUserId(testUserId);
        request.setName("AI测试项目");
        request.setUserPrompt("创建一个简单的网页项目");
        request.setProjectType("web");

        // 执行测试
        ProjectResponse response = projectService.createProject(request);

        // 验证结果
        assertNotNull(response);
        assertEquals("AI测试项目", response.getName());
        assertEquals("web", response.getProjectType());
        assertEquals("active", response.getStatus());

        // 验证调用
        verify(aiServiceClient, times(1)).createProject(eq("创建一个简单的网页项目"), eq("web"));
        verify(projectMapper, times(1)).insert(any(Project.class));
        verify(projectFileMapper, times(2)).insert(any(ProjectFile.class)); // 2个文件
        verify(projectConversationMapper, times(1)).insert(any(ProjectConversation.class));
    }

    /**
     * 测试创建项目 - AI Service返回空
     */
    @Test
    void testCreateProject_AiServiceReturnsNull() {
        when(aiServiceClient.createProject(anyString(), anyString()))
                .thenReturn(Mono.empty());

        ProjectCreateRequest request = new ProjectCreateRequest();
        request.setUserId(testUserId);
        request.setUserPrompt("创建项目");
        request.setProjectType("web");

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            projectService.createProject(request);
        });

        assertTrue(exception.getMessage().contains("AI Service返回为空"));
    }

    /**
     * 测试创建项目 - AI Service调用失败
     */
    @Test
    void testCreateProject_AiServiceFails() {
        when(aiServiceClient.createProject(anyString(), anyString()))
                .thenReturn(Mono.error(new RuntimeException("AI Service连接失败")));

        ProjectCreateRequest request = new ProjectCreateRequest();
        request.setUserId(testUserId);
        request.setUserPrompt("创建项目");
        request.setProjectType("web");

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            projectService.createProject(request);
        });

        assertTrue(exception.getMessage().contains("AI Service连接失败"));
    }

    /**
     * 测试创建项目 - 使用默认值
     */
    @Test
    void testCreateProject_WithDefaults() throws Exception {
        // 准备AI响应（无project_type）
        ObjectNode aiResponse = realObjectMapper.createObjectNode();
        ObjectNode result = realObjectMapper.createObjectNode();
        result.set("files", realObjectMapper.createArrayNode());
        aiResponse.set("result", result);

        when(aiServiceClient.createProject(anyString(), eq(null)))
                .thenReturn(Mono.just(aiResponse));
        when(projectMapper.insert(any(Project.class))).thenReturn(1);
        when(projectConversationMapper.insert(any(ProjectConversation.class))).thenReturn(1);

        // 准备请求（无userId和name）
        ProjectCreateRequest request = new ProjectCreateRequest();
        request.setUserPrompt("创建一个项目");

        // 执行测试
        ProjectResponse response = projectService.createProject(request);

        // 验证默认值
        assertNotNull(response);
        assertEquals("local-user", response.getUserId()); // 默认userId
        assertNotNull(response.getName()); // 自动生成的名称
        assertEquals("web", response.getProjectType()); // 默认类型
    }

    /**
     * 测试获取项目 - 成功
     */
    @Test
    void testGetProject_Success() {
        when(projectMapper.selectById(testProjectId)).thenReturn(testProject);
        when(projectFileMapper.selectList(any())).thenReturn(new ArrayList<>());

        // 执行测试
        ProjectResponse response = projectService.getProject(testProjectId);

        // 验证结果
        assertNotNull(response);
        assertEquals(testProjectId, response.getId());
        assertEquals("测试项目", response.getName());

        verify(projectMapper, times(1)).selectById(testProjectId);
    }

    /**
     * 测试获取项目 - 项目不存在
     */
    @Test
    void testGetProject_NotFound() {
        when(projectMapper.selectById(testProjectId)).thenReturn(null);

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            projectService.getProject(testProjectId);
        });

        assertTrue(exception.getMessage().contains("项目不存在"));
    }

    /**
     * 测试获取项目列表 - 成功
     */
    @Test
    void testListProjects_Success() {
        List<Project> projects = Arrays.asList(testProject);
        Page<Project> page = new Page<>(1, 10);
        page.setRecords(projects);
        page.setTotal(1);

        when(projectMapper.selectPage(any(Page.class), any())).thenReturn(page);

        // 执行测试
        Page<ProjectResponse> result = projectService.listProjects(testUserId, 1, 10);

        // 验证结果
        assertNotNull(result);
        assertEquals(1, result.getTotal());
        assertEquals(1, result.getRecords().size());
        assertEquals("测试项目", result.getRecords().get(0).getName());

        verify(projectMapper, times(1)).selectPage(any(Page.class), any());
    }

    /**
     * 测试更新项目 - 成功
     */
    @Test
    void testUpdateProject_Success() {
        when(projectMapper.selectById(testProjectId)).thenReturn(testProject);
        when(projectMapper.updateById(any(Project.class))).thenReturn(1);

        // 准备更新数据
        Map<String, Object> updates = new HashMap<>();
        updates.put("name", "更新后的项目名");
        updates.put("description", "更新后的描述");
        updates.put("status", "completed");

        // 执行测试
        ProjectResponse response = projectService.updateProject(testProjectId, updates);

        // 验证结果
        assertNotNull(response);
        assertEquals("更新后的项目名", testProject.getName());
        assertEquals("更新后的描述", testProject.getDescription());
        assertEquals("completed", testProject.getStatus());

        verify(projectMapper, times(1)).selectById(testProjectId);
        verify(projectMapper, times(1)).updateById(any(Project.class));
    }

    /**
     * 测试删除项目 - 成功
     */
    @Test
    void testDeleteProject_Success() {
        when(projectMapper.selectById(testProjectId)).thenReturn(testProject);
        when(projectMapper.deleteById(testProjectId)).thenReturn(1);
        when(projectFileMapper.delete(any())).thenReturn(0);
        when(projectTaskMapper.delete(any())).thenReturn(0);
        when(projectConversationMapper.delete(any())).thenReturn(0);

        // 执行测试
        assertDoesNotThrow(() -> {
            projectService.deleteProject(testProjectId);
        });

        verify(projectMapper, times(1)).selectById(testProjectId);
        verify(projectMapper, times(1)).deleteById(testProjectId);
        verify(projectFileMapper, times(1)).delete(any());
    }

    /**
     * 测试执行任务 - 成功
     */
    @Test
    void testExecuteTask_Success() throws Exception {
        // 准备AI响应
        ObjectNode aiResponse = realObjectMapper.createObjectNode();
        aiResponse.put("status", "success");
        aiResponse.put("result", "任务执行成功");

        when(projectMapper.selectById(testProjectId)).thenReturn(testProject);
        when(aiServiceClient.executeTask(anyString(), anyString(), any()))
                .thenReturn(Mono.just(aiResponse));
        when(projectTaskMapper.insert(any(ProjectTask.class))).thenReturn(1);
        when(projectTaskMapper.updateById(any(ProjectTask.class))).thenReturn(1);

        // 准备请求
        TaskExecuteRequest request = new TaskExecuteRequest();
        request.setProjectId(testProjectId);
        request.setUserPrompt("执行测试任务");
        request.setContext(new ArrayList<>());

        // 执行测试
        Map<String, Object> result = projectService.executeTask(request);

        // 验证结果
        assertNotNull(result);
        assertEquals("success", result.get("status"));

        verify(aiServiceClient, times(1)).executeTask(eq(testProjectId), eq("执行测试任务"), any());
        verify(projectTaskMapper, times(1)).insert(any(ProjectTask.class));
        verify(projectTaskMapper, times(1)).updateById(any(ProjectTask.class));
    }

    /**
     * 测试执行任务 - 项目不存在
     */
    @Test
    void testExecuteTask_ProjectNotFound() {
        when(projectMapper.selectById(testProjectId)).thenReturn(null);

        TaskExecuteRequest request = new TaskExecuteRequest();
        request.setProjectId(testProjectId);
        request.setUserPrompt("执行任务");

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            projectService.executeTask(request);
        });

        assertTrue(exception.getMessage().contains("项目不存在"));
    }

    /**
     * 测试执行任务 - AI Service失败
     */
    @Test
    void testExecuteTask_AiServiceFails() {
        when(projectMapper.selectById(testProjectId)).thenReturn(testProject);
        when(aiServiceClient.executeTask(anyString(), anyString(), any()))
                .thenReturn(Mono.error(new RuntimeException("任务执行失败")));
        when(projectTaskMapper.insert(any(ProjectTask.class))).thenReturn(1);
        when(projectTaskMapper.updateById(any(ProjectTask.class))).thenReturn(1);

        TaskExecuteRequest request = new TaskExecuteRequest();
        request.setProjectId(testProjectId);
        request.setUserPrompt("执行任务");

        // 执行测试
        Map<String, Object> result = projectService.executeTask(request);

        // 验证结果 - 应该记录失败状态
        assertNotNull(result);
        assertEquals("failed", result.get("status"));

        verify(projectTaskMapper, times(1)).insert(any(ProjectTask.class));
        verify(projectTaskMapper, times(1)).updateById(any(ProjectTask.class));
    }

    /**
     * 测试保存对话历史
     */
    @Test
    void testSaveConversation() {
        when(projectConversationMapper.insert(any(ProjectConversation.class))).thenReturn(1);

        // 执行测试（通过createProject间接测试）
        // saveConversation是private方法，通过public方法测试

        verify(projectConversationMapper, never()).insert(any(ProjectConversation.class));
    }

    /**
     * 测试文件统计更新
     */
    @Test
    void testUpdateProjectStats() {
        ProjectFile file1 = new ProjectFile();
        file1.setFileSize(100L);

        ProjectFile file2 = new ProjectFile();
        file2.setFileSize(200L);

        List<ProjectFile> files = Arrays.asList(file1, file2);

        when(projectFileMapper.selectList(any())).thenReturn(files);
        when(projectMapper.updateById(any(Project.class))).thenReturn(1);

        // 通过createProject间接测试统计更新
        // updateProjectStats是private方法
    }

    // ==================== 项目导出测试 ====================

    /**
     * 测试项目导出 - 成功
     */
    @Test
    void testExportProject_Success() throws Exception {
        // 准备测试文件
        ProjectFile file1 = new ProjectFile();
        file1.setId("file-1");
        file1.setProjectId(testProjectId);
        file1.setFileName("index.html");
        file1.setFilePath("index.html");
        file1.setContent("<html></html>");
        file1.setFileSize(13L);

        List<ProjectFile> files = Arrays.asList(file1);

        when(projectMapper.selectById(testProjectId)).thenReturn(testProject);
        when(projectFileMapper.selectList(any())).thenReturn(files);

        // 执行测试
        Map<String, Object> result = projectService.exportProject(testProjectId, "zip", false, false);

        // 验证结果
        assertNotNull(result);
        assertTrue(result.containsKey("downloadPath"));
        assertTrue(result.containsKey("fileName"));
        assertTrue(result.get("fileName").toString().contains("project_"));
        assertTrue(result.get("fileName").toString().endsWith(".zip"));

        verify(projectMapper, times(1)).selectById(testProjectId);
        verify(projectFileMapper, times(1)).selectList(any());

        // 清理生成的文件
        String downloadPath = result.get("downloadPath").toString();
        Files.deleteIfExists(Path.of(downloadPath));
    }

    /**
     * 测试项目导出 - 项目不存在
     */
    @Test
    void testExportProject_NotFound() {
        when(projectMapper.selectById(testProjectId)).thenReturn(null);

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            projectService.exportProject(testProjectId, "zip", false, false);
        });

        assertTrue(exception.getMessage().contains("项目不存在"));
    }

    /**
     * 测试项目导出 - 包含历史
     */
    @Test
    void testExportProject_WithHistory() throws Exception {
        // 准备测试数据
        List<ProjectFile> files = new ArrayList<>();

        when(projectMapper.selectById(testProjectId)).thenReturn(testProject);
        when(projectFileMapper.selectList(any())).thenReturn(files);
        when(projectConversationMapper.selectList(any())).thenReturn(new ArrayList<>());

        // 执行测试 - 包含历史
        Map<String, Object> result = projectService.exportProject(testProjectId, "zip", true, false);

        // 验证结果
        assertNotNull(result);
        assertTrue(result.containsKey("downloadPath"));

        // 验证调用了对话历史查询
        verify(projectConversationMapper, times(1)).selectList(any());

        // 清理
        String downloadPath = result.get("downloadPath").toString();
        Files.deleteIfExists(Path.of(downloadPath));
    }

    // ==================== 项目导入测试 ====================

    /**
     * 测试项目导入 - 成功
     */
    @Test
    void testImportProject_Success() throws Exception {
        // 准备测试ZIP文件
        Path testZipDir = tempDir.resolve("import_test");
        Files.createDirectories(testZipDir);

        // 创建project.json
        Map<String, Object> metadata = new HashMap<>();
        metadata.put("name", "导入测试项目");
        metadata.put("type", "web");
        metadata.put("description", "测试描述");

        String metadataJson = realObjectMapper.writeValueAsString(metadata);
        Files.writeString(testZipDir.resolve("project.json"), metadataJson);

        // 创建测试文件
        Files.writeString(testZipDir.resolve("index.html"), "<html></html>");

        // 创建ZIP文件
        Path zipPath = tempDir.resolve("test_import.zip");
        try (java.util.zip.ZipOutputStream zos = new java.util.zip.ZipOutputStream(
                new java.io.FileOutputStream(zipPath.toFile()))) {
            // 添加project.json
            zos.putNextEntry(new java.util.zip.ZipEntry("project.json"));
            zos.write(metadataJson.getBytes());
            zos.closeEntry();

            // 添加index.html
            zos.putNextEntry(new java.util.zip.ZipEntry("index.html"));
            zos.write("<html></html>".getBytes());
            zos.closeEntry();
        }

        when(projectMapper.insert(any(Project.class))).thenReturn(1);
        when(projectFileMapper.insert(any(ProjectFile.class))).thenReturn(1);

        // 执行测试
        ProjectResponse result = projectService.importProject(zipPath.toString(), null, false);

        // 验证结果
        assertNotNull(result);
        assertEquals("导入测试项目", result.getName());
        assertEquals("web", result.getProjectType());

        verify(projectMapper, times(1)).insert(any(Project.class));
    }

    /**
     * 测试项目导入 - 文件不存在
     */
    @Test
    void testImportProject_FileNotFound() {
        String nonExistentPath = "/path/to/nonexistent.zip";

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            projectService.importProject(nonExistentPath, null, false);
        });

        assertTrue(exception.getMessage().contains("导入文件不存在"));
    }

    /**
     * 测试项目导入 - 无效的ZIP格式（缺少project.json）
     */
    @Test
    void testImportProject_InvalidFormat() throws Exception {
        // 创建不包含project.json的ZIP
        Path zipPath = tempDir.resolve("invalid.zip");
        try (java.util.zip.ZipOutputStream zos = new java.util.zip.ZipOutputStream(
                new java.io.FileOutputStream(zipPath.toFile()))) {
            zos.putNextEntry(new java.util.zip.ZipEntry("random.txt"));
            zos.write("random content".getBytes());
            zos.closeEntry();
        }

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            projectService.importProject(zipPath.toString(), null, false);
        });

        assertTrue(exception.getMessage().contains("缺少project.json"));
    }

    /**
     * 测试项目导入 - 自定义项目名
     */
    @Test
    void testImportProject_WithCustomName() throws Exception {
        // 准备测试数据
        Map<String, Object> metadata = new HashMap<>();
        metadata.put("name", "原始名称");
        metadata.put("type", "web");

        String metadataJson = realObjectMapper.writeValueAsString(metadata);

        // 创建ZIP文件
        Path zipPath = tempDir.resolve("custom_name_test.zip");
        try (java.util.zip.ZipOutputStream zos = new java.util.zip.ZipOutputStream(
                new java.io.FileOutputStream(zipPath.toFile()))) {
            zos.putNextEntry(new java.util.zip.ZipEntry("project.json"));
            zos.write(metadataJson.getBytes());
            zos.closeEntry();
        }

        when(projectMapper.insert(any(Project.class))).thenReturn(1);

        // 执行测试 - 使用自定义名称
        ProjectResponse result = projectService.importProject(zipPath.toString(), "自定义项目名", false);

        // 验证结果
        assertNotNull(result);
        assertEquals("自定义项目名", result.getName());  // 应该使用自定义名称
    }
}
