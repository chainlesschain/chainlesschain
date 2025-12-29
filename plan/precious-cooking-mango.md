# 眼科智能分诊系统V3.0重构方案

## 一、方案概述

### 1.1 重构目标
将当前的**预设选项式问答**改造为**AI驱动的开放式问答**，实现：
- ✅ 用户自由描述症状，不受选项限制
- ✅ AI根据对话记录智能决定下一个问题或推荐科室
- ✅ 保持现有的科室推荐准确性（利用250+条权重配置）
- ✅ 保留专业的23个问题作为AI知识库

### 1.2 核心设计原则
基于用户选择的**平衡方案**：
1. **保留现有资产**：利用23个专业问题+250+条权重关系
2. **AI增强理解**：AI提取自由文本中的关键信息
3. **智能映射机制**：将用户输入映射到预设症状和选项
4. **准确性优先**：继续使用权重计算系统保证准确性

---

## 二、技术方案设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    V3.0 AI驱动对话流程                        │
└─────────────────────────────────────────────────────────────┘

用户输入自由文本
       ↓
┌──────────────────┐
│  AI信息提取模块   │  ← 新增核心模块
│ (DeepSeek)      │
│ • 提取症状关键词  │
│ • 提取年龄/病史   │
│ • 理解语义        │
└──────────────────┘
       ↓
┌──────────────────┐
│  智能映射模块     │  ← 新增核心模块
│ • 映射到预设症状  │
│ • 映射到问题选项  │
│ • 生成权重输入    │
└──────────────────┘
       ↓
┌──────────────────┐
│  权重计算引擎     │  ← 保留原有逻辑
│ • QuestionDeptImpact │
│ • Softmax置信度   │
│ • 信息熵修正      │
└──────────────────┘
       ↓
┌──────────────────┐
│  AI决策模块       │  ← 新增核心模块
│ • 判断是否继续提问 │
│ • 生成下一个问题  │
│ • 或推荐科室      │
└──────────────────┘
```

### 2.2 核心模块详解

#### 模块A：AI信息提取服务（新增）
**文件路径**：`com.hospital.triage.service.impl.AiExtractionServiceImpl`

**功能**：
- 从用户的自由文本中提取结构化信息
- 识别症状关键词
- 提取年龄、病史、时长等关键信息

**技术实现**：
```java
@Service
public class AiExtractionServiceImpl {

    @Autowired
    private DeepSeekUtil deepSeekUtil;

    /**
     * 从自由文本中提取症状和信息
     */
    public ExtractionResult extractFromUserInput(String userInput,
                                                  List<TriageQuestion> availableQuestions) {
        // 构建AI提示词
        String prompt = buildExtractionPrompt(userInput, availableQuestions);

        // 调用AI
        Map<String, Object> aiResponse = deepSeekUtil.chat(prompt);

        // 解析AI返回的结果
        return parseExtractionResult(aiResponse);
    }

    /**
     * 构建提取信息的提示词
     */
    private String buildExtractionPrompt(String userInput,
                                         List<TriageQuestion> questions) {
        StringBuilder prompt = new StringBuilder();
        prompt.append("你是一位眼科医生助手，请从患者的描述中提取关键信息。\n\n");
        prompt.append("患者描述：").append(userInput).append("\n\n");
        prompt.append("请提取以下信息，并以JSON格式返回：\n");
        prompt.append("1. symptoms: 提取的症状列表（从以下选项中选择）\n");
        prompt.append("   可选症状：视力下降、眼痛、眼胀、眼红、充血、眼干、异物感、");
        prompt.append("飞蚊症、黑影、复视、重影、视物变形、眼睑肿胀、流泪、");
        prompt.append("畏光、分泌物、视野缺损、看东西有彩虹圈等\n");
        prompt.append("2. duration: 症状持续时间（1周内/1-2周/超过2周）\n");
        prompt.append("3. severity: 严重程度（轻微/中等/严重/极严重）\n");
        prompt.append("4. ageGroup: 年龄段（儿童/青少年/青年/中年/老年）\n");
        prompt.append("5. hasHistory: 是否提到病史（true/false）\n");
        prompt.append("6. historyDetails: 病史详情（如有）\n");
        prompt.append("7. keywords: 其他关键信息\n\n");

        // 添加问题库上下文（帮助AI理解）
        prompt.append("参考问题库：\n");
        for (TriageQuestion q : questions) {
            prompt.append("- ").append(q.getQuestionContent()).append("\n");
            if (q.getOptions() != null) {
                prompt.append("  选项：").append(q.getOptions()).append("\n");
            }
        }

        prompt.append("\n请以标准JSON格式返回，不要包含额外说明。");
        return prompt.toString();
    }
}
```

**返回的数据结构**：
```java
@Data
public class ExtractionResult {
    private List<String> symptoms;           // 提取的症状
    private String duration;                 // 持续时间
    private String severity;                 // 严重程度
    private String ageGroup;                 // 年龄段
    private Boolean hasHistory;              // 是否有病史
    private String historyDetails;           // 病史详情
    private Map<String, Object> keywords;    // 其他关键词
    private Double confidence;               // AI提取的置信度
}
```

#### 模块B：智能映射服务（新增）
**文件路径**：`com.hospital.triage.service.impl.MappingServiceImpl`

**功能**：
- 将AI提取的症状映射到QuestionDeptImpact表中的选项
- 生成权重输入数据

**技术实现**：
```java
@Service
public class MappingServiceImpl {

    @Autowired
    private TriageQuestionMapper questionMapper;

    @Autowired
    private QuestionDeptImpactMapper impactMapper;

    /**
     * 将提取结果映射到权重系统
     */
    public Map<String, String> mapToQuestionAnswers(ExtractionResult extraction) {
        Map<String, String> mappedAnswers = new HashMap<>();

        // 映射症状（Q001）
        if (extraction.getSymptoms() != null && !extraction.getSymptoms().isEmpty()) {
            String symptomsAnswer = String.join("、", extraction.getSymptoms());
            mappedAnswers.put("Q001", symptomsAnswer);
        }

        // 映射持续时间（Q002）
        if (extraction.getDuration() != null) {
            mappedAnswers.put("Q002", extraction.getDuration());
        }

        // 映射严重程度（Q003）
        if (extraction.getSeverity() != null) {
            mappedAnswers.put("Q003", extraction.getSeverity());
        }

        // 映射年龄段（Q007）
        if (extraction.getAgeGroup() != null) {
            mappedAnswers.put("Q007", extraction.getAgeGroup());
        }

        // 映射病史（Q004）
        if (extraction.getHasHistory() && extraction.getHistoryDetails() != null) {
            mappedAnswers.put("Q004", extraction.getHistoryDetails());
        }

        return mappedAnswers;
    }

    /**
     * 根据映射结果计算科室权重
     */
    public Map<Long, Double> calculateDeptWeights(Map<String, String> mappedAnswers) {
        Map<Long, Double> deptWeights = new HashMap<>();

        for (Map.Entry<String, String> entry : mappedAnswers.entrySet()) {
            String questionCode = entry.getKey();
            String answer = entry.getValue();

            // 处理多选情况（用顿号分隔）
            String[] options = answer.split("、");

            for (String option : options) {
                // 查询该问题-选项对应的科室影响
                List<QuestionDeptImpact> impacts =
                    impactMapper.selectByQuestionAndOption(questionCode, option.trim());

                for (QuestionDeptImpact impact : impacts) {
                    Long deptId = impact.getAiDeptId();
                    Double weight = impact.getWeightAdjustment().doubleValue();

                    // 应用影响级别系数
                    Double factor = getImpactFactor(impact.getImpactLevel());
                    Double adjustedWeight = weight * factor;

                    // 累加权重
                    deptWeights.merge(deptId, adjustedWeight, Double::sum);
                }
            }
        }

        return deptWeights;
    }

    private Double getImpactFactor(String impactLevel) {
        if ("HIGH".equals(impactLevel)) return 1.2;
        if ("LOW".equals(impactLevel)) return 0.8;
        return 1.0; // MEDIUM
    }
}
```

#### 模块C：AI决策服务（新增）
**文件路径**：`com.hospital.triage.service.impl.AiDecisionServiceImpl`

**功能**：
- 根据当前置信度和对话历史决定下一步行动
- 生成新的开放式问题或推荐科室

**技术实现**：
```java
@Service
public class AiDecisionServiceImpl {

    @Autowired
    private DeepSeekUtil deepSeekUtil;

    @Autowired
    private TriageQuestionMapper questionMapper;

    /**
     * 决定下一步行动：继续提问 or 推荐科室
     */
    public DecisionResult makeDecision(TriageSessionV3 session,
                                       ConfidenceResult confidence) {
        // 如果置信度达标，推荐科室
        if (confidence.getReachedThreshold()) {
            return DecisionResult.recommend();
        }

        // 如果达到最大轮数，推荐科室
        if (session.getRoundNumber() >= getMaxRounds()) {
            return DecisionResult.recommend();
        }

        // 否则，生成下一个问题
        String nextQuestion = generateNextQuestion(session, confidence);
        return DecisionResult.continueWithQuestion(nextQuestion);
    }

    /**
     * AI生成下一个问题
     */
    private String generateNextQuestion(TriageSessionV3 session,
                                        ConfidenceResult confidence) {
        // 获取未问过的问题
        List<TriageQuestion> availableQuestions =
            getAvailableQuestions(session.getAskedQuestionSet());

        // 根据信息增益选择最有价值的问题
        TriageQuestion bestQuestion = selectBestQuestion(
            availableQuestions,
            confidence.getAiDeptProbabilities()
        );

        // 让AI将问题改写成开放式问题
        String openEndedQuestion = convertToOpenEnded(
            bestQuestion,
            session.getQaHistoryList()
        );

        return openEndedQuestion;
    }

    /**
     * 将预设问题转换为开放式问题
     */
    private String convertToOpenEnded(TriageQuestion question,
                                      List<Map<String, Object>> qaHistory) {
        StringBuilder prompt = new StringBuilder();
        prompt.append("你是眼科医生助手，正在进行问诊。\n\n");
        prompt.append("对话历史：\n");
        for (Map<String, Object> qa : qaHistory) {
            prompt.append("医生：").append(qa.get("question")).append("\n");
            prompt.append("患者：").append(qa.get("answer")).append("\n");
        }
        prompt.append("\n你需要询问：").append(question.getQuestionContent()).append("\n");

        if (question.getOptions() != null) {
            prompt.append("参考选项：").append(question.getOptions()).append("\n");
        }

        prompt.append("\n请将上述问题改写为自然、友好的开放式问题，");
        prompt.append("不要列出选项，让患者自由描述。");
        prompt.append("直接返回问题文本，不要加任何前缀或说明。");

        Map<String, Object> aiResponse = deepSeekUtil.chat(prompt.toString());
        return (String) aiResponse.getOrDefault("content", question.getQuestionContent());
    }
}
```

---

## 三、重构实施步骤

### 3.1 第一阶段：新增服务类（不影响现有功能）

**文件清单**：
1. `AiExtractionService.java` (接口)
2. `AiExtractionServiceImpl.java` (实现)
3. `MappingService.java` (接口)
4. `MappingServiceImpl.java` (实现)
5. `AiDecisionService.java` (接口)
6. `AiDecisionServiceImpl.java` (实现)

**新增DTO**：
1. `ExtractionResult.java` - AI提取结果
2. `DecisionResult.java` - AI决策结果

**路径**：
- 服务类：`src/main/java/com/hospital/triage/service/impl/`
- DTO类：`src/main/java/com/hospital/triage/dto/`

### 3.2 第二阶段：修改V3服务实现

**修改文件**：`OphthalConversationTriageV3ServiceImpl.java`

**关键修改点**：

#### 修改1：continueConversation方法

**原逻辑**：
```java
// 用户选择了预设选项
String answer = requestDTO.getAnswer();
// 记录到会话
session.addAnswer(questionCode, question, answer);
// 直接计算权重
```

**新逻辑**：
```java
// 1. 用户输入自由文本
String userInput = requestDTO.getAnswer();

// 2. AI提取结构化信息
ExtractionResult extraction = aiExtractionService.extractFromUserInput(
    userInput,
    questionMapper.selectAllActive()
);

// 3. 映射到问题答案
Map<String, String> mappedAnswers = mappingService.mapToQuestionAnswers(extraction);

// 4. 记录原始回答和提取结果
session.addAnswer("OPEN_" + session.getRoundNumber(), userInput, userInput);
session.addExtractedInfo(extraction); // 新增方法

// 5. 计算科室权重（使用映射后的数据）
Map<Long, Double> deptWeights = mappingService.calculateDeptWeights(mappedAnswers);

// 6. 合并之前的权重（累加）
Map<Long, Double> cumulativeWeights = session.getCumulativeWeights();
for (Map.Entry<Long, Double> entry : deptWeights.entrySet()) {
    cumulativeWeights.merge(entry.getKey(), entry.getValue(), Double::sum);
}
session.setCumulativeWeights(cumulativeWeights);

// 7. 计算置信度（保持原有逻辑）
ConfidenceResult confidence = calculateAiDeptConfidence(
    cumulativeWeights,
    threshold
);

// 8. AI决策：继续提问 or 推荐科室
DecisionResult decision = aiDecisionService.makeDecision(session, confidence);

if (decision.isRecommend()) {
    return generateRecommendations(session, cumulativeWeights, confidence);
} else {
    // 9. 返回AI生成的开放式问题
    ConversationMessageDTO nextQuestion = ConversationMessageDTO.builder()
        .type("open_ended")
        .content(decision.getNextQuestion())
        .options(null)  // 不再提供选项
        .multiSelect(false)
        .timestamp(System.currentTimeMillis())
        .build();

    return buildOngoingResponse(session, nextQuestion, confidence);
}
```

#### 修改2：TriageSessionV3实体类

**新增字段**：
```java
// 累计的科室权重（每轮累加）
@TableField(typeHandler = JacksonTypeHandler.class)
private Map<Long, Double> cumulativeWeights;

// AI提取的信息历史
@TableField(typeHandler = JacksonTypeHandler.class)
private List<ExtractionResult> extractedInfoList;
```

**新增方法**：
```java
public void addExtractedInfo(ExtractionResult extraction) {
    if (this.extractedInfoList == null) {
        this.extractedInfoList = new ArrayList<>();
    }
    this.extractedInfoList.add(extraction);
}

public Map<Long, Double> getCumulativeWeights() {
    if (this.cumulativeWeights == null) {
        this.cumulativeWeights = new HashMap<>();
    }
    return this.cumulativeWeights;
}

public void setCumulativeWeights(Map<Long, Double> weights) {
    this.cumulativeWeights = weights;
}
```

### 3.3 第三阶段：数据库迁移

**SQL脚本**：`v3.1_open_ended_upgrade.sql`

```sql
-- 为会话表添加新字段
ALTER TABLE t_triage_session_v3
ADD cumulative_weights TEXT NULL COMMENT '累计科室权重(JSON)';

ALTER TABLE t_triage_session_v3
ADD extracted_info_list TEXT NULL COMMENT 'AI提取信息历史(JSON)';

-- 添加配置项：AI提取置信度阈值
INSERT INTO t_triage_config (config_key, config_value, config_desc, value_type, is_active)
VALUES ('ai_extraction_confidence_threshold', '0.7', 'AI提取信息的最低置信度阈值', 'DECIMAL', 1);

-- 添加配置项：是否启用AI生成问题
INSERT INTO t_triage_config (config_key, config_value, config_desc, value_type, is_active)
VALUES ('enable_ai_generate_question', '1', '是否启用AI生成开放式问题', 'BOOLEAN', 1);
```

### 3.4 第四阶段：前端适配

**修改文件**：`uni/pages/conversation-triage-v3/conversation-triage-v3.vue`

**关键修改**：

```vue
<!-- 所有问题类型都改为自由输入 -->
<view v-if="message.type === 'open_ended' || message.type === 'question'"
      class="message-question-card">
  <view class="question-header">
    <view class="question-icon">💬</view>
    <text class="question-title">{{ message.content }}</text>
  </view>

  <!-- 统一使用文本输入框 -->
  <view class="text-input-area">
    <textarea
      class="symptom-textarea"
      :value="message.textInput || ''"
      @input="onTextInput($event, index)"
      placeholder="请详细描述..."
      :maxlength="500"
      :disabled="message.answered"
      auto-height
    />
    <view class="text-counter">{{ (message.textInput || '').length }}/500</view>
  </view>

  <!-- 提交按钮 -->
  <view class="submit-area" v-if="!message.answered && index === messages.length - 1">
    <button
      class="submit-btn"
      :class="{ 'submit-btn-disabled': !message.textInput }"
      :disabled="!message.textInput || submitting"
      @tap="submitTextAnswer(index)"
    >
      <text v-if="!submitting">提交</text>
      <text v-else>提交中...</text>
    </button>
  </view>
</view>

<!-- 移除原来的选项按钮组件 -->
```

---

## 四、核心优势分析

### 4.1 用户体验提升
- ✅ **自然交互**：用户可以用自己的话描述症状
- ✅ **灵活表达**：不受选项限制，可以补充细节
- ✅ **减少误解**：不用纠结选项，直接说明情况

### 4.2 准确性保证
- ✅ **保留权重系统**：继续使用250+条专业配置的权重关系
- ✅ **AI辅助理解**：提取关键信息后映射到标准症状
- ✅ **双重验证**：AI理解+权重计算，降低误判风险

### 4.3 系统可维护性
- ✅ **渐进式改造**：不破坏现有架构，逐步增强
- ✅ **降级机制**：AI服务故障时可回退到选项模式
- ✅ **数据积累**：保存AI提取结果，持续优化模型

### 4.4 扩展性
- ✅ **问题库复用**：23个专业问题继续发挥价值
- ✅ **权重可调**：后续可根据数据优化权重配置
- ✅ **AI可升级**：可更换更强大的AI模型

---

## 五、风险控制

### 5.1 AI理解偏差
**风险**：AI可能提取错误的症状

**缓解措施**：
1. 在响应中展示"AI理解为"的内容，用户可以纠正
2. 设置AI提取置信度阈值（0.7），低于阈值时要求用户确认
3. 记录AI提取结果，后续可人工review和优化

### 5.2 性能问题
**风险**：每轮都调用AI，响应可能变慢

**缓解措施**：
1. 设置合理的AI超时时间（5秒）
2. 使用缓存机制：相似输入复用提取结果
3. 异步处理AI生成问题的逻辑

### 5.3 成本问题
**风险**：AI调用次数增加，成本上升

**缓解措施**：
1. 优化提示词长度，减少token消耗
2. 对于简单输入（如"是"/"否"），直接映射，不调用AI
3. 批量处理：一次AI调用同时完成提取和决策

---

## 六、实施时间估算

| 阶段 | 任务 | 预计时间 |
|------|------|---------|
| 第一阶段 | 新增3个服务类+2个DTO | 4小时 |
| 第二阶段 | 修改V3服务实现 | 3小时 |
| 第三阶段 | 数据库迁移+配置 | 1小时 |
| 第四阶段 | 前端适配 | 2小时 |
| 测试调试 | 端到端测试+优化 | 3小时 |
| **总计** | | **13小时** |

---

## 七、测试计划

### 7.1 单元测试
- AiExtractionService：测试各种症状描述的提取准确性
- MappingService：测试症状到选项的映射正确性
- AiDecisionService：测试决策逻辑

### 7.2 集成测试
- 完整对话流程：从开始到推荐科室
- 边界情况：空输入、无效输入、AI超时等
- 降级测试：AI服务故障时的回退机制

### 7.3 用户验收测试
准备10个典型病例，验证：
1. 白内障患者 → 应推荐白内障科
2. 青光眼急性发作 → 应推荐青光眼科
3. 干眼症患者 → 应推荐角膜病科
4. 儿童斜视 → 应推荐小儿眼科
5. 视网膜脱离高危 → 应推荐眼底病科
6. ...

---

## 八、关键文件清单

### 新增文件
1. `src/main/java/com/hospital/triage/service/AiExtractionService.java`
2. `src/main/java/com/hospital/triage/service/impl/AiExtractionServiceImpl.java`
3. `src/main/java/com/hospital/triage/service/MappingService.java`
4. `src/main/java/com/hospital/triage/service/impl/MappingServiceImpl.java`
5. `src/main/java/com/hospital/triage/service/AiDecisionService.java`
6. `src/main/java/com/hospital/triage/service/impl/AiDecisionServiceImpl.java`
7. `src/main/java/com/hospital/triage/dto/ExtractionResult.java`
8. `src/main/java/com/hospital/triage/dto/DecisionResult.java`
9. `src/main/resources/sql/v3.1_open_ended_upgrade.sql`

### 修改文件
1. `src/main/java/com/hospital/triage/service/impl/OphthalConversationTriageV3ServiceImpl.java`
2. `src/main/java/com/hospital/triage/entity/TriageSessionV3.java`
3. `uni/pages/conversation-triage-v3/conversation-triage-v3.vue`

---

## 九、后续优化建议

### 9.1 短期优化（1-2周）
1. 收集用户反馈，优化AI提示词
2. 分析AI提取准确率，调整阈值
3. 优化生成问题的自然度

### 9.2 中期优化（1-2月）
1. 基于真实数据微调AI模型
2. 引入多轮对话上下文理解
3. 添加多模态支持（图片上传）

### 9.3 长期优化（3-6月）
1. 构建专门的眼科症状识别模型
2. 引入知识图谱增强推理能力
3. 实现个性化问诊策略

---

## 十、总结

本方案采用**AI增强+权重保留**的混合架构，既实现了开放式问答的灵活性，又保证了科室推荐的准确性。通过渐进式改造，最大化利用现有资产，降低实施风险，是当前最佳的重构方案。
