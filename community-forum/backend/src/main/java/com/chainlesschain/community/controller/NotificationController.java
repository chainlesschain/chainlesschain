package com.chainlesschain.community.controller;

import com.chainlesschain.community.common.PageResult;
import com.chainlesschain.community.common.Result;
import com.chainlesschain.community.service.NotificationService;
import com.chainlesschain.community.vo.NotificationVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

/**
 * 通知控制器
 */
@RestController
@RequestMapping("/notifications")
@Tag(name = "通知管理", description = "通知的查询、标记已读等功能")
public class NotificationController {

    @Autowired
    private NotificationService notificationService;

    /**
     * 获取通知列表
     */
    @GetMapping
    @Operation(summary = "获取通知列表", description = "分页查询当前用户的所有通知")
    public Result<PageResult<NotificationVO>> getNotifications(
            @Parameter(description = "页码", example = "1")
            @RequestParam(defaultValue = "1") Integer page,

            @Parameter(description = "每页数量", example = "20")
            @RequestParam(defaultValue = "20") Integer pageSize
    ) {
        return notificationService.getNotifications(page, pageSize);
    }

    /**
     * 获取未读通知数
     */
    @GetMapping("/unread-count")
    @Operation(summary = "获取未读通知数", description = "查询当前用户的未读通知数量")
    public Result<Integer> getUnreadCount() {
        return notificationService.getUnreadCount();
    }

    /**
     * 标记通知为已读
     */
    @PutMapping("/{id}/read")
    @Operation(summary = "标记通知为已读", description = "将指定通知标记为已读")
    public Result<Void> markAsRead(
            @Parameter(description = "通知ID", required = true)
            @PathVariable Long id
    ) {
        return notificationService.markAsRead(id);
    }

    /**
     * 标记全部为已读
     */
    @PutMapping("/read-all")
    @Operation(summary = "标记全部为已读", description = "将所有未读通知标记为已读")
    public Result<Void> markAllAsRead() {
        return notificationService.markAllAsRead();
    }

    /**
     * 删除通知
     */
    @DeleteMapping("/{id}")
    @Operation(summary = "删除通知", description = "删除指定通知")
    public Result<Void> deleteNotification(
            @Parameter(description = "通知ID", required = true)
            @PathVariable Long id
    ) {
        return notificationService.deleteNotification(id);
    }

    /**
     * 清空已读通知
     */
    @DeleteMapping("/clear-read")
    @Operation(summary = "清空已读通知", description = "删除所有已读通知")
    public Result<Void> clearReadNotifications() {
        return notificationService.clearReadNotifications();
    }
}
