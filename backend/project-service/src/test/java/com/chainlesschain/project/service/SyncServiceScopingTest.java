package com.chainlesschain.project.service;

import com.chainlesschain.project.dto.SyncRequestDTO;
import com.chainlesschain.project.entity.Project;
import com.chainlesschain.project.entity.SyncLog;
import com.chainlesschain.project.mapper.ConversationMapper;
import com.chainlesschain.project.mapper.ConversationMessageMapper;
import com.chainlesschain.project.mapper.ProjectFileMapper;
import com.chainlesschain.project.mapper.ProjectMapper;
import com.chainlesschain.project.mapper.SyncLogMapper;
import com.chainlesschain.project.security.ProjectAccessGuard;
import com.chainlesschain.project.service.impl.SyncServiceImpl;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.core.Authentication;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Authorization-scoping tests for {@link SyncServiceImpl#downloadIncremental} (#7 IDOR).
 *
 * <p>Was: incremental download filtered ONLY by timestamp, with no owner/user filter — any
 * authenticated user could pull EVERY user's raw rows (projects/files/conversations/messages/
 * knowledge) by passing any deviceId. Now an authenticated caller is scoped to their own
 * identities + accessible projects (reusing {@link ProjectAccessGuard}); when the caller has
 * no accessible scope the cross-user query is not run at all. dev-mode preserves old behavior.
 * Assertions are behavioral (MyBatis-Plus wrapper params aren't unit-inspectable).
 */
@ExtendWith(MockitoExtension.class)
class SyncServiceScopingTest {

    @Mock private ProjectMapper projectMapper;
    @Mock private ProjectFileMapper projectFileMapper;
    @Mock private ConversationMapper conversationMapper;
    @Mock private ConversationMessageMapper conversationMessageMapper;
    @Mock private SyncLogMapper syncLogMapper;
    @Mock private ProjectAccessGuard accessGuard;
    private SyncServiceImpl syncService;

    @BeforeEach
    void setUp() {
        // The impl has a required-arg constructor (builds a TransactionTemplate); the rest
        // are @Autowired fields injected explicitly below for deterministic mocking.
        syncService = new SyncServiceImpl(mock(PlatformTransactionManager.class));
        ReflectionTestUtils.setField(syncService, "projectMapper", projectMapper);
        ReflectionTestUtils.setField(syncService, "projectFileMapper", projectFileMapper);
        ReflectionTestUtils.setField(syncService, "conversationMapper", conversationMapper);
        ReflectionTestUtils.setField(syncService, "conversationMessageMapper", conversationMessageMapper);
        ReflectionTestUtils.setField(syncService, "syncLogMapper", syncLogMapper);
        ReflectionTestUtils.setField(syncService, "accessGuard", accessGuard);
        // Audit-log insert succeeds by default so the upload success path doesn't error.
        lenient().when(syncLogMapper.insert(any(SyncLog.class))).thenReturn(1);
    }

    private SyncRequestDTO uploadReq(String table, String deviceId, String recordId) {
        Map<String, Object> rec = new HashMap<>();
        rec.put("id", recordId);
        SyncRequestDTO req = new SyncRequestDTO();
        req.setTableName(table);
        req.setDeviceId(deviceId);
        req.setRecords(List.of(rec));
        req.setForceOverwrite(false);
        return req;
    }

    private Project project(String id, String userId) {
        Project p = new Project();
        p.setId(id);
        p.setUserId(userId);
        return p;
    }

    private Authentication authAs(String name) {
        Authentication a = mock(Authentication.class);
        lenient().when(a.getName()).thenReturn(name);
        return a;
    }

    @Test
    void authenticated_noAccessibleProjects_fileDownload_runsNoQuery() {
        Authentication auth = authAs("alice");
        when(accessGuard.isCallerAuthenticated(auth)).thenReturn(true);
        lenient().when(accessGuard.callerIdentities(auth)).thenReturn(Set.of("alice"));
        when(accessGuard.accessibleProjectIds(auth)).thenReturn(Set.of()); // no projects

        syncService.downloadIncremental("project_files", 0L, "dev1", auth);

        // No accessible projects → must NOT query (was: returned all users' files).
        verify(projectFileMapper, never()).selectMaps(any());
    }

    @Test
    void devMode_fileDownload_queriesUnscoped() {
        when(accessGuard.isCallerAuthenticated(any())).thenReturn(false);
        when(projectFileMapper.selectMaps(any())).thenReturn(new ArrayList<>());

        syncService.downloadIncremental("project_files", 0L, "dev1", null);

        verify(projectFileMapper, atLeastOnce()).selectMaps(any());
    }

    @Test
    void authenticated_noOwnConversations_messageDownload_runsNoQuery() {
        Authentication auth = authAs("alice");
        when(accessGuard.isCallerAuthenticated(auth)).thenReturn(true);
        when(accessGuard.callerIdentities(auth)).thenReturn(Set.of("alice"));
        when(accessGuard.accessibleProjectIds(auth)).thenReturn(Set.of("p1"));
        when(conversationMapper.selectList(any())).thenReturn(new ArrayList<>()); // no caller convs

        syncService.downloadIncremental("messages", 0L, "dev1", auth);

        // Caller owns no conversations → message rows must not be queried.
        verify(conversationMessageMapper, never()).selectMaps(any());
    }

    @Test
    void authenticated_projectsDownload_isQueriedScoped() {
        Authentication auth = authAs("alice");
        when(accessGuard.isCallerAuthenticated(auth)).thenReturn(true);
        when(accessGuard.callerIdentities(auth)).thenReturn(Set.of("alice"));
        lenient().when(accessGuard.accessibleProjectIds(auth)).thenReturn(Set.of("p1"));
        when(projectMapper.selectMaps(any())).thenReturn(new ArrayList<>());

        syncService.downloadIncremental("projects", 0L, "dev1", auth);

        // projects always queried (caller always has an identity), now owner-scoped.
        verify(projectMapper, atLeastOnce()).selectMaps(any());
    }

    // ==================== upload write-authz (#7 upload side) ====================

    @Test
    void authenticated_uploadOverwriteForeignProject_isDenied() {
        Authentication auth = authAs("alice");
        when(accessGuard.isCallerAuthenticated(auth)).thenReturn(true);
        when(accessGuard.callerIdentities(auth)).thenReturn(Set.of("alice"));
        when(accessGuard.accessibleProjectIds(auth)).thenReturn(Set.of("p-alice"));
        when(projectMapper.selectById("X")).thenReturn(project("X", "bob")); // owned by someone else

        Map<String, Object> result = syncService.uploadBatch(uploadReq("projects", "dev1", "X"), auth);

        assertEquals(1, result.get("deniedCount"));
        assertEquals(0, result.get("successCount"));
        // The foreign row must NOT be overwritten.
        verify(projectMapper, never()).updateById(any(Project.class));
        verify(projectMapper, never()).insert(any(Project.class));
    }

    @Test
    void authenticated_uploadOwnProject_isWritten() {
        Authentication auth = authAs("alice");
        when(accessGuard.isCallerAuthenticated(auth)).thenReturn(true);
        when(accessGuard.callerIdentities(auth)).thenReturn(Set.of("alice"));
        when(accessGuard.accessibleProjectIds(auth)).thenReturn(Set.of());
        when(projectMapper.selectById("X")).thenReturn(project("X", "alice")); // caller's own row

        Map<String, Object> result = syncService.uploadBatch(uploadReq("projects", "dev1", "X"), auth);

        assertEquals(0, result.get("deniedCount"));
        assertEquals(1, result.get("successCount"));
        verify(projectMapper).updateById(any(Project.class)); // legitimate self-update proceeds
    }

    @Test
    void authenticated_uploadNewRecord_isAllowed() {
        Authentication auth = authAs("alice");
        when(accessGuard.isCallerAuthenticated(auth)).thenReturn(true);
        when(accessGuard.callerIdentities(auth)).thenReturn(Set.of("alice"));
        when(accessGuard.accessibleProjectIds(auth)).thenReturn(Set.of());
        when(projectMapper.selectById("NEW")).thenReturn(null); // no existing row → insert

        Map<String, Object> result = syncService.uploadBatch(uploadReq("projects", "dev1", "NEW"), auth);

        assertEquals(0, result.get("deniedCount"));
        assertEquals(1, result.get("successCount"));
        verify(projectMapper).insert(any(Project.class)); // new-record insert is not blocked
    }

    @Test
    void devMode_uploadOverwriteForeign_isAllowed() {
        when(accessGuard.isCallerAuthenticated(any())).thenReturn(false); // dev-mode / unauthenticated
        when(projectMapper.selectById("X")).thenReturn(project("X", "bob"));

        Map<String, Object> result = syncService.uploadBatch(uploadReq("projects", "dev1", "X"), null);

        assertEquals(0, result.get("deniedCount")); // gate disabled in dev-mode
        verify(projectMapper).updateById(any(Project.class));     // old unscoped behavior preserved
    }
}
