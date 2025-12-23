package com.chainlesschain.project.service;

import com.baomidou.mybatisplus.core.toolkit.IdWorker;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.project.dto.FileCreateRequest;
import com.chainlesschain.project.dto.FileUpdateRequest;
import com.chainlesschain.project.dto.ProjectFileDTO;
import com.chainlesschain.project.entity.Project;
import com.chainlesschain.project.entity.ProjectFile;
import com.chainlesschain.project.mapper.ProjectFileMapper;
import com.chainlesschain.project.mapper.ProjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

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
}
