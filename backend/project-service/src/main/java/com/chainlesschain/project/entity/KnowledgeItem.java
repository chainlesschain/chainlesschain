package com.chainlesschain.project.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 知识库条目实体
 */
@Data
@TableName("knowledge_items")
public class KnowledgeItem {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    /**
     * 标题
     */
    private String title;

    /**
     * 类型: note/document/conversation/web_clip
     */
    private String type;

    /**
     * 内容
     */
    @TableField(value = "content", jdbcType = org.apache.ibatis.type.JdbcType.LONGVARCHAR)
    private String content;

    /**
     * 内容文件路径（可选）
     */
    @TableField("content_path")
    private String contentPath;

    /**
     * 向量文件路径（可选）
     */
    @TableField("embedding_path")
    private String embeddingPath;

    /**
     * 用户ID
     */
    @TableField("user_id")
    private String userId;

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
     * Git提交哈希
     */
    @TableField("git_commit_hash")
    private String gitCommitHash;

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
