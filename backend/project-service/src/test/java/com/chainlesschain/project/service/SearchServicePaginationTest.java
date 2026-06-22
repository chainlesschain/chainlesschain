package com.chainlesschain.project.service;

import com.chainlesschain.project.dto.SearchRequest;
import com.chainlesschain.project.dto.SearchResponse;
import com.chainlesschain.project.entity.KnowledgeItem;
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

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

/**
 * Pagination edge-case tests for {@link SearchService}.
 *
 * <p>page/pageSize arrive from query params (SearchController.quickSearch) / the
 * request body with NO bean validation, so the service must clamp them. Before
 * the fix a negative pageSize crashed {@code subList} (IndexOutOfBounds → HTTP
 * 500) and pageSize=0 made {@code totalPages = ceil(n / 0)} = Infinity →
 * {@code (int) Integer.MAX_VALUE}. Runs in dev-mode (unauthenticated) so the
 * search executes unscoped without needing an auth fixture.
 */
@ExtendWith(MockitoExtension.class)
class SearchServicePaginationTest {

    @Mock private ConversationMapper conversationMapper;
    @Mock private ConversationMessageMapper conversationMessageMapper;
    @Mock private KnowledgeItemMapper knowledgeItemMapper;
    @Mock private ProjectCommentMapper projectCommentMapper;
    @Mock private ProjectFileMapper projectFileMapper;
    @Mock private ProjectAccessGuard accessGuard;
    @InjectMocks private SearchService searchService;

    private SearchRequest req(String type, Integer page, Integer pageSize) {
        SearchRequest r = new SearchRequest();
        r.setKeyword("hit");
        r.setType(type); // "post" → only searchKnowledge runs
        r.setPage(page);
        r.setPageSize(pageSize);
        return r;
    }

    private KnowledgeItem item(String id, String title) {
        KnowledgeItem k = new KnowledgeItem();
        k.setId(id);
        k.setTitle(title);
        return k;
    }

    @Test
    void negativePageSize_doesNotCrash_andIsClamped() {
        when(accessGuard.isCallerAuthenticated(any())).thenReturn(false);
        // Even with zero results, the old code hit subList(0, -5) → IllegalArgumentException.
        lenient().when(knowledgeItemMapper.selectList(any())).thenReturn(List.of());

        SearchResponse resp =
                assertDoesNotThrow(() -> searchService.search(req("post", 1, -5), null));

        assertTrue(resp.getPageSize() >= 1, "pageSize must be clamped to >= 1");
        assertEquals(0, resp.getTotalPages());
        assertTrue(resp.getResults().isEmpty());
    }

    @Test
    void zeroPageSize_doesNotProduceInfiniteTotalPages() {
        when(accessGuard.isCallerAuthenticated(any())).thenReturn(false);
        when(knowledgeItemMapper.selectList(any()))
                .thenReturn(List.of(item("k1", "hit one")));

        SearchResponse resp = searchService.search(req("post", 1, 0), null);

        // Pre-fix: ceil(1 / 0.0) = Infinity → (int) Integer.MAX_VALUE.
        assertNotEquals(Integer.MAX_VALUE, resp.getTotalPages());
        assertTrue(resp.getPageSize() >= 1);
        assertEquals(1, resp.getTotalPages());
        assertEquals(1, resp.getResults().size());
    }

    @Test
    void hugePageSize_isCappedTo200() {
        when(accessGuard.isCallerAuthenticated(any())).thenReturn(false);
        lenient().when(knowledgeItemMapper.selectList(any())).thenReturn(List.of());

        SearchResponse resp = searchService.search(req("post", 1, 1_000_000), null);

        assertEquals(200, resp.getPageSize());
    }

    @Test
    void nullPagingFields_fallBackToDefaults() {
        when(accessGuard.isCallerAuthenticated(any())).thenReturn(false);
        lenient().when(knowledgeItemMapper.selectList(any())).thenReturn(List.of());

        SearchResponse resp = searchService.search(req("post", null, null), null);

        assertEquals(1, resp.getPage());
        assertEquals(20, resp.getPageSize());
    }
}
