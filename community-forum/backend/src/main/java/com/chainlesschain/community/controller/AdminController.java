package com.chainlesschain.community.controller;

import com.chainlesschain.community.common.PageResult;
import com.chainlesschain.community.common.Result;
import com.chainlesschain.community.entity.Post;
import com.chainlesschain.community.entity.Report;
import com.chainlesschain.community.service.AdminService;
import com.chainlesschain.community.vo.UserVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * 管理员控制器
 */
@RestController
@RequestMapping("/api/admin")
@Tag(name = "管理员功能", description = "用户管理、内容审核、举报处理等管理功能")
public class AdminController {

    @Autowired
    private AdminService adminService;

    /**
     * 获取仪表盘统计数据
     */
    @GetMapping("/dashboard/stats")
    @Operation(summary = "获取仪表盘统计", description = "获取用户、帖子、举报等统计数据")
    public Result<Map<String, Object>> getDashboardStats() {
        return adminService.getDashboardStats();
    }

    /**
     * 获取用户列表
     */
    @GetMapping("/users")
    @Operation(summary = "获取用户列表", description = "分页查询用户，支持筛选和搜索")
    public Result<PageResult<UserVO>> getUsers(
            @Parameter(description = "页码", example = "1")
            @RequestParam(defaultValue = "1") Integer page,

            @Parameter(description = "每页数量", example = "20")
            @RequestParam(defaultValue = "20") Integer pageSize,

            @Parameter(description = "用户状态筛选")
            @RequestParam(required = false) String status,

            @Parameter(description = "角色筛选")
            @RequestParam(required = false) String role,

            @Parameter(description = "搜索关键词")
            @RequestParam(required = false) String keyword
    ) {
        return adminService.getUsers(page, pageSize, status, role, keyword);
    }

    /**
     * 封禁用户
     */
    @PostMapping("/users/{id}/ban")
    @Operation(summary = "封禁用户", description = "封禁指定用户")
    public Result<Void> banUser(
            @Parameter(description = "用户ID", required = true)
            @PathVariable Long id,

            @Parameter(description = "封禁原因")
            @RequestParam String reason
    ) {
        return adminService.banUser(id, reason);
    }

    /**
     * 解封用户
     */
    @PostMapping("/users/{id}/unban")
    @Operation(summary = "解封用户", description = "解封被封禁的用户")
    public Result<Void> unbanUser(
            @Parameter(description = "用户ID", required = true)
            @PathVariable Long id
    ) {
        return adminService.unbanUser(id);
    }

    /**
     * 删除用户
     */
    @DeleteMapping("/users/{id}")
    @Operation(summary = "删除用户", description = "删除指定用户（软删除）")
    public Result<Void> deleteUser(
            @Parameter(description = "用户ID", required = true)
            @PathVariable Long id
    ) {
        return adminService.deleteUser(id);
    }

    /**
     * 更新用户角色
     */
    @PutMapping("/users/{id}/role")
    @Operation(summary = "更新用户角色", description = "修改用户的角色（USER/ADMIN）")
    public Result<Void> updateUserRole(
            @Parameter(description = "用户ID", required = true)
            @PathVariable Long id,

            @Parameter(description = "新角色", required = true)
            @RequestParam String role
    ) {
        return adminService.updateUserRole(id, role);
    }

    /**
     * 获取待审核帖子
     */
    @GetMapping("/posts/pending")
    @Operation(summary = "获取待审核帖子", description = "查询所有待审核的帖子")
    public Result<PageResult<Post>> getPendingPosts(
            @Parameter(description = "页码", example = "1")
            @RequestParam(defaultValue = "1") Integer page,

            @Parameter(description = "每页数量", example = "20")
            @RequestParam(defaultValue = "20") Integer pageSize
    ) {
        return adminService.getPendingPosts(page, pageSize);
    }

    /**
     * 获取被举报帖子
     */
    @GetMapping("/posts/reported")
    @Operation(summary = "获取被举报帖子", description = "查询所有被举报的帖子")
    public Result<PageResult<Post>> getReportedPosts(
            @Parameter(description = "页码", example = "1")
            @RequestParam(defaultValue = "1") Integer page,

            @Parameter(description = "每页数量", example = "20")
            @RequestParam(defaultValue = "20") Integer pageSize
    ) {
        return adminService.getReportedPosts(page, pageSize);
    }

    /**
     * 审核通过帖子
     */
    @PostMapping("/posts/{id}/approve")
    @Operation(summary = "审核通过", description = "审核通过指定帖子")
    public Result<Void> approvePost(
            @Parameter(description = "帖子ID", required = true)
            @PathVariable Long id
    ) {
        return adminService.approvePost(id);
    }

    /**
     * 拒绝帖子
     */
    @PostMapping("/posts/{id}/reject")
    @Operation(summary = "拒绝帖子", description = "拒绝指定帖子并删除")
    public Result<Void> rejectPost(
            @Parameter(description = "帖子ID", required = true)
            @PathVariable Long id,

            @Parameter(description = "拒绝原因")
            @RequestParam String reason
    ) {
        return adminService.rejectPost(id, reason);
    }

    /**
     * 删除帖子
     */
    @DeleteMapping("/posts/{id}")
    @Operation(summary = "删除帖子", description = "管理员删除指定帖子")
    public Result<Void> deletePost(
            @Parameter(description = "帖子ID", required = true)
            @PathVariable Long id
    ) {
        return adminService.deletePost(id);
    }

    /**
     * 恢复帖子
     */
    @PostMapping("/posts/{id}/restore")
    @Operation(summary = "恢复帖子", description = "恢复被删除的帖子")
    public Result<Void> restorePost(
            @Parameter(description = "帖子ID", required = true)
            @PathVariable Long id
    ) {
        return adminService.restorePost(id);
    }

    /**
     * 获取举报列表
     */
    @GetMapping("/reports")
    @Operation(summary = "获取举报列表", description = "查询所有举报记录")
    public Result<PageResult<Report>> getReports(
            @Parameter(description = "页码", example = "1")
            @RequestParam(defaultValue = "1") Integer page,

            @Parameter(description = "每页数量", example = "20")
            @RequestParam(defaultValue = "20") Integer pageSize,

            @Parameter(description = "状态筛选")
            @RequestParam(required = false) String status
    ) {
        return adminService.getReports(page, pageSize, status);
    }

    /**
     * 处理举报
     */
    @PostMapping("/reports/{id}/handle")
    @Operation(summary = "处理举报", description = "处理指定举报并执行相应操作")
    public Result<Void> handleReport(
            @Parameter(description = "举报ID", required = true)
            @PathVariable Long id,

            @Parameter(description = "处理动作：DELETE/IGNORE")
            @RequestParam String action,

            @Parameter(description = "处理结果说明")
            @RequestParam String result
    ) {
        return adminService.handleReport(id, action, result);
    }
}
