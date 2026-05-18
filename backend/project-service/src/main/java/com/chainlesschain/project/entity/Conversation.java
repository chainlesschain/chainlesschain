package com.chainlesschain.project.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 对话实体（重新设计，支持项目级和全局对话）
 */
@Data
@TableName("conversations")
public class Conversation {

    @TableId(type = IdType.ASSIGN_UUID)
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
    @TableField(value = "context_data", jdbcType = org.apache.ibatis.type.JdbcType.LONGVARCHAR)
    private String contextData;

    /**
     * 消息数量
     */
    private Integer messageCount = 0;

    /**
     * 创建时间
     */
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    /**
     * 更新时间
     */
    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

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
