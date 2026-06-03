package com.chainlesschain.project.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * 创建消息请求
 */
@Data
public class MessageCreateRequest {

    /**
     * 对话ID
     */
    @NotBlank(message = "对话ID不能为空")
    private String conversationId;

    /**
     * 角色：user/assistant/system
     */
    @NotBlank(message = "角色不能为空")
    private String role;

    /**
     * 消息内容
     */
    @NotBlank(message = "消息内容不能为空")
    private String content;

    /**
     * 消息类型：text/system/task_analysis等
     */
    private String type;

    /**
     * 元数据（JSON格式）
     */
    private String metadata;
}
