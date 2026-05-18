package com.chainlesschain.project.service;

import com.baomidou.mybatisplus.core.toolkit.IdWorker;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.project.dto.CommentCreateRequest;
import com.chainlesschain.project.dto.CommentDTO;
import com.chainlesschain.project.dto.CommentUpdateRequest;
import com.chainlesschain.project.entity.ProjectComment;
import com.chainlesschain.project.mapper.ProjectCommentMapper;
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
 * 评论服务测试
 */
@ExtendWith(MockitoExtension.class)
class CommentServiceTest {

    @Mock
    private ProjectCommentMapper commentMapper;

    @InjectMocks
    private CommentService commentService;

    private String testProjectId;
    private String testCommentId;
    private ProjectComment testComment;

    @BeforeEach
    void setUp() {
        testProjectId = IdWorker.get32UUID();
        testCommentId = IdWorker.get32UUID();

        testComment = new ProjectComment();
        testComment.setId(testCommentId);
        testComment.setProjectId(testProjectId);
        testComment.setFilePath("src/main/java/Test.java");
        testComment.setLineNumber(10);
        testComment.setAuthorDid("did:test:author");
        testComment.setContent("这是一条测试评论");
        testComment.setCreatedAt(LocalDateTime.now());
    }

    @Test
    void testListComments_Success() {
        // 准备数据
        List<ProjectComment> comments = Arrays.asList(testComment);
        Page<ProjectComment> page = new Page<>(1, 20);
        page.setRecords(comments);
        page.setTotal(1);

        when(commentMapper.selectPage(any(Page.class), any())).thenReturn(page);
        when(commentMapper.selectCount(any())).thenReturn(0L); // 无回复

        // 执行测试
        Page<CommentDTO> result = commentService.listComments(testProjectId, null, 1, 20);

        // 验证结果
        assertNotNull(result);
        assertEquals(1, result.getTotal());
        assertEquals(1, result.getRecords().size());
        assertEquals(testComment.getContent(), result.getRecords().get(0).getContent());

        verify(commentMapper, times(1)).selectPage(any(Page.class), any());
    }

    @Test
    void testListComments_WithFilePathFilter() {
        // 准备数据
        List<ProjectComment> comments = Arrays.asList(testComment);
        Page<ProjectComment> page = new Page<>(1, 20);
        page.setRecords(comments);
        page.setTotal(1);

        when(commentMapper.selectPage(any(Page.class), any())).thenReturn(page);
        when(commentMapper.selectCount(any())).thenReturn(0L);

        // 执行测试
        Page<CommentDTO> result = commentService.listComments(
            testProjectId, "src/main/java/Test.java", 1, 20
        );

        // 验证结果
        assertNotNull(result);
        assertEquals(1, result.getTotal());
        verify(commentMapper, times(1)).selectPage(any(Page.class), any());
    }

    @Test
    void testAddComment_Success() {
        when(commentMapper.insert(any(ProjectComment.class))).thenReturn(1);
        when(commentMapper.selectCount(any())).thenReturn(0L);

        // 准备请求
        CommentCreateRequest request = new CommentCreateRequest();
        request.setFilePath("src/main/java/Test.java");
        request.setLineNumber(10);
        request.setContent("测试评论");

        // 执行测试
        CommentDTO result = commentService.addComment(testProjectId, request, "did:test:author");

        // 验证结果
        assertNotNull(result);
        assertEquals(request.getContent(), result.getContent());
        assertEquals(request.getLineNumber(), result.getLineNumber());

        verify(commentMapper, times(1)).insert(any(ProjectComment.class));
    }

    @Test
    void testUpdateComment_Success() {
        when(commentMapper.selectOne(any())).thenReturn(testComment);
        when(commentMapper.updateById(any(ProjectComment.class))).thenReturn(1);
        when(commentMapper.selectCount(any())).thenReturn(0L);

        // 准备请求
        CommentUpdateRequest request = new CommentUpdateRequest();
        request.setContent("更新后的评论");

        // 执行测试
        CommentDTO result = commentService.updateComment(testProjectId, testCommentId, request);

        // 验证结果
        assertNotNull(result);
        assertEquals(request.getContent(), testComment.getContent());

        verify(commentMapper, times(1)).selectOne(any());
        verify(commentMapper, times(1)).updateById(any(ProjectComment.class));
    }

    @Test
    void testUpdateComment_NotFound() {
        when(commentMapper.selectOne(any())).thenReturn(null);

        CommentUpdateRequest request = new CommentUpdateRequest();
        request.setContent("更新的评论");

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            commentService.updateComment(testProjectId, testCommentId, request);
        });

        assertTrue(exception.getMessage().contains("评论不存在"));
    }

    @Test
    void testDeleteComment_Success() {
        when(commentMapper.selectOne(any())).thenReturn(testComment);
        when(commentMapper.delete(any())).thenReturn(0); // 无回复
        when(commentMapper.deleteById(testCommentId)).thenReturn(1);

        // 执行测试
        assertDoesNotThrow(() -> {
            commentService.deleteComment(testProjectId, testCommentId);
        });

        verify(commentMapper, times(1)).selectOne(any());
        verify(commentMapper, times(1)).delete(any()); // 删除回复
        verify(commentMapper, times(1)).deleteById(testCommentId);
    }

    @Test
    void testDeleteComment_NotFound() {
        when(commentMapper.selectOne(any())).thenReturn(null);

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            commentService.deleteComment(testProjectId, testCommentId);
        });

        assertTrue(exception.getMessage().contains("评论不存在"));
    }

    @Test
    void testGetReplies_Success() {
        // 准备数据
        ProjectComment reply1 = new ProjectComment();
        reply1.setId(IdWorker.get32UUID());
        reply1.setProjectId(testProjectId);
        reply1.setParentCommentId(testCommentId);
        reply1.setContent("回复1");

        ProjectComment reply2 = new ProjectComment();
        reply2.setId(IdWorker.get32UUID());
        reply2.setProjectId(testProjectId);
        reply2.setParentCommentId(testCommentId);
        reply2.setContent("回复2");

        when(commentMapper.selectList(any())).thenReturn(Arrays.asList(reply1, reply2));
        when(commentMapper.selectCount(any())).thenReturn(0L);

        // 执行测试
        List<CommentDTO> results = commentService.getReplies(testProjectId, testCommentId);

        // 验证结果
        assertNotNull(results);
        assertEquals(2, results.size());
        assertEquals("回复1", results.get(0).getContent());
        assertEquals("回复2", results.get(1).getContent());

        verify(commentMapper, times(1)).selectList(any());
    }

    @Test
    void testAddComment_WithParent() {
        when(commentMapper.insert(any(ProjectComment.class))).thenReturn(1);
        when(commentMapper.selectCount(any())).thenReturn(0L);

        // 准备请求（带父评论ID）
        CommentCreateRequest request = new CommentCreateRequest();
        request.setFilePath("src/main/java/Test.java");
        request.setContent("回复评论");
        request.setParentCommentId(testCommentId);

        // 执行测试
        CommentDTO result = commentService.addComment(testProjectId, request, "did:test:replier");

        // 验证结果
        assertNotNull(result);
        assertEquals(request.getContent(), result.getContent());
        assertEquals(testCommentId, result.getParentCommentId());

        verify(commentMapper, times(1)).insert(any(ProjectComment.class));
    }
}
