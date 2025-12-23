package com.chainlesschain.project.dto;

import lombok.Data;
import java.util.Map;

/**
 * 自动化规则统计DTO
 */
@Data
public class AutomationStatsDTO {

    private String projectId;

    private Integer totalRules;

    private Integer enabledRules;

    private Integer disabledRules;

    private Map<String, Integer> triggerTypeDistribution;  // 触发类型分布

    private Map<String, Integer> actionTypeDistribution;  // 动作类型分布

    private Integer totalRunCount;  // 总执行次数
}
