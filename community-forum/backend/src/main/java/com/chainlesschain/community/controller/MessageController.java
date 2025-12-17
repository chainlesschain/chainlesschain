package com.chainlesschain.community.controller;

import com.chainlesschain.community.common.PageResult;
import com.chainlesschain.community.common.Result;
import com.chainlesschain.community.dto.MessageSendRequest;
import com.chainlesschain.community.entity.Message;
import com.chainlesschain.community.service.MessageService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import jakarta.validation.Valid;

/**
 * 私信控制器
 */
@RestController
@RequestMapping("/api/messages")
@Tag(name = "私信管理", description = "私信的发送、接收、查询等功能")
public class MessageController {

    @Autowired
    private MessageService messageService;

    /**
     * 获取与指定用户的会话消息
     */
    @GetMapping("/conversations/{userId}")
    @Operation(summary = "获取会话消息", description = "查询与指定用户的所有私信记录")
    public Result<PageResult<Message>> getConversationMessages(
            @Parameter(description = "对方用户ID", required = true)
            @PathVariable Long userId,

            @Parameter(description = "页码", example = "1")
            @RequestParam(defaultValue = "1") Integer page,

            @Parameter(description = "每页数量", example = "50")
            @RequestParam(defaultValue = "50") Integer pageSize
    ) {
        return messageService.getConversationMessages(userId, page, pageSize);
    }

    /**
     * 发送私信
     */
    @PostMapping
    @Operation(summary = "发送私信", description = "向指定用户发送私信")
    public Result<Message> sendMessage(@Valid @RequestBody MessageSendRequest request) {
        return messageService.sendMessage(request);
    }

    /**
     * 获取未读消息数
     */
    @GetMapping("/unread-count")
    @Operation(summary = "获取未读消息数", description = "查询当前用户的未读私信数量")
    public Result<Integer> getUnreadCount() {
        return messageService.getUnreadCount();
    }

    /**
     * 标记会话为已读
     */
    @PutMapping("/conversations/{userId}/read")
    @Operation(summary = "标记会话为已读", description = "将与指定用户的所有未读消息标记为已读")
    public Result<Void> markConversationAsRead(
            @Parameter(description = "对方用户ID", required = true)
            @PathVariable Long userId
    ) {
        return messageService.markConversationAsRead(userId);
    }

    /**
     * 删除消息
     */
    @DeleteMapping("/{id}")
    @Operation(summary = "删除消息", description = "删除指定私信")
    public Result<Void> deleteMessage(
            @Parameter(description = "消息ID", required = true)
            @PathVariable Long id
    ) {
        return messageService.deleteMessage(id);
    }
}
