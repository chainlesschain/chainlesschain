package com.chainlesschain.project.service;

import com.baomidou.mybatisplus.core.toolkit.IdWorker;
import com.chainlesschain.project.dto.AutomationRuleDTO;
import com.chainlesschain.project.dto.AutomationStatsDTO;
import com.chainlesschain.project.dto.RuleCreateRequest;
import com.chainlesschain.project.dto.RuleUpdateRequest;
import com.chainlesschain.project.entity.ProjectAutomationRule;
import com.chainlesschain.project.mapper.ProjectAutomationRuleMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * 自动化规则服务测试
 */
@ExtendWith(MockitoExtension.class)
class AutomationServiceTest {

    @Mock
    private ProjectAutomationRuleMapper ruleMapper;

    @Mock
    private ObjectMapper objectMapper;

    @InjectMocks
    private AutomationService automationService;

    private String testProjectId;
    private String testRuleId;
    private ProjectAutomationRule testRule;

    @BeforeEach
    void setUp() throws Exception {
        testProjectId = IdWorker.get32UUID();
        testRuleId = IdWorker.get32UUID();

        testRule = new ProjectAutomationRule();
        testRule.setId(testRuleId);
        testRule.setProjectId(testProjectId);
        testRule.setRuleName("测试规则");
        testRule.setDescription("测试描述");
        testRule.setTriggerEvent("file_change");
        testRule.setActionType("notify");
        testRule.setTriggerConfig("{\"pattern\": \"*.java\"}");
        testRule.setActionConfig("{\"message\": \"文件已更改\"}");
        testRule.setIsEnabled(true);
        testRule.setRunCount(0);
        testRule.setCreatedAt(LocalDateTime.now());

        // 模拟ObjectMapper行为
        Map<String, Object> triggerConfig = new HashMap<>();
        triggerConfig.put("pattern", "*.java");
        when(objectMapper.writeValueAsString(triggerConfig)).thenReturn("{\"pattern\": \"*.java\"}");

        Map<String, Object> actionConfig = new HashMap<>();
        actionConfig.put("message", "文件已更改");
        when(objectMapper.writeValueAsString(actionConfig)).thenReturn("{\"message\": \"文件已更改\"}");
    }

    @Test
    void testListRules_Success() {
        // 准备数据
        List<ProjectAutomationRule> rules = Arrays.asList(testRule);
        when(ruleMapper.selectList(any())).thenReturn(rules);

        // 执行测试
        List<AutomationRuleDTO> results = automationService.listRules(testProjectId, null);

        // 验证结果
        assertNotNull(results);
        assertEquals(1, results.size());
        assertEquals(testRule.getRuleName(), results.get(0).getRuleName());

        verify(ruleMapper, times(1)).selectList(any());
    }

    @Test
    void testListRules_FilterByEnabled() {
        // 准备数据
        List<ProjectAutomationRule> rules = Arrays.asList(testRule);
        when(ruleMapper.selectList(any())).thenReturn(rules);

        // 执行测试
        List<AutomationRuleDTO> results = automationService.listRules(testProjectId, true);

        // 验证结果
        assertNotNull(results);
        assertEquals(1, results.size());
        assertTrue(results.get(0).getIsEnabled());

        verify(ruleMapper, times(1)).selectList(any());
    }

    @Test
    void testCreateRule_Success() throws Exception {
        when(ruleMapper.insert(any(ProjectAutomationRule.class))).thenReturn(1);

        // 准备请求
        RuleCreateRequest request = new RuleCreateRequest();
        request.setRuleName("新规则");
        request.setDescription("新规则描述");
        request.setTriggerEvent("commit");
        request.setActionType("execute");

        Map<String, Object> triggerConfig = new HashMap<>();
        triggerConfig.put("branch", "main");
        request.setTriggerConfig(triggerConfig);

        Map<String, Object> actionConfig = new HashMap<>();
        actionConfig.put("command", "npm test");
        request.setActionConfig(actionConfig);

        request.setIsEnabled(true);

        // 模拟序列化
        when(objectMapper.writeValueAsString(triggerConfig)).thenReturn("{\"branch\": \"main\"}");
        when(objectMapper.writeValueAsString(actionConfig)).thenReturn("{\"command\": \"npm test\"}");

        // 执行测试
        AutomationRuleDTO result = automationService.createRule(testProjectId, request);

        // 验证结果
        assertNotNull(result);
        assertEquals(request.getRuleName(), result.getRuleName());

        verify(ruleMapper, times(1)).insert(any(ProjectAutomationRule.class));
    }

    @Test
    void testUpdateRule_Success() throws Exception {
        when(ruleMapper.selectOne(any())).thenReturn(testRule);
        when(ruleMapper.updateById(any(ProjectAutomationRule.class))).thenReturn(1);

        // 准备请求
        RuleUpdateRequest request = new RuleUpdateRequest();
        request.setRuleName("更新后的规则");
        request.setDescription("更新后的描述");

        // 执行测试
        AutomationRuleDTO result = automationService.updateRule(testProjectId, testRuleId, request);

        // 验证结果
        assertNotNull(result);
        assertEquals(request.getRuleName(), testRule.getRuleName());

        verify(ruleMapper, times(1)).selectOne(any());
        verify(ruleMapper, times(1)).updateById(any(ProjectAutomationRule.class));
    }

    @Test
    void testDeleteRule_Success() {
        when(ruleMapper.selectOne(any())).thenReturn(testRule);
        when(ruleMapper.deleteById(testRuleId)).thenReturn(1);

        // 执行测试
        assertDoesNotThrow(() -> {
            automationService.deleteRule(testProjectId, testRuleId);
        });

        verify(ruleMapper, times(1)).selectOne(any());
        verify(ruleMapper, times(1)).deleteById(testRuleId);
    }

    @Test
    void testDeleteRule_NotFound() {
        when(ruleMapper.selectOne(any())).thenReturn(null);

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            automationService.deleteRule(testProjectId, testRuleId);
        });

        assertTrue(exception.getMessage().contains("规则不存在"));
    }

    @Test
    void testManualTrigger_Success() {
        when(ruleMapper.selectOne(any())).thenReturn(testRule);
        when(ruleMapper.updateById(any(ProjectAutomationRule.class))).thenReturn(1);

        // 执行测试
        Map<String, Object> result = automationService.manualTrigger(testProjectId, testRuleId);

        // 验证结果
        assertNotNull(result);
        assertEquals(testRuleId, result.get("ruleId"));
        assertEquals("success", result.get("status"));
        assertEquals(1, testRule.getRunCount());
        assertNotNull(testRule.getLastRunAt());

        verify(ruleMapper, times(1)).selectOne(any());
        verify(ruleMapper, times(1)).updateById(any(ProjectAutomationRule.class));
    }

    @Test
    void testManualTrigger_RuleDisabled() {
        testRule.setIsEnabled(false);
        when(ruleMapper.selectOne(any())).thenReturn(testRule);

        // 执行测试并验证异常
        RuntimeException exception = assertThrows(RuntimeException.class, () -> {
            automationService.manualTrigger(testProjectId, testRuleId);
        });

        assertTrue(exception.getMessage().contains("规则已禁用"));
    }

    @Test
    void testToggleRule_Success() {
        when(ruleMapper.selectOne(any())).thenReturn(testRule);
        when(ruleMapper.updateById(any(ProjectAutomationRule.class))).thenReturn(1);

        // 执行测试
        AutomationRuleDTO result = automationService.toggleRule(testProjectId, testRuleId, false);

        // 验证结果
        assertNotNull(result);
        assertFalse(testRule.getIsEnabled());

        verify(ruleMapper, times(1)).selectOne(any());
        verify(ruleMapper, times(1)).updateById(any(ProjectAutomationRule.class));
    }

    @Test
    void testGetStatistics_Success() {
        // 准备数据
        ProjectAutomationRule rule1 = new ProjectAutomationRule();
        rule1.setId(IdWorker.get32UUID());
        rule1.setProjectId(testProjectId);
        rule1.setTriggerEvent("file_change");
        rule1.setActionType("notify");
        rule1.setIsEnabled(true);
        rule1.setRunCount(5);

        ProjectAutomationRule rule2 = new ProjectAutomationRule();
        rule2.setId(IdWorker.get32UUID());
        rule2.setProjectId(testProjectId);
        rule2.setTriggerEvent("commit");
        rule2.setActionType("execute");
        rule2.setIsEnabled(false);
        rule2.setRunCount(3);

        List<ProjectAutomationRule> rules = Arrays.asList(rule1, rule2);
        when(ruleMapper.selectList(any())).thenReturn(rules);

        // 执行测试
        AutomationStatsDTO result = automationService.getStatistics(testProjectId);

        // 验证结果
        assertNotNull(result);
        assertEquals(testProjectId, result.getProjectId());
        assertEquals(2, result.getTotalRules());
        assertEquals(1, result.getEnabledRules());
        assertEquals(1, result.getDisabledRules());
        assertEquals(8, result.getTotalRunCount()); // 5 + 3

        // 验证分布
        assertNotNull(result.getTriggerTypeDistribution());
        assertEquals(1, result.getTriggerTypeDistribution().get("file_change"));
        assertEquals(1, result.getTriggerTypeDistribution().get("commit"));

        assertNotNull(result.getActionTypeDistribution());
        assertEquals(1, result.getActionTypeDistribution().get("notify"));
        assertEquals(1, result.getActionTypeDistribution().get("execute"));

        verify(ruleMapper, times(1)).selectList(any());
    }
}
