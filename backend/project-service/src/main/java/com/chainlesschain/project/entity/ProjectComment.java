package com.chainlesschain.project.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 项目评论实体
 */
@Data
@TableName("project_comments")
public class ProjectComment {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    private String projectId;

    private String userId;

    private String filePath;

    private Integer lineNumber;

    private String authorDid;

    private String content;

    private String parentId;

    private String parentCommentId;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    // 同步相关字段
    @TableField("sync_status")
    private String syncStatus = "synced";

    @TableField("synced_at")
    private LocalDateTime syncedAt;

    @TableField("device_id")
    private String deviceId;

    @TableLogic
    private Integer deleted;
}
