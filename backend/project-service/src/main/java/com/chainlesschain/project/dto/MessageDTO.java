package com.chainlesschain.project.dto;

import lombok.Data;
import java.time.LocalDateTime;

/**
 * 消息DTO
 */
@Data
public class MessageDTO {

    /**
     * 消息ID
     */
    private String id;

    /**
     * 对话ID
     */
    private String conversationId;

    /**
     * 角色：user/assistant/system
     */
    private String role;

    /**
     * 消息内容
     */
    private String content;

    /**
     * 消息类型：text/system/task_analysis/intent_recognition等
     */
    private String type;

    /**
     * 元数据（JSON格式）
     */
    private String metadata;

    /**
     * 创建时间
     */
    private LocalDateTime createdAt;
}
