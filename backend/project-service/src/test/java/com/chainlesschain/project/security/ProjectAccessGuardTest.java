package com.chainlesschain.project.security;

import com.chainlesschain.project.entity.Conversation;
import com.chainlesschain.project.entity.ConversationMessage;
import com.chainlesschain.project.entity.Project;
import com.chainlesschain.project.entity.ProjectCollaborator;
import com.chainlesschain.project.entity.User;
import com.chainlesschain.project.mapper.ConversationMapper;
import com.chainlesschain.project.mapper.ConversationMessageMapper;
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

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
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
    @Mock
    private ConversationMapper conversationMapper;
    @Mock
    private ConversationMessageMapper messageMapper;
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

    private Conversation conversation(String projectId, String userId) {
        Conversation c = new Conversation();
        c.setProjectId(projectId);
        c.setUserId(userId);
        return c;
    }

    private ConversationMessage message(String conversationId) {
        ConversationMessage m = new ConversationMessage();
        m.setConversationId(conversationId);
        return m;
    }

    @Test
    void conversation_tiedToProject_ownerAllowed() {
        Authentication auth = authAs("alice");
        when(conversationMapper.selectById("c1")).thenReturn(conversation("p1", "alice"));
        when(userMapper.findByUsername("alice")).thenReturn(null);
        when(projectMapper.selectById("p1")).thenReturn(project("alice", "alice"));

        assertDoesNotThrow(() -> guard.assertCanAccessConversation("c1", auth));
    }

    @Test
    void conversation_noProject_ownerByUserId_allowed() {
        Authentication auth = authAs("alice");
        when(conversationMapper.selectById("c2")).thenReturn(conversation(null, "alice"));
        when(userMapper.findByUsername("alice")).thenReturn(null);

        assertDoesNotThrow(() -> guard.assertCanAccessConversation("c2", auth));
    }

    @Test
    void conversation_noProject_stranger_denied() {
        Authentication auth = authAs("mallory");
        when(conversationMapper.selectById("c3")).thenReturn(conversation(null, "alice"));
        when(userMapper.findByUsername("mallory")).thenReturn(null);

        assertThrows(AccessDeniedException.class,
                () -> guard.assertCanAccessConversation("c3", auth));
    }

    @Test
    void message_resolvesToConversationProject_ownerAllowed() {
        Authentication auth = authAs("alice");
        when(messageMapper.selectById("m1")).thenReturn(message("c1"));
        when(conversationMapper.selectById("c1")).thenReturn(conversation("p1", "alice"));
        when(userMapper.findByUsername("alice")).thenReturn(null);
        when(projectMapper.selectById("p1")).thenReturn(project("alice", "alice"));

        assertDoesNotThrow(() -> guard.assertCanAccessMessage("m1", auth));
    }

    // ── accessibleProjectIds (used by SearchService file scoping) ──

    @Test
    void accessibleProjectIds_returnsOwnedAndCollaboratorProjects() {
        Authentication auth = authAs("alice");
        User u = new User();
        u.setId("u1");
        u.setDid("did:x");
        when(userMapper.findByUsername("alice")).thenReturn(u);
        Project owned = new Project();
        owned.setId("p1");
        when(projectMapper.selectList(any())).thenReturn(List.of(owned));
        ProjectCollaborator collab = new ProjectCollaborator();
        collab.setProjectId("p2");
        when(collaboratorMapper.selectList(any())).thenReturn(List.of(collab));

        Set<String> ids = guard.accessibleProjectIds(auth);
        assertEquals(Set.of("p1", "p2"), ids);
    }

    @Test
    void accessibleProjectIds_emptyWhenUnauthenticated() {
        assertTrue(guard.accessibleProjectIds(null).isEmpty());
        verifyNoInteractions(projectMapper, collaboratorMapper);
    }

    @Test
    void isCallerAuthenticated_reflectsState() {
        assertTrue(guard.isCallerAuthenticated(authAs("alice")));
        assertFalse(guard.isCallerAuthenticated(null));
    }
}
