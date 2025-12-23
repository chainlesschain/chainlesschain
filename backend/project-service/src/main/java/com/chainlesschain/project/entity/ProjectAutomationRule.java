package com.chainlesschain.project.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * 项目自动化规则实体
 */
@Data
@TableName("project_automation_rules")
public class ProjectAutomationRule {

    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    private String projectId;

    private String ruleName;

    private String description;

    private String triggerEvent;  // file_created, file_modified, task_completed, schedule

    private String actionType;  // generate_file, send_notification, git_commit, run_script

    private String triggerConfig;  // JSON

    private String actionConfig;  // JSON

    private Boolean isEnabled;

    private LocalDateTime lastRunAt;

    private Integer runCount;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    @TableLogic
    private Integer deleted;
}
