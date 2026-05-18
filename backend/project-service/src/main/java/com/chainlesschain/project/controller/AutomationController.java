package com.chainlesschain.project.controller;

import com.chainlesschain.project.dto.ApiResponse;
import com.chainlesschain.project.dto.AutomationRuleDTO;
import com.chainlesschain.project.dto.AutomationStatsDTO;
import com.chainlesschain.project.dto.RuleCreateRequest;
import com.chainlesschain.project.dto.RuleUpdateRequest;
import com.chainlesschain.project.service.AutomationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 项目自动化规则控制器
 */
@Slf4j
@RestController
@RequestMapping("/api/projects/{projectId}/automation")
@RequiredArgsConstructor
public class AutomationController {

    private final AutomationService automationService;

    /**
     * 获取规则列表
     */
    @GetMapping("/rules")
    public ApiResponse<List<AutomationRuleDTO>> listRules(
            @PathVariable String projectId,
            @RequestParam(required = false) Boolean isEnabled) {
        try {
            List<AutomationRuleDTO> rules = automationService.listRules(projectId, isEnabled);
            return ApiResponse.success(rules);
        } catch (Exception e) {
            log.error("获取规则列表失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 创建规则
     */
    @PostMapping("/rules")
    public ApiResponse<AutomationRuleDTO> createRule(
            @PathVariable String projectId,
            @Validated @RequestBody RuleCreateRequest request) {
        try {
            AutomationRuleDTO rule = automationService.createRule(projectId, request);
            return ApiResponse.success("规则创建成功", rule);
        } catch (Exception e) {
            log.error("创建规则失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 更新规则
     */
    @PutMapping("/rules/{ruleId}")
    public ApiResponse<AutomationRuleDTO> updateRule(
            @PathVariable String projectId,
            @PathVariable String ruleId,
            @Validated @RequestBody RuleUpdateRequest request) {
        try {
            AutomationRuleDTO rule = automationService.updateRule(projectId, ruleId, request);
            return ApiResponse.success("规则更新成功", rule);
        } catch (Exception e) {
            log.error("更新规则失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 删除规则
     */
    @DeleteMapping("/rules/{ruleId}")
    public ApiResponse<Void> deleteRule(
            @PathVariable String projectId,
            @PathVariable String ruleId) {
        try {
            automationService.deleteRule(projectId, ruleId);
            return ApiResponse.success("规则删除成功", null);
        } catch (Exception e) {
            log.error("删除规则失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 手动触发规则
     */
    @PostMapping("/rules/{ruleId}/trigger")
    public ApiResponse<Map<String, Object>> manualTrigger(
            @PathVariable String projectId,
            @PathVariable String ruleId) {
        try {
            Map<String, Object> result = automationService.manualTrigger(projectId, ruleId);
            return ApiResponse.success("规则触发成功", result);
        } catch (Exception e) {
            log.error("触发规则失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 启用/禁用规则
     */
    @PutMapping("/rules/{ruleId}/toggle")
    public ApiResponse<AutomationRuleDTO> toggleRule(
            @PathVariable String projectId,
            @PathVariable String ruleId,
            @RequestParam Boolean enabled) {
        try {
            AutomationRuleDTO rule = automationService.toggleRule(projectId, ruleId, enabled);
            return ApiResponse.success("规则状态切换成功", rule);
        } catch (Exception e) {
            log.error("切换规则状态失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 获取规则统计
     */
    @GetMapping("/stats")
    public ApiResponse<AutomationStatsDTO> getStatistics(@PathVariable String projectId) {
        try {
            AutomationStatsDTO stats = automationService.getStatistics(projectId);
            return ApiResponse.success(stats);
        } catch (Exception e) {
            log.error("获取规则统计失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }
}
