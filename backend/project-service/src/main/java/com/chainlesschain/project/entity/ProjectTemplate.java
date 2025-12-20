package com.chainlesschain.project.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 项目模板实体
 */
@Data
@TableName("project_templates")
public class ProjectTemplate {

    @TableId(type = IdType.INPUT)
    private String id;

    private String name;

    private String projectType;

    private String description;

    private String previewImageUrl;

    private String configJson;  // JSON object

    private String fileStructure;  // JSON array

    private Integer usageCount;

    private Boolean isBuiltin;

    private String authorId;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    @TableLogic
    private Integer deleted;
}
