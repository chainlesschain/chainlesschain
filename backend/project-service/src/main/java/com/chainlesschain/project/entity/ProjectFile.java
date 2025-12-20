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

    @TableLogic
    private Integer deleted;
}
