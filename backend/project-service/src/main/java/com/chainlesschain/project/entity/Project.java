package com.chainlesschain.project.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 项目实体
 */
@Data
@TableName("projects")
public class Project {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    private String userId;

    private String name;

    private String description;

    @TableField("type")
    private String type;

    private String projectType;  // web, document, data, app

    private String status;  // draft, active, completed, archived

    @TableField("owner_did")
    private String ownerDid;

    @TableField("folder_path")
    private String folderPath;

    private String rootPath;

    @TableField("git_repo_path")
    private String gitRepoPath;

    private String gitRepoUrl;

    private String currentCommit;

    private Long fileCount;

    private Long totalSize;

    private String templateId;

    private String coverImageUrl;

    private String tags;  // JSON array

    private String metadata;  // JSON object

    @TableField("metadata_json")
    private String metadataJson;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    @TableLogic
    private Integer deleted;
}
