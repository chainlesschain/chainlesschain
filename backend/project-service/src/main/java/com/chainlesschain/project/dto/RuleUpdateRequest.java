package com.chainlesschain.project.dto;

import lombok.Data;
import java.util.Map;

/**
 * 更新自动化规则请求DTO
 */
@Data
public class RuleUpdateRequest {

    private String ruleName;

    private String description;

    private String triggerEvent;

    private String actionType;

    private Map<String, Object> triggerConfig;

    private Map<String, Object> actionConfig;

    private Boolean isEnabled;
}
