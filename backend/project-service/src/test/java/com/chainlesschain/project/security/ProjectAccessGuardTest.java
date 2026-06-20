package com.chainlesschain.project.security;

import com.chainlesschain.project.entity.Project;
import com.chainlesschain.project.entity.User;
import com.chainlesschain.project.mapper.ProjectCollaboratorMapper;
import com.chainlesschain.project.mapper.ProjectMapper;
import com.chainlesschain.project.mapper.UserMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * {@link ProjectAccessGuard} 单元测试 —— 项目级 IDOR 守卫的核心授权逻辑。
 */
@ExtendWith(MockitoExtension.class)
class ProjectAccessGuardTest {

    @Mock
    private ProjectMapper projectMapper;
    @Mock
    private ProjectCollaboratorMapper collaboratorMapper;
    @Mock
    private UserMapper userMapper;
    @InjectMocks
    private ProjectAccessGuard guard;

    private Authentication authAs(String username) {
        Authentication auth = mock(Authentication.class);
        when(auth.isAuthenticated()).thenReturn(true);
        when(auth.getName()).thenReturn(username);
        return auth;
    }

    private Project project(String userId, String ownerDid) {
        Project p = new Project();
        p.setUserId(userId);
        p.setOwnerDid(ownerDid);
        return p;
    }

    @Test
    void nullAuth_isAllowed_devModePermitAll() {
        // dev-mode（无认证）必须放行且不触碰任何 mapper（保持单机行为不变）
        assertDoesNotThrow(() -> guard.assertCanAccessProject("p1", null));
        verifyNoInteractions(projectMapper, collaboratorMapper, userMapper);
    }

    @Test
    void owner_byUsername_isAllowed() {
        Authentication auth = authAs("alice");
        when(userMapper.findByUsername("alice")).thenReturn(null); // username 自身即所有者标识
        when(projectMapper.selectById("p1")).thenReturn(project("alice", "alice"));

        assertDoesNotThrow(() -> guard.assertCanAccessProject("p1", auth));
        verify(collaboratorMapper, never()).selectCount(any()); // 所有者短路，不查协作者
    }

    @Test
    void owner_byResolvedDid_isAllowed() {
        Authentication auth = authAs("alice");
        User u = new User();
        u.setId("uid-1");
        u.setDid("did:abc");
        when(userMapper.findByUsername("alice")).thenReturn(u);
        // 项目历史上以 DID 形态记 owner（非 username）——解析身份集合后仍应匹配
        when(projectMapper.selectById("p1")).thenReturn(project("someone-else", "did:abc"));

        assertDoesNotThrow(() -> guard.assertCanAccessProject("p1", auth));
    }

    @Test
    void collaborator_isAllowed() {
        Authentication auth = authAs("bob");
        when(userMapper.findByUsername("bob")).thenReturn(null);
        when(projectMapper.selectById("p1")).thenReturn(project("alice", "alice"));
        when(collaboratorMapper.selectCount(any())).thenReturn(1L);

        assertDoesNotThrow(() -> guard.assertCanAccessProject("p1", auth));
    }

    @Test
    void stranger_isDenied() {
        Authentication auth = authAs("mallory");
        when(userMapper.findByUsername("mallory")).thenReturn(null);
        when(projectMapper.selectById("p1")).thenReturn(project("alice", "alice"));
        when(collaboratorMapper.selectCount(any())).thenReturn(0L);

        assertThrows(AccessDeniedException.class,
                () -> guard.assertCanAccessProject("p1", auth));
    }

    @Test
    void missingProject_isDeferredToService_notDenied() {
        Authentication auth = authAs("alice");
        when(projectMapper.selectById("missing")).thenReturn(null);

        // 项目不存在：放行交由下游 service 以 404 处理（不在守卫层泄露存在性）
        assertDoesNotThrow(() -> guard.assertCanAccessProject("missing", auth));
        verify(collaboratorMapper, never()).selectCount(any());
    }
}
