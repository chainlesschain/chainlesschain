package com.chainlesschain.project.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 项目任务实体
 */
@Data
@TableName("project_tasks")
public class ProjectTask {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    private String projectId;

    @TableField("description")
    private String description;

    private String taskType;  // generate_file, update_file, analyze_data, optimize_code

    private String userPrompt;

    private String intent;  // JSON object

    private String status;  // pending, running, completed, failed

    private String result;  // JSON object

    private String errorMessage;

    private Integer executionTimeMs;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    @TableLogic
    private Integer deleted;
}
