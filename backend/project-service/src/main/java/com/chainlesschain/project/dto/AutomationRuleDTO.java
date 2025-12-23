package com.chainlesschain.project.dto;

import lombok.Data;
import java.time.LocalDateTime;

/**
 * 自动化规则响应DTO
 */
@Data
public class AutomationRuleDTO {

    private String id;

    private String projectId;

    private String ruleName;

    private String description;

    private String triggerEvent;

    private String actionType;

    private String triggerConfig;  // JSON string

    private String actionConfig;  // JSON string

    private Boolean isEnabled;

    private LocalDateTime lastRunAt;

    private Integer runCount;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;
}
