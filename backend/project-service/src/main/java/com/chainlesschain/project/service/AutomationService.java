package com.chainlesschain.project.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.IdWorker;
import com.chainlesschain.project.dto.AutomationRuleDTO;
import com.chainlesschain.project.dto.AutomationStatsDTO;
import com.chainlesschain.project.dto.RuleCreateRequest;
import com.chainlesschain.project.dto.RuleUpdateRequest;
import com.chainlesschain.project.entity.ProjectAutomationRule;
import com.chainlesschain.project.mapper.ProjectAutomationRuleMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 自动化规则服务
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AutomationService {

    private final ProjectAutomationRuleMapper ruleMapper;
    private final ObjectMapper objectMapper;

    /**
     * 获取规则列表
     */
    public List<AutomationRuleDTO> listRules(String projectId, Boolean isEnabled) {
        log.info("获取自动化规则列表: projectId={}, isEnabled={}", projectId, isEnabled);

        LambdaQueryWrapper<ProjectAutomationRule> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectAutomationRule::getProjectId, projectId);

        if (isEnabled != null) {
            wrapper.eq(ProjectAutomationRule::getIsEnabled, isEnabled);
        }

        wrapper.orderByDesc(ProjectAutomationRule::getCreatedAt);

        List<ProjectAutomationRule> rules = ruleMapper.selectList(wrapper);

        return rules.stream()
                .map(this::toDTO)
                .collect(Collectors.toList());
    }

    /**
     * 创建规则
     */
    @Transactional
    public AutomationRuleDTO createRule(String projectId, RuleCreateRequest request) {
        log.info("创建自动化规则: projectId={}, ruleName={}", projectId, request.getRuleName());

        try {
            ProjectAutomationRule rule = new ProjectAutomationRule();
            rule.setId(IdWorker.get32UUID());
            rule.setProjectId(projectId);
            rule.setRuleName(request.getRuleName());
            rule.setDescription(request.getDescription());
            rule.setTriggerEvent(request.getTriggerEvent());
            rule.setActionType(request.getActionType());
            rule.setTriggerConfig(objectMapper.writeValueAsString(request.getTriggerConfig()));
            rule.setActionConfig(objectMapper.writeValueAsString(request.getActionConfig()));
            rule.setIsEnabled(request.getIsEnabled());
            rule.setRunCount(0);

            ruleMapper.insert(rule);

            log.info("自动化规则创建成功: ruleId={}", rule.getId());
            return toDTO(rule);

        } catch (JsonProcessingException e) {
            log.error("JSON序列化失败", e);
            throw new RuntimeException("配置格式错误: " + e.getMessage());
        }
    }

    /**
     * 更新规则
     */
    @Transactional
    public AutomationRuleDTO updateRule(String projectId, String ruleId, RuleUpdateRequest request) {
        log.info("更新自动化规则: projectId={}, ruleId={}", projectId, ruleId);

        try {
            ProjectAutomationRule rule = getRule(projectId, ruleId);

            if (request.getRuleName() != null) {
                rule.setRuleName(request.getRuleName());
            }
            if (request.getDescription() != null) {
                rule.setDescription(request.getDescription());
            }
            if (request.getTriggerEvent() != null) {
                rule.setTriggerEvent(request.getTriggerEvent());
            }
            if (request.getActionType() != null) {
                rule.setActionType(request.getActionType());
            }
            if (request.getTriggerConfig() != null) {
                rule.setTriggerConfig(objectMapper.writeValueAsString(request.getTriggerConfig()));
            }
            if (request.getActionConfig() != null) {
                rule.setActionConfig(objectMapper.writeValueAsString(request.getActionConfig()));
            }
            if (request.getIsEnabled() != null) {
                rule.setIsEnabled(request.getIsEnabled());
            }

            ruleMapper.updateById(rule);

            log.info("自动化规则更新成功");
            return toDTO(rule);

        } catch (JsonProcessingException e) {
            log.error("JSON序列化失败", e);
            throw new RuntimeException("配置格式错误: " + e.getMessage());
        }
    }

    /**
     * 删除规则
     */
    @Transactional
    public void deleteRule(String projectId, String ruleId) {
        log.info("删除自动化规则: projectId={}, ruleId={}", projectId, ruleId);

        ProjectAutomationRule rule = getRule(projectId, ruleId);
        ruleMapper.deleteById(rule.getId());

        log.info("自动化规则删除成功");
    }

    /**
     * 手动触发规则
     */
    @Transactional
    public Map<String, Object> manualTrigger(String projectId, String ruleId) {
        log.info("手动触发规则: projectId={}, ruleId={}", projectId, ruleId);

        ProjectAutomationRule rule = getRule(projectId, ruleId);

        if (!rule.getIsEnabled()) {
            throw new RuntimeException("规则已禁用");
        }

        // TODO: 实现实际的规则执行逻辑
        // 这里只是示例，更新运行统计
        rule.setLastRunAt(LocalDateTime.now());
        rule.setRunCount(rule.getRunCount() + 1);
        ruleMapper.updateById(rule);

        Map<String, Object> result = new HashMap<>();
        result.put("ruleId", ruleId);
        result.put("triggerAt", LocalDateTime.now());
        result.put("status", "success");
        result.put("message", "规则执行成功（示例）");

        log.info("规则手动触发完成");
        return result;
    }

    /**
     * 启用/禁用规则
     */
    @Transactional
    public AutomationRuleDTO toggleRule(String projectId, String ruleId, Boolean enabled) {
        log.info("切换规则状态: projectId={}, ruleId={}, enabled={}", projectId, ruleId, enabled);

        ProjectAutomationRule rule = getRule(projectId, ruleId);
        rule.setIsEnabled(enabled);
        ruleMapper.updateById(rule);

        log.info("规则状态切换成功");
        return toDTO(rule);
    }

    /**
     * 获取规则统计
     */
    public AutomationStatsDTO getStatistics(String projectId) {
        log.info("获取自动化规则统计: projectId={}", projectId);

        LambdaQueryWrapper<ProjectAutomationRule> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectAutomationRule::getProjectId, projectId);

        List<ProjectAutomationRule> rules = ruleMapper.selectList(wrapper);

        AutomationStatsDTO stats = new AutomationStatsDTO();
        stats.setProjectId(projectId);
        stats.setTotalRules(rules.size());
        stats.setEnabledRules((int) rules.stream().filter(ProjectAutomationRule::getIsEnabled).count());
        stats.setDisabledRules((int) rules.stream().filter(r -> !r.getIsEnabled()).count());

        // 统计触发类型分布
        Map<String, Integer> triggerDist = new HashMap<>();
        for (ProjectAutomationRule rule : rules) {
            String trigger = rule.getTriggerEvent();
            triggerDist.put(trigger, triggerDist.getOrDefault(trigger, 0) + 1);
        }
        stats.setTriggerTypeDistribution(triggerDist);

        // 统计动作类型分布
        Map<String, Integer> actionDist = new HashMap<>();
        for (ProjectAutomationRule rule : rules) {
            String action = rule.getActionType();
            actionDist.put(action, actionDist.getOrDefault(action, 0) + 1);
        }
        stats.setActionTypeDistribution(actionDist);

        // 总执行次数
        int totalRunCount = rules.stream()
                .mapToInt(r -> r.getRunCount() != null ? r.getRunCount() : 0)
                .sum();
        stats.setTotalRunCount(totalRunCount);

        return stats;
    }

    /**
     * 获取规则
     */
    private ProjectAutomationRule getRule(String projectId, String ruleId) {
        LambdaQueryWrapper<ProjectAutomationRule> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectAutomationRule::getId, ruleId)
                .eq(ProjectAutomationRule::getProjectId, projectId);

        ProjectAutomationRule rule = ruleMapper.selectOne(wrapper);
        if (rule == null) {
            throw new RuntimeException("规则不存在");
        }

        return rule;
    }

    /**
     * Entity转DTO
     */
    private AutomationRuleDTO toDTO(ProjectAutomationRule rule) {
        AutomationRuleDTO dto = new AutomationRuleDTO();
        BeanUtils.copyProperties(rule, dto);
        return dto;
    }
}
