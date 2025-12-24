package com.chainlesschain.project.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 项目文件实体
 */
@Data
@TableName("project_files")
public class ProjectFile {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    private String projectId;

    private String filePath;

    private String fileName;

    private String fileType;  // html, css, js, docx, pdf, xlsx, csv, png

    private String language;

    private Long fileSize;

    private String content;  // TEXT or BASE64 for binary

    private Integer version;

    private String commitHash;

    private String generatedBy;  // web_engine, doc_engine, data_engine, user

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    // 同步相关字段
    @TableField("sync_status")
    private String syncStatus = "synced";  // synced, pending, conflict

    @TableField("synced_at")
    private LocalDateTime syncedAt;

    @TableField("content_hash")
    private String contentHash;  // SHA256 hash for content change detection

    @TableLogic
    private Integer deleted;
}
