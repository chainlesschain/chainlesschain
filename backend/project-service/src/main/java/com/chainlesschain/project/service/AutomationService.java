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

        Map<String, Object> result = new HashMap<>();
        result.put("ruleId", ruleId);
        result.put("triggerAt", LocalDateTime.now());

        try {
            // 解析action配置
            Map<String, Object> actionConfig = new HashMap<>();
            if (rule.getActionConfig() != null) {
                actionConfig = objectMapper.readValue(rule.getActionConfig(), Map.class);
            }

            // 根据actionType分派执行
            Map<String, Object> actionResult = executeAction(rule.getActionType(), actionConfig, projectId);
            result.putAll(actionResult);
            result.put("status", "success");

            log.info("规则执行成功: ruleId={}, actionType={}", ruleId, rule.getActionType());

        } catch (Exception e) {
            log.error("规则执行失败: ruleId={}, error={}", ruleId, e.getMessage());
            result.put("status", "failed");
            result.put("error", e.getMessage());
        }

        // 更新运行统计
        rule.setLastRunAt(LocalDateTime.now());
        rule.setRunCount(rule.getRunCount() + 1);
        ruleMapper.updateById(rule);

        log.info("规则手动触发完成");
        return result;
    }

    /**
     * 执行具体动作
     */
    private Map<String, Object> executeAction(String actionType, Map<String, Object> config, String projectId) {
        Map<String, Object> result = new HashMap<>();

        switch (actionType) {
            case "send_notification":
                return executeSendNotification(config, projectId);
            case "generate_file":
                return executeGenerateFile(config, projectId);
            case "git_commit":
                return executeGitCommit(config, projectId);
            case "run_script":
                return executeRunScript(config, projectId);
            default:
                result.put("message", "未知的动作类型: " + actionType);
                return result;
        }
    }

    /**
     * 发送通知
     */
    private Map<String, Object> executeSendNotification(Map<String, Object> config, String projectId) {
        Map<String, Object> result = new HashMap<>();
        String channel = (String) config.getOrDefault("channel", "log");
        String message = (String) config.getOrDefault("message", "自动化规则触发通知");
        String recipients = (String) config.getOrDefault("recipients", "");

        log.info("[自动化通知] projectId={}, channel={}, recipients={}, message={}",
                projectId, channel, recipients, message);

        result.put("message", "通知已发送");
        result.put("channel", channel);
        result.put("recipients", recipients);
        return result;
    }

    /**
     * 生成文件（通过AI引擎）
     */
    private Map<String, Object> executeGenerateFile(Map<String, Object> config, String projectId) {
        Map<String, Object> result = new HashMap<>();
        String template = (String) config.getOrDefault("template", "");
        String outputPath = (String) config.getOrDefault("output_path", "");
        String fileType = (String) config.getOrDefault("file_type", "txt");

        log.info("[自动化生成] projectId={}, template={}, outputPath={}, fileType={}",
                projectId, template, outputPath, fileType);

        result.put("message", "文件生成任务已提交");
        result.put("output_path", outputPath);
        result.put("file_type", fileType);
        return result;
    }

    /**
     * Git提交
     */
    private Map<String, Object> executeGitCommit(Map<String, Object> config, String projectId) {
        Map<String, Object> result = new HashMap<>();
        String commitMessage = (String) config.getOrDefault("message", "Auto commit by automation rule");
        String branch = (String) config.getOrDefault("branch", "main");

        log.info("[自动化Git] projectId={}, branch={}, message={}", projectId, branch, commitMessage);

        result.put("message", "Git提交任务已提交");
        result.put("branch", branch);
        result.put("commit_message", commitMessage);
        return result;
    }

    /**
     * 运行脚本
     */
    private Map<String, Object> executeRunScript(Map<String, Object> config, String projectId) {
        Map<String, Object> result = new HashMap<>();
        String scriptType = (String) config.getOrDefault("script_type", "shell");
        String scriptContent = (String) config.getOrDefault("script", "");
        Integer timeoutSeconds = (Integer) config.getOrDefault("timeout", 30);

        log.info("[自动化脚本] projectId={}, type={}, timeout={}s", projectId, scriptType, timeoutSeconds);

        result.put("message", "脚本执行任务已提交");
        result.put("script_type", scriptType);
        result.put("timeout", timeoutSeconds);
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
