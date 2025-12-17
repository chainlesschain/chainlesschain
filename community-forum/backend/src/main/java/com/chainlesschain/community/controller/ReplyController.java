package com.chainlesschain.community.controller;

import com.chainlesschain.community.common.PageResult;
import com.chainlesschain.community.common.Result;
import com.chainlesschain.community.dto.ReplyCreateRequest;
import com.chainlesschain.community.service.ReplyService;
import com.chainlesschain.community.vo.ReplyVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import jakarta.validation.Valid;

/**
 * 回复控制器
 */
@RestController
@RequestMapping("")
@Tag(name = "回复管理", description = "帖子回复的增删改查、点赞等功能")
public class ReplyController {

    @Autowired
    private ReplyService replyService;

    /**
     * 获取帖子的回复列表
     */
    @GetMapping("/posts/{postId}/replies")
    @Operation(summary = "获取帖子回复列表", description = "分页查询指定帖子的所有回复")
    public Result<PageResult<ReplyVO>> getReplies(
            @Parameter(description = "帖子ID", required = true)
            @PathVariable Long postId,

            @Parameter(description = "页码", example = "1")
            @RequestParam(defaultValue = "1") Integer page,

            @Parameter(description = "每页数量", example = "20")
            @RequestParam(defaultValue = "20") Integer pageSize
    ) {
        return replyService.getRepliesByPostId(postId, page, pageSize);
    }

    /**
     * 创建回复
     */
    @PostMapping("/replies")
    @Operation(summary = "创建回复", description = "发表回复或回复某条评论")
    public Result<ReplyVO> createReply(@Valid @RequestBody ReplyCreateRequest request) {
        return replyService.createReply(request);
    }

    /**
     * 删除回复
     */
    @DeleteMapping("/replies/{id}")
    @Operation(summary = "删除回复", description = "删除指定回复（软删除）")
    public Result<Void> deleteReply(
            @Parameter(description = "回复ID", required = true)
            @PathVariable Long id
    ) {
        return replyService.deleteReply(id);
    }

    /**
     * 点赞回复
     */
    @PostMapping("/replies/{id}/like")
    @Operation(summary = "点赞回复", description = "给回复点赞")
    public Result<Void> likeReply(
            @Parameter(description = "回复ID", required = true)
            @PathVariable Long id
    ) {
        return replyService.likeReply(id);
    }

    /**
     * 取消点赞
     */
    @PostMapping("/replies/{id}/unlike")
    @Operation(summary = "取消点赞", description = "取消对回复的点赞")
    public Result<Void> unlikeReply(
            @Parameter(description = "回复ID", required = true)
            @PathVariable Long id
    ) {
        return replyService.unlikeReply(id);
    }

    /**
     * 设置最佳答案
     */
    @PostMapping("/posts/{postId}/best-answer")
    @Operation(summary = "设置最佳答案", description = "将某条回复设置为最佳答案（仅帖子作者可操作）")
    public Result<Void> setBestAnswer(
            @Parameter(description = "帖子ID", required = true)
            @PathVariable Long postId,

            @Parameter(description = "回复ID", required = true)
            @RequestParam Long replyId
    ) {
        return replyService.setBestAnswer(postId, replyId);
    }
}
