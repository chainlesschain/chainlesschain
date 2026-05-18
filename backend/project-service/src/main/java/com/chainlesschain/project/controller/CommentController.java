package com.chainlesschain.project.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.project.dto.ApiResponse;
import com.chainlesschain.project.dto.CommentCreateRequest;
import com.chainlesschain.project.dto.CommentDTO;
import com.chainlesschain.project.dto.CommentUpdateRequest;
import com.chainlesschain.project.service.CommentService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 项目评论控制器
 */
@Slf4j
@RestController
@RequestMapping("/api/projects/{projectId}/comments")
@RequiredArgsConstructor
public class CommentController {

    private final CommentService commentService;

    /**
     * 获取评论列表（支持按文件过滤）
     */
    @GetMapping
    public ApiResponse<Page<CommentDTO>> listComments(
            @PathVariable String projectId,
            @RequestParam(required = false) String filePath,
            @RequestParam(defaultValue = "1") int pageNum,
            @RequestParam(defaultValue = "20") int pageSize) {
        try {
            Page<CommentDTO> page = commentService.listComments(projectId, filePath, pageNum, pageSize);
            return ApiResponse.success(page);
        } catch (Exception e) {
            log.error("获取评论列表失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 添加评论
     */
    @PostMapping
    public ApiResponse<CommentDTO> addComment(
            @PathVariable String projectId,
            @Validated @RequestBody CommentCreateRequest request,
            @RequestHeader(value = "User-DID", required = false) String authorDid) {
        try {
            if (authorDid == null) {
                authorDid = "anonymous";  // 默认值
            }
            CommentDTO comment = commentService.addComment(projectId, request, authorDid);
            return ApiResponse.success("评论添加成功", comment);
        } catch (Exception e) {
            log.error("添加评论失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 更新评论
     */
    @PutMapping("/{commentId}")
    public ApiResponse<CommentDTO> updateComment(
            @PathVariable String projectId,
            @PathVariable String commentId,
            @Validated @RequestBody CommentUpdateRequest request) {
        try {
            CommentDTO comment = commentService.updateComment(projectId, commentId, request);
            return ApiResponse.success("评论更新成功", comment);
        } catch (Exception e) {
            log.error("更新评论失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 删除评论
     */
    @DeleteMapping("/{commentId}")
    public ApiResponse<Void> deleteComment(
            @PathVariable String projectId,
            @PathVariable String commentId) {
        try {
            commentService.deleteComment(projectId, commentId);
            return ApiResponse.success("评论删除成功", null);
        } catch (Exception e) {
            log.error("删除评论失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 回复评论
     */
    @PostMapping("/{commentId}/replies")
    public ApiResponse<CommentDTO> replyComment(
            @PathVariable String projectId,
            @PathVariable String commentId,
            @Validated @RequestBody CommentCreateRequest request,
            @RequestHeader(value = "User-DID", required = false) String authorDid) {
        try {
            if (authorDid == null) {
                authorDid = "anonymous";
            }
            // 设置父评论ID
            request.setParentCommentId(commentId);
            CommentDTO comment = commentService.addComment(projectId, request, authorDid);
            return ApiResponse.success("回复成功", comment);
        } catch (Exception e) {
            log.error("回复评论失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 获取评论回复
     */
    @GetMapping("/{commentId}/replies")
    public ApiResponse<List<CommentDTO>> getReplies(
            @PathVariable String projectId,
            @PathVariable String commentId) {
        try {
            List<CommentDTO> replies = commentService.getReplies(projectId, commentId);
            return ApiResponse.success(replies);
        } catch (Exception e) {
            log.error("获取评论回复失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }
}
