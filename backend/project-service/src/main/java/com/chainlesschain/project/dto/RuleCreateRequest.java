package com.chainlesschain.project.dto;

import lombok.Data;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.Map;

/**
 * 创建自动化规则请求DTO
 */
@Data
public class RuleCreateRequest {

    @NotBlank(message = "规则名称不能为空")
    private String ruleName;

    private String description;

    @NotBlank(message = "触发事件不能为空")
    private String triggerEvent;  // file_created, file_modified, task_completed, schedule

    @NotBlank(message = "动作类型不能为空")
    private String actionType;  // generate_file, send_notification, git_commit, run_script

    @NotNull(message = "触发配置不能为空")
    private Map<String, Object> triggerConfig;  // Cron表达式、文件模式等

    @NotNull(message = "动作配置不能为空")
    private Map<String, Object> actionConfig;  // 动作参数

    private Boolean isEnabled = true;
}
