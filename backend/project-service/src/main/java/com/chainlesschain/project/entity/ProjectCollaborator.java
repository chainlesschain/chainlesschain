package com.chainlesschain.project.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 项目协作者实体
 */
@Data
@TableName("project_collaborators")
public class ProjectCollaborator {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    private String projectId;

    private String userId;

    private String collaboratorDid;

    private String role;

    private String permissions;  // read, write, admin

    private String invitedBy;

    private LocalDateTime invitedAt;

    private LocalDateTime acceptedAt;

    private String status;  // pending, accepted, rejected

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
