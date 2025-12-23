package com.chainlesschain.project.service;

import com.baomidou.mybatisplus.core.toolkit.IdWorker;
import com.chainlesschain.project.dto.CollaboratorAddRequest;
import com.chainlesschain.project.dto.CollaboratorDTO;
import com.chainlesschain.project.dto.PermissionUpdateRequest;
import com.chainlesschain.project.entity.ProjectCollaborator;
import com.chainlesschain.project.mapper.ProjectCollaboratorMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * 协作者服务测试
 */
@ExtendWith(MockitoExtension.class)
class CollaboratorServiceTest {

    @Mock
    private ProjectCollaboratorMapper collaboratorMapper;

    @InjectMocks
    private CollaboratorService collaboratorService;

    private String testProjectId;
    private String testCollaboratorId;
    private ProjectCollaborator testCollaborator;

    @BeforeEach
    void setUp() {
        testProjectId = IdWorker.get32UUID();
        testCollaboratorId = IdWorker.get32UUID();

        testCollaborator = new ProjectCollaborator();
        testCollaborator.setId(testCollaboratorId);
        testCollaborator.setProjectId(testProjectId);
        testCollaborator.setCollaboratorDid("did:test:12345");
        testCollaborator.setPermissions("read,write");
        testCollaborator.setStatus("pending");
        testCollaborator.setInvitedBy("did:test:admin");
        testCollaborator.setInvitedAt(LocalDateTime.now());
    }

    @Test
    void testListCollaborators_Success() {
        // 准备数据
        List<ProjectCollaborator> collaborators = Arrays.asList(testCollaborator);
        when(collaboratorMapper.selectList(any())).thenReturn(collaborators);

        // 执行测试
        List<CollaboratorDTO> results = collaboratorService.listCollaborators(testProjectId);

        // 验证结果
        assertNotNull(results);
        assertEquals(1, results.size());
        assertEquals(testCollaborator.getCollaboratorDid(), results.get(0).getCollaboratorDid());

        verify(collaboratorMapper, times(1)).selectList(any());
    }

    @Test
    void testAddCollaborator_Success() {
        when(collaboratorMapper.selectCount(any())).thenReturn(0L); // 不存在
        when(collaboratorMapper.insert(any(ProjectCollaborator.class))).thenReturn(1);

        // 准备请求
        CollaboratorAddRequest request = new CollaboratorAddRequest();
        request.setCollaboratorDid("did:test:newuser");
        request.setPermissions("read");

        // 执行测试
        CollaboratorDTO result = collaboratorService.addCollaborator(testProjectId, request, "did:test:admin");

        // 验证结果
        assertNotNull(result);
        assertEquals(request.getCollaboratorDid(), result.getCollaboratorDid());
        assertEquals("pending", result.getStatus());

        verify(collaboratorMapper, times(1)).selectCount(any());
        verify(collaboratorMapper, times(1)).insert(any(ProjectCollaborator.class));
    }

    @Test
    void testAddCollaborator_AlreadyExists() {
        when(collaboratorMapper.selectCount(any())).thenReturn(1L); // 已存在

        CollaboratorAddRequest request = new CollaboratorAddRequest();
        request.setCollaboratorDid("did:test:existing");
        request.setPermissions("read");

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            collaboratorService.addCollaborator(testProjectId, request, "did:test:admin");
        });

        assertTrue(exception.getMessage().contains("已是项目协作者"));
    }

    @Test
    void testUpdatePermissions_Success() {
        when(collaboratorMapper.selectOne(any())).thenReturn(testCollaborator);
        when(collaboratorMapper.updateById(any(ProjectCollaborator.class))).thenReturn(1);

        // 准备请求
        PermissionUpdateRequest request = new PermissionUpdateRequest();
        request.setPermissions("read,write,admin");

        // 执行测试
        CollaboratorDTO result = collaboratorService.updatePermissions(testProjectId, testCollaboratorId, request);

        // 验证结果
        assertNotNull(result);
        assertEquals(request.getPermissions(), testCollaborator.getPermissions());

        verify(collaboratorMapper, times(1)).selectOne(any());
        verify(collaboratorMapper, times(1)).updateById(any(ProjectCollaborator.class));
    }

    @Test
    void testRemoveCollaborator_Success() {
        when(collaboratorMapper.selectOne(any())).thenReturn(testCollaborator);
        when(collaboratorMapper.deleteById(testCollaboratorId)).thenReturn(1);

        // 执行测试
        assertDoesNotThrow(() -> {
            collaboratorService.removeCollaborator(testProjectId, testCollaboratorId);
        });

        verify(collaboratorMapper, times(1)).selectOne(any());
        verify(collaboratorMapper, times(1)).deleteById(testCollaboratorId);
    }

    @Test
    void testRemoveCollaborator_NotFound() {
        when(collaboratorMapper.selectOne(any())).thenReturn(null);

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            collaboratorService.removeCollaborator(testProjectId, testCollaboratorId);
        });

        assertTrue(exception.getMessage().contains("协作者不存在"));
    }

    @Test
    void testAcceptInvitation_Success() {
        when(collaboratorMapper.selectOne(any())).thenReturn(testCollaborator);
        when(collaboratorMapper.updateById(any(ProjectCollaborator.class))).thenReturn(1);

        // 执行测试
        CollaboratorDTO result = collaboratorService.acceptInvitation(testProjectId, testCollaboratorId);

        // 验证结果
        assertNotNull(result);
        assertEquals("accepted", testCollaborator.getStatus());
        assertNotNull(testCollaborator.getAcceptedAt());

        verify(collaboratorMapper, times(1)).selectOne(any());
        verify(collaboratorMapper, times(1)).updateById(any(ProjectCollaborator.class));
    }

    @Test
    void testAcceptInvitation_AlreadyProcessed() {
        testCollaborator.setStatus("accepted");
        when(collaboratorMapper.selectOne(any())).thenReturn(testCollaborator);

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            collaboratorService.acceptInvitation(testProjectId, testCollaboratorId);
        });

        assertTrue(exception.getMessage().contains("该邀请已处理"));
    }
}
