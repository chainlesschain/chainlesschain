package com.chainlesschain.project.service;

import com.baomidou.mybatisplus.core.toolkit.IdWorker;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.project.dto.FileCreateRequest;
import com.chainlesschain.project.dto.FileUpdateRequest;
import com.chainlesschain.project.dto.ProjectFileDTO;
import com.chainlesschain.project.entity.FileVersion;
import com.chainlesschain.project.entity.Project;
import com.chainlesschain.project.entity.ProjectFile;
import com.chainlesschain.project.mapper.FileVersionMapper;
import com.chainlesschain.project.mapper.ProjectFileMapper;
import com.chainlesschain.project.mapper.ProjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * 项目文件服务测试
 */
@ExtendWith(MockitoExtension.class)
class ProjectFileServiceTest {

    @Mock
    private ProjectFileMapper projectFileMapper;

    @Mock
    private ProjectMapper projectMapper;

    @Mock
    private FileVersionMapper fileVersionMapper;

    @InjectMocks
    private ProjectFileService projectFileService;

    private String testProjectId;
    private String testFileId;
    private ProjectFile testFile;
    private Project testProject;

    @BeforeEach
    void setUp() {
        testProjectId = IdWorker.get32UUID();
        testFileId = IdWorker.get32UUID();

        // 准备测试项目
        testProject = new Project();
        testProject.setId(testProjectId);
        testProject.setName("测试项目");
        testProject.setFileCount(0L);
        testProject.setTotalSize(0L);

        // 准备测试文件
        testFile = new ProjectFile();
        testFile.setId(testFileId);
        testFile.setProjectId(testProjectId);
        testFile.setFilePath("src/main/java/Test.java");
        testFile.setFileName("Test.java");
        testFile.setFileType("java");
        testFile.setLanguage("java");
        testFile.setContent("public class Test {}");
        testFile.setFileSize(20L);
        testFile.setVersion(1);
        testFile.setGeneratedBy("user");
    }

    @Test
    void testListFiles_Success() {
        // 准备数据
        List<ProjectFile> files = Arrays.asList(testFile);
        Page<ProjectFile> page = new Page<>(1, 10);
        page.setRecords(files);
        page.setTotal(1);

        when(projectFileMapper.selectPage(any(Page.class), any())).thenReturn(page);

        // 执行测试
        Page<ProjectFileDTO> result = projectFileService.listFiles(testProjectId, null, 1, 10);

        // 验证结果
        assertNotNull(result);
        assertEquals(1, result.getTotal());
        assertEquals(1, result.getRecords().size());
        assertEquals(testFile.getFileName(), result.getRecords().get(0).getFileName());

        // 验证调用
        verify(projectFileMapper, times(1)).selectPage(any(Page.class), any());
    }

    @Test
    void testListFiles_WithFileTypeFilter() {
        // 准备数据
        List<ProjectFile> files = Arrays.asList(testFile);
        Page<ProjectFile> page = new Page<>(1, 10);
        page.setRecords(files);
        page.setTotal(1);

        when(projectFileMapper.selectPage(any(Page.class), any())).thenReturn(page);

        // 执行测试
        Page<ProjectFileDTO> result = projectFileService.listFiles(testProjectId, "java", 1, 10);

        // 验证结果
        assertNotNull(result);
        assertEquals(1, result.getTotal());
        verify(projectFileMapper, times(1)).selectPage(any(Page.class), any());
    }

    @Test
    void testGetFile_Success() {
        when(projectFileMapper.selectOne(any())).thenReturn(testFile);

        // 执行测试
        ProjectFileDTO result = projectFileService.getFile(testProjectId, testFileId);

        // 验证结果
        assertNotNull(result);
        assertEquals(testFile.getFileName(), result.getFileName());
        assertEquals(testFile.getContent(), result.getContent());

        verify(projectFileMapper, times(1)).selectOne(any());
    }

    @Test
    void testGetFile_NotFound() {
        when(projectFileMapper.selectOne(any())).thenReturn(null);

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            projectFileService.getFile(testProjectId, testFileId);
        });

        assertTrue(exception.getMessage().contains("文件不存在"));
    }

    @Test
    void testCreateFile_Success() {
        when(projectMapper.selectById(testProjectId)).thenReturn(testProject);
        when(projectFileMapper.insert(any(ProjectFile.class))).thenReturn(1);
        when(projectFileMapper.selectList(any())).thenReturn(Arrays.asList(testFile));

        // 准备请求
        FileCreateRequest request = new FileCreateRequest();
        request.setFilePath("src/main/java/Test.java");
        request.setFileName("Test.java");
        request.setFileType("java");
        request.setLanguage("java");
        request.setContent("public class Test {}");
        request.setGeneratedBy("user");

        // 执行测试
        ProjectFileDTO result = projectFileService.createFile(testProjectId, request);

        // 验证结果
        assertNotNull(result);
        assertEquals(request.getFileName(), result.getFileName());

        // 验证调用
        verify(projectMapper, times(1)).selectById(testProjectId);
        verify(projectFileMapper, times(1)).insert(any(ProjectFile.class));
        verify(projectMapper, times(1)).updateById(any(Project.class));
    }

    @Test
    void testCreateFile_ProjectNotFound() {
        when(projectMapper.selectById(testProjectId)).thenReturn(null);

        FileCreateRequest request = new FileCreateRequest();
        request.setFilePath("test.java");
        request.setFileName("test.java");

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            projectFileService.createFile(testProjectId, request);
        });

        assertTrue(exception.getMessage().contains("项目不存在"));
    }

    @Test
    void testBatchCreateFiles_Success() {
        when(projectMapper.selectById(testProjectId)).thenReturn(testProject);
        when(projectFileMapper.insert(any(ProjectFile.class))).thenReturn(1);
        when(projectFileMapper.selectList(any())).thenReturn(Arrays.asList(testFile));

        // 准备请求
        FileCreateRequest request1 = new FileCreateRequest();
        request1.setFilePath("File1.java");
        request1.setFileName("File1.java");
        request1.setFileType("java");

        FileCreateRequest request2 = new FileCreateRequest();
        request2.setFilePath("File2.java");
        request2.setFileName("File2.java");
        request2.setFileType("java");

        List<FileCreateRequest> requests = Arrays.asList(request1, request2);

        // 执行测试
        List<ProjectFileDTO> results = projectFileService.batchCreateFiles(testProjectId, requests);

        // 验证结果
        assertNotNull(results);
        assertEquals(2, results.size());

        // 验证调用
        verify(projectFileMapper, times(2)).insert(any(ProjectFile.class));
    }

    @Test
    void testUpdateFile_Success() {
        when(projectFileMapper.selectOne(any())).thenReturn(testFile);
        when(projectFileMapper.updateById(any(ProjectFile.class))).thenReturn(1);
        when(projectFileMapper.selectList(any())).thenReturn(Arrays.asList(testFile));
        when(projectMapper.selectById(testProjectId)).thenReturn(testProject);

        // 准备请求
        FileUpdateRequest request = new FileUpdateRequest();
        request.setContent("public class Test { /* updated */ }");

        // 执行测试
        ProjectFileDTO result = projectFileService.updateFile(testProjectId, testFileId, request);

        // 验证结果
        assertNotNull(result);
        assertEquals(2, result.getVersion()); // 版本号应该递增

        // 验证调用
        verify(projectFileMapper, times(1)).selectOne(any());
        verify(projectFileMapper, times(1)).updateById(any(ProjectFile.class));
    }

    @Test
    void testUpdateFile_NotFound() {
        when(projectFileMapper.selectOne(any())).thenReturn(null);

        FileUpdateRequest request = new FileUpdateRequest();
        request.setContent("updated content");

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            projectFileService.updateFile(testProjectId, testFileId, request);
        });

        assertTrue(exception.getMessage().contains("文件不存在"));
    }

    @Test
    void testDeleteFile_Success() {
        when(projectFileMapper.selectOne(any())).thenReturn(testFile);
        when(projectFileMapper.deleteById(testFileId)).thenReturn(1);
        when(projectFileMapper.selectList(any())).thenReturn(new ArrayList<>());
        when(projectMapper.selectById(testProjectId)).thenReturn(testProject);

        // 执行测试
        assertDoesNotThrow(() -> {
            projectFileService.deleteFile(testProjectId, testFileId);
        });

        // 验证调用
        verify(projectFileMapper, times(1)).selectOne(any());
        verify(projectFileMapper, times(1)).deleteById(testFileId);
        verify(projectMapper, times(1)).updateById(any(Project.class));
    }

    @Test
    void testDeleteFile_NotFound() {
        when(projectFileMapper.selectOne(any())).thenReturn(null);

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            projectFileService.deleteFile(testProjectId, testFileId);
        });

        assertTrue(exception.getMessage().contains("文件不存在"));
    }

    // ==================== 文件搜索测试 ====================

    @Test
    void testSearchFiles_ByFileName() {
        // 准备数据
        List<ProjectFile> files = Arrays.asList(testFile);
        Page<ProjectFile> page = new Page<>(1, 10);
        page.setRecords(files);
        page.setTotal(1);

        when(projectFileMapper.selectPage(any(Page.class), any())).thenReturn(page);

        // 执行测试 - 按文件名搜索
        Page<ProjectFileDTO> result = projectFileService.searchFiles(testProjectId, "Test", null, 1, 10);

        // 验证结果
        assertNotNull(result);
        assertEquals(1, result.getTotal());
        assertEquals(1, result.getRecords().size());
        assertEquals("Test.java", result.getRecords().get(0).getFileName());

        verify(projectFileMapper, times(1)).selectPage(any(Page.class), any());
    }

    @Test
    void testSearchFiles_ByContent() {
        // 准备数据
        testFile.setContent("public class HelloWorld { public void sayHello() {} }");
        List<ProjectFile> files = Arrays.asList(testFile);
        Page<ProjectFile> page = new Page<>(1, 10);
        page.setRecords(files);
        page.setTotal(1);

        when(projectFileMapper.selectPage(any(Page.class), any())).thenReturn(page);

        // 执行测试 - 按内容搜索
        Page<ProjectFileDTO> result = projectFileService.searchFiles(testProjectId, "HelloWorld", null, 1, 10);

        // 验证结果
        assertNotNull(result);
        assertEquals(1, result.getTotal());

        verify(projectFileMapper, times(1)).selectPage(any(Page.class), any());
    }

    @Test
    void testSearchFiles_WithFileTypeFilter() {
        // 准备数据
        List<ProjectFile> files = Arrays.asList(testFile);
        Page<ProjectFile> page = new Page<>(1, 10);
        page.setRecords(files);
        page.setTotal(1);

        when(projectFileMapper.selectPage(any(Page.class), any())).thenReturn(page);

        // 执行测试 - 带文件类型过滤
        Page<ProjectFileDTO> result = projectFileService.searchFiles(testProjectId, "Test", "java", 1, 10);

        // 验证结果
        assertNotNull(result);
        assertEquals(1, result.getTotal());
        assertEquals("java", result.getRecords().get(0).getFileType());

        verify(projectFileMapper, times(1)).selectPage(any(Page.class), any());
    }

    @Test
    void testSearchFiles_NoResults() {
        // 准备数据 - 空结果
        Page<ProjectFile> page = new Page<>(1, 10);
        page.setRecords(new ArrayList<>());
        page.setTotal(0);

        when(projectFileMapper.selectPage(any(Page.class), any())).thenReturn(page);

        // 执行测试
        Page<ProjectFileDTO> result = projectFileService.searchFiles(testProjectId, "nonexistent", null, 1, 10);

        // 验证结果
        assertNotNull(result);
        assertEquals(0, result.getTotal());
        assertTrue(result.getRecords().isEmpty());
    }

    // ==================== 文件版本历史测试 ====================

    @Test
    void testGetFileVersions_Success() {
        // 准备数据
        FileVersion version1 = new FileVersion();
        version1.setId("version-1");
        version1.setFileId(testFileId);
        version1.setProjectId(testProjectId);
        version1.setVersion(2);
        version1.setContent("public class Test { v2 }");
        version1.setCreatedAt(LocalDateTime.now());

        FileVersion version2 = new FileVersion();
        version2.setId("version-2");
        version2.setFileId(testFileId);
        version2.setProjectId(testProjectId);
        version2.setVersion(1);
        version2.setContent("public class Test { v1 }");
        version2.setCreatedAt(LocalDateTime.now().minusHours(1));

        List<FileVersion> versions = Arrays.asList(version1, version2);

        when(projectFileMapper.selectOne(any())).thenReturn(testFile);
        when(fileVersionMapper.getVersionHistory(testFileId, testProjectId, 10)).thenReturn(versions);

        // 执行测试
        List<ProjectFileDTO> result = projectFileService.getFileVersions(testProjectId, testFileId, 10);

        // 验证结果
        assertNotNull(result);
        assertEquals(2, result.size());
        assertEquals(2, result.get(0).getVersion());
        assertEquals(1, result.get(1).getVersion());

        verify(projectFileMapper, times(1)).selectOne(any());
        verify(fileVersionMapper, times(1)).getVersionHistory(testFileId, testProjectId, 10);
    }

    @Test
    void testGetFileVersions_FileNotFound() {
        when(projectFileMapper.selectOne(any())).thenReturn(null);

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            projectFileService.getFileVersions(testProjectId, testFileId, 10);
        });

        assertTrue(exception.getMessage().contains("文件不存在"));
    }

    @Test
    void testGetFileVersions_EmptyHistory() {
        when(projectFileMapper.selectOne(any())).thenReturn(testFile);
        when(fileVersionMapper.getVersionHistory(testFileId, testProjectId, 10)).thenReturn(new ArrayList<>());

        // 执行测试
        List<ProjectFileDTO> result = projectFileService.getFileVersions(testProjectId, testFileId, 10);

        // 验证结果
        assertNotNull(result);
        assertTrue(result.isEmpty());
    }

    // ==================== 文件版本恢复测试 ====================

    @Test
    void testRestoreFileVersion_Success() {
        // 准备版本数据
        FileVersion targetVersion = new FileVersion();
        targetVersion.setId("version-1");
        targetVersion.setFileId(testFileId);
        targetVersion.setProjectId(testProjectId);
        targetVersion.setVersion(1);
        targetVersion.setContent("public class Test { original }");
        targetVersion.setFileSize(100L);

        when(projectFileMapper.selectOne(any())).thenReturn(testFile);
        when(fileVersionMapper.selectById("version-1")).thenReturn(targetVersion);
        when(fileVersionMapper.insert(any(FileVersion.class))).thenReturn(1);
        when(projectFileMapper.updateById(any(ProjectFile.class))).thenReturn(1);

        // 执行测试
        ProjectFileDTO result = projectFileService.restoreFileVersion(testProjectId, testFileId, "version-1");

        // 验证结果
        assertNotNull(result);
        assertEquals("public class Test { original }", result.getContent());

        verify(projectFileMapper, times(1)).selectOne(any());
        verify(fileVersionMapper, times(1)).selectById("version-1");
        verify(projectFileMapper, times(1)).updateById(any(ProjectFile.class));
    }

    @Test
    void testRestoreFileVersion_FileNotFound() {
        when(projectFileMapper.selectOne(any())).thenReturn(null);

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            projectFileService.restoreFileVersion(testProjectId, testFileId, "version-1");
        });

        assertTrue(exception.getMessage().contains("文件不存在"));
    }

    @Test
    void testRestoreFileVersion_VersionNotFound() {
        when(projectFileMapper.selectOne(any())).thenReturn(testFile);
        when(fileVersionMapper.selectById("nonexistent")).thenReturn(null);

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            projectFileService.restoreFileVersion(testProjectId, testFileId, "nonexistent");
        });

        assertTrue(exception.getMessage().contains("版本不存在"));
    }

    @Test
    void testRestoreFileVersion_VersionBelongsToOtherFile() {
        // 准备版本数据 - 属于其他文件
        FileVersion otherFileVersion = new FileVersion();
        otherFileVersion.setId("version-1");
        otherFileVersion.setFileId("other-file-id");  // 不匹配
        otherFileVersion.setProjectId(testProjectId);
        otherFileVersion.setVersion(1);

        when(projectFileMapper.selectOne(any())).thenReturn(testFile);
        when(fileVersionMapper.selectById("version-1")).thenReturn(otherFileVersion);

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            projectFileService.restoreFileVersion(testProjectId, testFileId, "version-1");
        });

        assertTrue(exception.getMessage().contains("版本不属于该文件"));
    }
}
