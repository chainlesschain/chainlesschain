package com.chainlesschain.project.service;

import com.chainlesschain.project.dto.SearchRequest;
import com.chainlesschain.project.mapper.ConversationMapper;
import com.chainlesschain.project.mapper.ConversationMessageMapper;
import com.chainlesschain.project.mapper.KnowledgeItemMapper;
import com.chainlesschain.project.mapper.ProjectCommentMapper;
import com.chainlesschain.project.mapper.ProjectFileMapper;
import com.chainlesschain.project.security.ProjectAccessGuard;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.core.Authentication;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Authorization-scoping tests for {@link SearchService} (#6 cross-user disclosure).
 *
 * <p>Previously search filtered by *optional client-supplied* userId/projectId, and the
 * message-content search + suggestions had NO filter at all → any authenticated user could
 * read everyone's conversations/messages/knowledge/comments/files by omitting the filters.
 *
 * <p>Wrapper internals can't be inspected without a live MyBatis context
 * (getParamNameValuePairs is populated lazily at SQL render), so these tests assert the fix
 * BEHAVIORALLY: (1) resolveScope derives the scope from the caller (not the client request);
 * (2) when authenticated, the previously-unfiltered cross-user queries (message search,
 * file search) are GATED on the caller's own conversations / accessible projects and do not
 * run when the caller has none; (3) dev-mode (unauthenticated) preserves the old behavior.
 */
@ExtendWith(MockitoExtension.class)
class SearchServiceScopingTest {

    @Mock private ConversationMapper conversationMapper;
    @Mock private ConversationMessageMapper conversationMessageMapper;
    @Mock private KnowledgeItemMapper knowledgeItemMapper;
    @Mock private ProjectCommentMapper projectCommentMapper;
    @Mock private ProjectFileMapper projectFileMapper;
    @Mock private ProjectAccessGuard accessGuard;
    @InjectMocks private SearchService searchService;

    private Authentication authAs(String name) {
        Authentication a = mock(Authentication.class);
        lenient().when(a.getName()).thenReturn(name);
        return a;
    }

    private SearchRequest req(String keyword, String type, String spoofUserId) {
        SearchRequest r = new SearchRequest();
        r.setKeyword(keyword);
        r.setType(type);
        r.setPage(1);
        r.setPageSize(20);
        r.setUserId(spoofUserId);
        return r;
    }

    private void stubAuthed(Authentication auth, Set<String> identities, Set<String> projectIds) {
        when(accessGuard.isCallerAuthenticated(auth)).thenReturn(true);
        lenient().when(accessGuard.callerIdentities(auth)).thenReturn(identities);
        lenient().when(accessGuard.accessibleProjectIds(auth)).thenReturn(projectIds);
    }

    // ── resolveScope: the scope is derived from the CALLER, not the client request ──

    @Test
    void resolveScope_authenticated_buildsCallerScope() {
        Authentication auth = authAs("alice");
        stubAuthed(auth, Set.of("alice", "u1"), Set.of("p1"));

        SearchService.Scope scope = searchService.resolveScope(auth);
        assertTrue(scope.enforce);
        assertEquals(Set.of("alice", "u1"), scope.identities); // caller identities, not client userId
        assertEquals(Set.of("p1"), scope.projectIds);
        assertEquals("u:alice", scope.cacheKeyPart); // per-caller cache key (no cross-user hit)
    }

    @Test
    void resolveScope_devMode_noEnforce() {
        when(accessGuard.isCallerAuthenticated(any())).thenReturn(false);
        SearchService.Scope scope = searchService.resolveScope(null);
        assertFalse(scope.enforce);
        assertEquals("dev", scope.cacheKeyPart);
    }

    // ── message-content search: the worst leak (was entirely unfiltered) ──

    @Test
    void authenticated_withNoOwnConversations_doesNotRunMessageSearch() {
        Authentication auth = authAs("alice");
        stubAuthed(auth, Set.of("alice"), Set.of("p1"));
        when(conversationMapper.selectList(any())).thenReturn(List.of());   // no caller conversations
        lenient().when(knowledgeItemMapper.selectList(any())).thenReturn(List.of()); // suggestions

        searchService.search(req("secret", "conversation", "victim"), auth);

        // Caller owns no conversations → message search must be skipped entirely
        // (it has no userId column; previously it leaked everyone's messages).
        verify(conversationMessageMapper, never()).selectList(any());
    }

    @Test
    void devMode_runsMessageSearch_unscoped() {
        when(accessGuard.isCallerAuthenticated(any())).thenReturn(false);
        when(conversationMapper.selectList(any())).thenReturn(List.of());
        when(conversationMessageMapper.selectList(any())).thenReturn(List.of());
        lenient().when(knowledgeItemMapper.selectList(any())).thenReturn(List.of());

        searchService.search(req("secret", "conversation", null), null);

        // dev-mode preserves the old behavior: message search runs unconditionally.
        verify(conversationMessageMapper, atLeastOnce()).selectList(any());
    }

    // ── file search: files have no userId, only projectId ──

    @Test
    void authenticated_withNoAccessibleProjects_doesNotRunFileSearch() {
        Authentication auth = authAs("alice");
        stubAuthed(auth, Set.of("alice"), Set.of()); // no accessible projects
        lenient().when(conversationMapper.selectList(any())).thenReturn(List.of());
        lenient().when(knowledgeItemMapper.selectList(any())).thenReturn(List.of());

        searchService.search(req("secret", "file", "victim"), auth);

        // No accessible projects → file search must not touch the DB (was: all files).
        verify(projectFileMapper, never()).selectList(any());
    }

    @Test
    void devMode_runsFileSearch() {
        when(accessGuard.isCallerAuthenticated(any())).thenReturn(false);
        when(projectFileMapper.selectList(any())).thenReturn(List.of());
        lenient().when(conversationMapper.selectList(any())).thenReturn(List.of());
        lenient().when(knowledgeItemMapper.selectList(any())).thenReturn(List.of());

        searchService.search(req("secret", "file", null), null);

        verify(projectFileMapper, atLeastOnce()).selectList(any());
    }
}
