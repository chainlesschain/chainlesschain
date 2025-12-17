package com.chainlesschain.community.controller;

import com.chainlesschain.community.common.PageResult;
import com.chainlesschain.community.common.Result;
import com.chainlesschain.community.dto.UserUpdateRequest;
import com.chainlesschain.community.entity.Favorite;
import com.chainlesschain.community.entity.Reply;
import com.chainlesschain.community.service.UserService;
import com.chainlesschain.community.vo.PostListVO;
import com.chainlesschain.community.vo.UserVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import jakarta.validation.Valid;
import java.util.List;

/**
 * 用户控制器
 */
@RestController
@RequestMapping("/api/users")
@Tag(name = "用户管理", description = "用户信息、关注系统、收藏列表等功能")
public class UserController {

    @Autowired
    private UserService userService;

    /**
     * 获取用户信息
     */
    @GetMapping("/{id}")
    @Operation(summary = "获取用户信息", description = "根据用户ID获取用户详细信息")
    public Result<UserVO> getUser(
            @Parameter(description = "用户ID", required = true)
            @PathVariable Long id
    ) {
        return userService.getUserById(id);
    }

    /**
     * 更新用户信息
     */
    @PutMapping("/profile")
    @Operation(summary = "更新用户信息", description = "修改当前用户的个人信息")
    public Result<UserVO> updateProfile(@Valid @RequestBody UserUpdateRequest request) {
        return userService.updateUserProfile(request);
    }

    /**
     * 获取用户的帖子列表
     */
    @GetMapping("/{id}/posts")
    @Operation(summary = "获取用户的帖子", description = "分页查询指定用户发布的所有帖子")
    public Result<PageResult<PostListVO>> getUserPosts(
            @Parameter(description = "用户ID", required = true)
            @PathVariable Long id,

            @Parameter(description = "页码", example = "1")
            @RequestParam(defaultValue = "1") Integer page,

            @Parameter(description = "每页数量", example = "20")
            @RequestParam(defaultValue = "20") Integer pageSize
    ) {
        return userService.getUserPosts(id, page, pageSize);
    }

    /**
     * 获取用户的回复列表
     */
    @GetMapping("/{id}/replies")
    @Operation(summary = "获取用户的回复", description = "分页查询指定用户的所有回复")
    public Result<PageResult<Reply>> getUserReplies(
            @Parameter(description = "用户ID", required = true)
            @PathVariable Long id,

            @Parameter(description = "页码", example = "1")
            @RequestParam(defaultValue = "1") Integer page,

            @Parameter(description = "每页数量", example = "20")
            @RequestParam(defaultValue = "20") Integer pageSize
    ) {
        return userService.getUserReplies(id, page, pageSize);
    }

    /**
     * 关注用户
     */
    @PostMapping("/{id}/follow")
    @Operation(summary = "关注用户", description = "关注指定用户")
    public Result<Void> followUser(
            @Parameter(description = "用户ID", required = true)
            @PathVariable Long id
    ) {
        return userService.followUser(id);
    }

    /**
     * 取消关注
     */
    @PostMapping("/{id}/unfollow")
    @Operation(summary = "取消关注", description = "取消关注指定用户")
    public Result<Void> unfollowUser(
            @Parameter(description = "用户ID", required = true)
            @PathVariable Long id
    ) {
        return userService.unfollowUser(id);
    }

    /**
     * 获取关注列表
     */
    @GetMapping("/{id}/following")
    @Operation(summary = "获取关注列表", description = "查询用户关注的所有用户")
    public Result<PageResult<UserVO>> getFollowing(
            @Parameter(description = "用户ID", required = true)
            @PathVariable Long id,

            @Parameter(description = "页码", example = "1")
            @RequestParam(defaultValue = "1") Integer page,

            @Parameter(description = "每页数量", example = "20")
            @RequestParam(defaultValue = "20") Integer pageSize
    ) {
        return userService.getFollowing(id, page, pageSize);
    }

    /**
     * 获取粉丝列表
     */
    @GetMapping("/{id}/followers")
    @Operation(summary = "获取粉丝列表", description = "查询用户的所有粉丝")
    public Result<PageResult<UserVO>> getFollowers(
            @Parameter(description = "用户ID", required = true)
            @PathVariable Long id,

            @Parameter(description = "页码", example = "1")
            @RequestParam(defaultValue = "1") Integer page,

            @Parameter(description = "每页数量", example = "20")
            @RequestParam(defaultValue = "20") Integer pageSize
    ) {
        return userService.getFollowers(id, page, pageSize);
    }

    /**
     * 获取收藏列表
     */
    @GetMapping("/favorites")
    @Operation(summary = "获取收藏列表", description = "查询当前用户的所有收藏")
    public Result<PageResult<Favorite>> getFavorites(
            @Parameter(description = "页码", example = "1")
            @RequestParam(defaultValue = "1") Integer page,

            @Parameter(description = "每页数量", example = "20")
            @RequestParam(defaultValue = "20") Integer pageSize
    ) {
        return userService.getFavorites(page, pageSize);
    }

    /**
     * 搜索用户
     */
    @GetMapping("/search")
    @Operation(summary = "搜索用户", description = "根据关键词搜索用户")
    public Result<List<UserVO>> searchUsers(
            @Parameter(description = "搜索关键词")
            @RequestParam String keyword
    ) {
        return userService.searchUsers(keyword);
    }
}
