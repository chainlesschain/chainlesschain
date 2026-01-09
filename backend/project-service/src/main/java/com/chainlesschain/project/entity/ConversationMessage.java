package com.chainlesschain.project.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 对话消息实体
 */
@Data
@TableName("conversation_messages")
public class ConversationMessage {

    @TableId(type = IdType.ASSIGN_UUID)
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
    @TableField(value = "content", jdbcType = org.apache.ibatis.type.JdbcType.LONGVARCHAR)
    private String content;

    /**
     * 消息类型：text/system/task_analysis/intent_recognition等
     */
    @TableField("message_type")
    private String messageType;

    /**
     * 元数据（JSON格式）
     */
    @TableField(value = "metadata", jdbcType = org.apache.ibatis.type.JdbcType.LONGVARCHAR)
    private String metadata;

    /**
     * 创建时间
     */
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    /**
     * 同步状态
     */
    @TableField("sync_status")
    private String syncStatus = "synced";

    /**
     * 同步时间
     */
    @TableField("synced_at")
    private LocalDateTime syncedAt;

    /**
     * 设备ID
     */
    @TableField("device_id")
    private String deviceId;

    /**
     * 逻辑删除
     */
    @TableLogic
    private Integer deleted;
}
