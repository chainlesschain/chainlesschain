package com.chainlesschain.project.dto;

import lombok.Data;
import java.time.LocalDateTime;
import java.util.List;

/**
 * 对话DTO
 */
@Data
public class ConversationDTO {

    /**
     * 对话ID
     */
    private String id;

    /**
     * 对话标题
     */
    private String title;

    /**
     * 项目ID（可选，如果是项目级对话）
     */
    private String projectId;

    /**
     * 用户ID
     */
    private String userId;

    /**
     * 上下文模式：project/file/global
     */
    private String contextMode;

    /**
     * 上下文数据（JSON格式）
     */
    private String contextData;

    /**
     * 消息数量
     */
    private Integer messageCount;

    /**
     * 创建时间
     */
    private LocalDateTime createdAt;

    /**
     * 更新时间
     */
    private LocalDateTime updatedAt;

    /**
     * 最后一条消息（可选）
     */
    private MessageDTO lastMessage;
}
