package com.chainlesschain.community.controller;

import com.chainlesschain.community.common.PageResult;
import com.chainlesschain.community.common.Result;
import com.chainlesschain.community.dto.PostCreateRequest;
import com.chainlesschain.community.dto.PostUpdateRequest;
import com.chainlesschain.community.service.PostService;
import com.chainlesschain.community.vo.PostListVO;
import com.chainlesschain.community.vo.PostVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import javax.validation.Valid;

/**
 * 帖子控制器
 */
@RestController
@RequestMapping("/api/posts")
@Tag(name = "帖子管理", description = "帖子的增删改查、点赞、收藏等功能")
public class PostController {

    @Autowired
    private PostService postService;

    /**
     * 获取帖子列表
     */
    @GetMapping
    @Operation(summary = "获取帖子列表", description = "分页查询帖子列表，支持按分类筛选和排序")
    public Result<PageResult<PostListVO>> getPosts(
            @Parameter(description = "页码", example = "1")
            @RequestParam(defaultValue = "1") Integer page,

            @Parameter(description = "每页数量", example = "20")
            @RequestParam(defaultValue = "20") Integer pageSize,

            @Parameter(description = "分类ID")
            @RequestParam(required = false) Long categoryId,

            @Parameter(description = "排序方式：latest(最新), hot(热门)")
            @RequestParam(defaultValue = "latest") String sortBy
    ) {
        return postService.getPosts(page, pageSize, categoryId, sortBy);
    }

    /**
     * 获取帖子详情
     */
    @GetMapping("/{id}")
    @Operation(summary = "获取帖子详情", description = "根据帖子ID获取详细信息")
    public Result<PostVO> getPost(
            @Parameter(description = "帖子ID", required = true)
            @PathVariable Long id
    ) {
        return postService.getPostById(id);
    }

    /**
     * 创建帖子
     */
    @PostMapping
    @Operation(summary = "创建帖子", description = "发布新帖子")
    public Result<PostVO> createPost(@Valid @RequestBody PostCreateRequest request) {
        return postService.createPost(request);
    }

    /**
     * 更新帖子
     */
    @PutMapping("/{id}")
    @Operation(summary = "更新帖子", description = "修改帖子内容")
    public Result<PostVO> updatePost(
            @Parameter(description = "帖子ID", required = true)
            @PathVariable Long id,

            @Valid @RequestBody PostUpdateRequest request
    ) {
        return postService.updatePost(id, request);
    }

    /**
     * 删除帖子
     */
    @DeleteMapping("/{id}")
    @Operation(summary = "删除帖子", description = "删除指定帖子（软删除）")
    public Result<Void> deletePost(
            @Parameter(description = "帖子ID", required = true)
            @PathVariable Long id
    ) {
        return postService.deletePost(id);
    }

    /**
     * 点赞帖子
     */
    @PostMapping("/{id}/like")
    @Operation(summary = "点赞帖子", description = "给帖子点赞")
    public Result<Void> likePost(
            @Parameter(description = "帖子ID", required = true)
            @PathVariable Long id
    ) {
        return postService.likePost(id);
    }

    /**
     * 取消点赞
     */
    @PostMapping("/{id}/unlike")
    @Operation(summary = "取消点赞", description = "取消对帖子的点赞")
    public Result<Void> unlikePost(
            @Parameter(description = "帖子ID", required = true)
            @PathVariable Long id
    ) {
        return postService.unlikePost(id);
    }

    /**
     * 收藏帖子
     */
    @PostMapping("/{id}/favorite")
    @Operation(summary = "收藏帖子", description = "收藏帖子到个人收藏夹")
    public Result<Void> favoritePost(
            @Parameter(description = "帖子ID", required = true)
            @PathVariable Long id
    ) {
        return postService.favoritePost(id);
    }

    /**
     * 取消收藏
     */
    @PostMapping("/{id}/unfavorite")
    @Operation(summary = "取消收藏", description = "从收藏夹中移除帖子")
    public Result<Void> unfavoritePost(
            @Parameter(description = "帖子ID", required = true)
            @PathVariable Long id
    ) {
        return postService.unfavoritePost(id);
    }
}
