package com.chainlesschain.project.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.project.dto.*;
import com.chainlesschain.project.security.ProjectAccessGuard;
import com.chainlesschain.project.service.ConversationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.Authentication;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 对话控制器
 */
@Slf4j
@RestController
@RequestMapping("/api/conversations")
@RequiredArgsConstructor
@Tag(name = "对话管理", description = "AI对话相关接口")
public class ConversationController {

    private final ConversationService conversationService;
    private final ProjectAccessGuard accessGuard;

    /**
     * 创建对话
     */
    @PostMapping("/create")
    @Operation(summary = "创建对话", description = "创建新的AI对话")
    public ApiResponse<ConversationDTO> createConversation(
            @Validated @RequestBody ConversationCreateRequest request,
            Authentication authentication) {
        // 安全：若会话归属某项目，校验调用方对该项目有访问权；并把会话 owner 绑定到认证调用方
        if (request.getProjectId() != null && !request.getProjectId().isEmpty()) {
            accessGuard.assertCanAccessProject(request.getProjectId(), authentication);
        }
        if (authentication != null && authentication.getName() != null) {
            request.setUserId(authentication.getName());
        }
        try {
            ConversationDTO conversation = conversationService.createConversation(request);
            return ApiResponse.success("对话创建成功", conversation);
        } catch (Exception e) {
            log.error("[ConversationController] 创建对话失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 获取对话详情
     */
    @GetMapping("/{conversationId}")
    @Operation(summary = "获取对话详情", description = "根据ID获取对话详情")
    public ApiResponse<ConversationDTO> getConversation(
        @Parameter(description = "对话ID") @PathVariable String conversationId,
        Authentication authentication
    ) {
        accessGuard.assertCanAccessConversation(conversationId, authentication);
        try {
            ConversationDTO conversation = conversationService.getConversation(conversationId);
            return ApiResponse.success(conversation);
        } catch (Exception e) {
            log.error("[ConversationController] 获取对话详情失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 获取对话列表
     */
    @GetMapping("/list")
    @Operation(summary = "获取对话列表", description = "获取用户或项目的对话列表")
    public ApiResponse<Page<ConversationDTO>> listConversations(
        @Parameter(description = "用户ID") @RequestParam(required = false) String userId,
        @Parameter(description = "项目ID") @RequestParam(required = false) String projectId,
        @Parameter(description = "页码") @RequestParam(defaultValue = "1") int pageNum,
        @Parameter(description = "每页数量") @RequestParam(defaultValue = "20") int pageSize,
        Authentication authentication
    ) {
        // 安全：按项目过滤时校验项目访问权；否则已认证则强制按调用方过滤，避免枚举他人对话
        if (projectId != null && !projectId.isEmpty()) {
            accessGuard.assertCanAccessProject(projectId, authentication);
        } else if (authentication != null && authentication.getName() != null) {
            userId = authentication.getName();
        }
        try {
            Page<ConversationDTO> page = conversationService.listConversations(userId, projectId, pageNum, pageSize);
            return ApiResponse.success(page);
        } catch (Exception e) {
            log.error("[ConversationController] 获取对话列表失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 更新对话
     */
    @PutMapping("/{conversationId}")
    @Operation(summary = "更新对话", description = "更新对话标题等信息")
    public ApiResponse<ConversationDTO> updateConversation(
        @Parameter(description = "对话ID") @PathVariable String conversationId,
        @RequestBody Map<String, String> updates,
        Authentication authentication
    ) {
        accessGuard.assertCanAccessConversation(conversationId, authentication);
        try {
            String title = updates.get("title");
            ConversationDTO conversation = conversationService.updateConversation(conversationId, title);
            return ApiResponse.success("对话更新成功", conversation);
        } catch (Exception e) {
            log.error("[ConversationController] 更新对话失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 删除对话
     */
    @DeleteMapping("/{conversationId}")
    @Operation(summary = "删除对话", description = "删除对话及其所有消息")
    public ApiResponse<Void> deleteConversation(
        @Parameter(description = "对话ID") @PathVariable String conversationId,
        Authentication authentication
    ) {
        accessGuard.assertCanAccessConversation(conversationId, authentication);
        try {
            conversationService.deleteConversation(conversationId);
            return ApiResponse.success("对话删除成功", null);
        } catch (Exception e) {
            log.error("[ConversationController] 删除对话失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 创建消息
     */
    @PostMapping("/messages/create")
    @Operation(summary = "创建消息", description = "在对话中创建新消息")
    public ApiResponse<MessageDTO> createMessage(
            @Validated @RequestBody MessageCreateRequest request,
            Authentication authentication) {
        accessGuard.assertCanAccessConversation(request.getConversationId(), authentication);
        try {
            MessageDTO message = conversationService.createMessage(request);
            return ApiResponse.success("消息创建成功", message);
        } catch (Exception e) {
            log.error("[ConversationController] 创建消息失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 获取对话的消息列表
     */
    @GetMapping("/{conversationId}/messages")
    @Operation(summary = "获取消息列表", description = "获取对话的所有消息")
    public ApiResponse<List<MessageDTO>> listMessages(
        @Parameter(description = "对话ID") @PathVariable String conversationId,
        @Parameter(description = "限制数量") @RequestParam(required = false) Integer limit,
        @Parameter(description = "偏移量") @RequestParam(required = false) Integer offset,
        Authentication authentication
    ) {
        accessGuard.assertCanAccessConversation(conversationId, authentication);
        try {
            List<MessageDTO> messages = conversationService.listMessages(conversationId, limit, offset);
            return ApiResponse.success(messages);
        } catch (Exception e) {
            log.error("[ConversationController] 获取消息列表失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 删除消息
     */
    @DeleteMapping("/messages/{messageId}")
    @Operation(summary = "删除消息", description = "删除指定消息")
    public ApiResponse<Void> deleteMessage(
        @Parameter(description = "消息ID") @PathVariable String messageId,
        Authentication authentication
    ) {
        accessGuard.assertCanAccessMessage(messageId, authentication);
        try {
            conversationService.deleteMessage(messageId);
            return ApiResponse.success("消息删除成功", null);
        } catch (Exception e) {
            log.error("[ConversationController] 删除消息失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 健康检查
     */
    @GetMapping("/health")
    @Operation(summary = "健康检查", description = "检查对话服务是否正常运行")
    public ApiResponse<Map<String, Object>> health() {
        Map<String, Object> health = Map.of(
            "service", "conversation-service",
            "status", "running",
            "timestamp", System.currentTimeMillis()
        );
        return ApiResponse.success(health);
    }
}
