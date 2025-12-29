# 智能分诊3.0版本实现计划

## 一、核心需求明确

### 1.1 核心流程
```
多轮AI问答 → 匹配AI标准科室(置信度≥0.8) → 映射到实际科室 → 返回推荐
              ↑
         置信度可后台配置(默认0.8)
```

### 1.2 关键点
- **分两阶段匹配**：先匹配AI标准科室（t_ophthal_standard_dept），达到阈值后再映射到实际预约科室
- **置信度针对AI标准科室**：不是针对最终真实科室，而是针对AI标准科室的匹配度
- **动态问答**：根据AI标准科室的置信度决定是否继续提问
- **阈值可配置**：存储在配置表中，默认0.8，后台可调整

---

## 二、置信度计算算法（针对AI标准科室）

### 2.1 数学模型：Softmax归一化 + 信息熵

#### 步骤1：计算AI标准科室的权重得分
```java
// 复用2.0算法：基于症状-科室关系表计算
Map<Long, Double> aiDeptScoreMap = calculateAiDeptScore(symptomIds, triageDTO);
// 示例结果：
// {
//   3L (角膜病与眼表疾病科): 85.0,
//   1L (白内障专科): 45.0,
//   5L (青光眼科): 30.0
// }
```

#### 步骤2：Softmax归一化为概率分布
```java
P(aiDept_i) = e^(score_i / T) / Σ(e^(score_j / T))

其中：
- T = 1.5 (温度参数，控制分布集中度)
- P(aiDept_i): AI标准科室i的归一化概率
```

#### 步骤3：计算置信度（最高概率AI科室）
```java
Confidence = max(P(aiDept_1), P(aiDept_2), ..., P(aiDept_n))
```

#### 步骤4：信息熵修正
```java
H = -Σ P(aiDept_i) * log2(P(aiDept_i))
H_normalized = H / log2(n)
Confidence_final = Confidence * (1 - 0.3 * H_normalized)
```

### 2.2 核心代码实现
```java
/**
 * 计算AI标准科室的置信度
 */
private ConfidenceResult calculateAiDeptConfidence(
    Map<Long, Double> aiDeptScoreMap,
    Double confidenceThreshold  // 从配置读取
) {
    // 1. Softmax归一化
    double temperature = 1.5;
    Map<Long, Double> aiDeptProbabilities = new HashMap<>();
    double sumExp = 0.0;

    for (Double score : aiDeptScoreMap.values()) {
        sumExp += Math.exp(score / temperature);
    }

    for (Map.Entry<Long, Double> entry : aiDeptScoreMap.entrySet()) {
        double prob = Math.exp(entry.getValue() / temperature) / sumExp;
        aiDeptProbabilities.put(entry.getKey(), prob);
    }

    // 2. 找到最大概率的AI标准科室
    Long topAiDeptId = null;
    Double maxProb = 0.0;
    for (Map.Entry<Long, Double> entry : aiDeptProbabilities.entrySet()) {
        if (entry.getValue() > maxProb) {
            maxProb = entry.getValue();
            topAiDeptId = entry.getKey();
        }
    }

    // 3. 计算信息熵
    double entropy = 0.0;
    for (Double prob : aiDeptProbabilities.values()) {
        if (prob > 0) {
            entropy -= prob * (Math.log(prob) / Math.log(2));
        }
    }

    // 4. 归一化信息熵
    double normalizedEntropy = entropy / (Math.log(aiDeptProbabilities.size()) / Math.log(2));

    // 5. 置信度修正
    double finalConfidence = maxProb * (1 - 0.3 * normalizedEntropy);

    // 6. 判断是否达到阈值
    boolean reachedThreshold = finalConfidence >= confidenceThreshold;

    return ConfidenceResult.builder()
        .confidence(finalConfidence)
        .maxProbability(maxProb)
        .entropy(entropy)
        .normalizedEntropy(normalizedEntropy)
        .aiDeptProbabilities(aiDeptProbabilities)
        .topAiDeptId(topAiDeptId)
        .reachedThreshold(reachedThreshold)
        .threshold(confidenceThreshold)
        .build();
}
```

---

## 三、智能问题选择策略

### 3.1 信息增益算法（Information Gain）

**目标**：选择最能提高AI标准科室置信度的问题

```java
/**
 * 智能选择下一个问题
 */
private QuestionDTO selectNextQuestion(
    Map<Long, Double> aiDeptProbabilities,  // AI标准科室概率分布
    Set<String> askedQuestions
) {
    // 1. 获取所有候选问题
    List<TriageQuestion> candidates = questionRepository.findAllActive();

    // 2. 计算每个问题的信息增益
    double maxIG = -1.0;
    TriageQuestion bestQuestion = null;

    for (TriageQuestion question : candidates) {
        if (askedQuestions.contains(question.getQuestionCode())) {
            continue; // 跳过已问过的
        }

        // 计算该问题对AI标准科室的信息增益
        double ig = calculateInformationGain(question, aiDeptProbabilities);

        if (ig > maxIG) {
            maxIG = ig;
            bestQuestion = question;
        }
    }

    return convertToQuestionDTO(bestQuestion);
}
```

---

## 四、数据库设计

### 4.1 新增配置表
```sql
-- 分诊配置表（置信度阈值可配置）
CREATE TABLE t_triage_config (
    config_id BIGINT PRIMARY KEY IDENTITY(1,1),
    config_key VARCHAR(50) NOT NULL UNIQUE,
    config_value NVARCHAR(200) NOT NULL,
    config_desc NVARCHAR(500),
    value_type VARCHAR(20),  -- DECIMAL, INT, STRING
    create_time DATETIME DEFAULT GETDATE(),
    update_time DATETIME DEFAULT GETDATE()
);

-- 插入默认配置
INSERT INTO t_triage_config (config_key, config_value, config_desc, value_type) VALUES
('ai_dept_confidence_threshold', '0.8', 'AI标准科室置信度阈值', 'DECIMAL'),
('max_question_rounds', '8', '最大问答轮数', 'INT'),
('softmax_temperature', '1.5', 'Softmax温度参数', 'DECIMAL'),
('entropy_weight', '0.3', '信息熵权重系数', 'DECIMAL');
```

### 4.2 新增问题库表
```sql
-- 动态问题库表
CREATE TABLE t_triage_question (
    question_id BIGINT PRIMARY KEY IDENTITY(1,1),
    question_code VARCHAR(30) NOT NULL UNIQUE,  -- Q001, Q002
    question_content NVARCHAR(500) NOT NULL,
    question_type VARCHAR(30),  -- SYMPTOM, AGE, HISTORY, DURATION
    options NVARCHAR(MAX),  -- JSON: ["选项1","选项2"]
    is_multi_select TINYINT DEFAULT 0,
    priority_score INT DEFAULT 0,
    is_active TINYINT DEFAULT 1,
    create_time DATETIME DEFAULT GETDATE()
);

-- 问题-AI科室影响表
CREATE TABLE t_question_dept_impact (
    impact_id BIGINT PRIMARY KEY IDENTITY(1,1),
    question_code VARCHAR(30) NOT NULL,
    option_text NVARCHAR(200) NOT NULL,
    ai_dept_id BIGINT NOT NULL,  -- 影响的AI标准科室
    weight_adjustment DECIMAL(5,2),  -- 权重调整值
    is_positive TINYINT,  -- 1=增加 0=减少
    CONSTRAINT FK_question_ai_dept FOREIGN KEY (ai_dept_id)
        REFERENCES t_ophthal_standard_dept(dept_id)
);
```

### 4.3 会话记录表
```sql
-- 分诊会话记录表
CREATE TABLE t_triage_session_v3 (
    session_id VARCHAR(50) PRIMARY KEY,
    user_id BIGINT,
    round_number INT DEFAULT 1,
    current_confidence DECIMAL(3,2),  -- AI标准科室置信度
    current_threshold DECIMAL(3,2),   -- 当前使用的阈值
    top_ai_dept_id BIGINT,  -- 当前最优AI标准科室
    top_ai_dept_name NVARCHAR(100),
    qa_history NVARCHAR(MAX),  -- JSON: 问答历史
    status VARCHAR(20),  -- ongoing, threshold_reached, completed
    create_time DATETIME DEFAULT GETDATE(),
    update_time DATETIME DEFAULT GETDATE()
);
```

---

## 五、API接口设计

### 5.1 响应DTO定义
```java
@Data
public class OphthalConversationTriageV3ResponseDTO {

    /** 会话ID */
    private String sessionId;

    /** 状态：ongoing | threshold_reached | completed */
    private String status;

    /** AI标准科室置信度信息 ⭐ */
    private AiDeptConfidenceInfo confidenceInfo;

    /** 下一个问题（ongoing时） */
    private ConversationMessageDTO question;

    /** 最终推荐（threshold_reached/completed时） */
    private List<DeptRecommendation> recommendations;

    /** 当前轮数 */
    private Integer currentRound;

    /** 最大轮数 */
    private Integer maxRounds;

    /** 提示 */
    private String hint;
}

@Data
@Builder
public class AiDeptConfidenceInfo {
    /** AI标准科室置信度（0-1） */
    private Double confidence;

    /** 配置的阈值（默认0.8） */
    private Double threshold;

    /** 是否达到阈值 */
    private Boolean reachedThreshold;

    /** 当前最优AI标准科室 */
    private String topAiDeptName;

    /** Top3 AI标准科室预览 */
    private List<AiDeptPreview> topAiDepts;

    /** 信息熵（反映科室分布的不确定性） */
    private Double entropy;
}

@Data
@Builder
public class AiDeptPreview {
    private Long aiDeptId;
    private String aiDeptName;
    private Double probability;
    private Integer rank;
}
```

### 5.2 接口示例

#### 开始对话
```http
POST /ophthal-conversation-triage/v3/start
Authorization: Bearer {token}

Response:
{
  "code": 200,
  "data": {
    "sessionId": "abc123",
    "status": "ongoing",
    "question": {
      "content": "您好！请选择您的主要眼部症状（可多选）",
      "options": ["视力下降", "眼痛", "眼红", "眼干", ...]
    },
    "confidenceInfo": {
      "confidence": 0.0,
      "threshold": 0.8,
      "reachedThreshold": false,
      "topAiDeptName": null,
      "topAiDepts": []
    },
    "currentRound": 1,
    "maxRounds": 8
  }
}
```

#### 继续对话（未达到阈值）
```http
POST /ophthal-conversation-triage/v3/continue
Content-Type: application/json

Request:
{
  "sessionId": "abc123",
  "answer": "视力下降、眼干、异物感"
}

Response:
{
  "code": 200,
  "data": {
    "sessionId": "abc123",
    "status": "ongoing",
    "question": {
      "content": "症状从什么时候开始的？",
      "options": ["今天", "1-3天", "1周", "1个月以上"]
    },
    "confidenceInfo": {
      "confidence": 0.65,  // 未达到0.8
      "threshold": 0.8,
      "reachedThreshold": false,
      "topAiDeptName": "角膜病与眼表疾病科",
      "topAiDepts": [
        {"aiDeptName": "角膜病与眼表疾病科", "probability": 0.65, "rank": 1},
        {"aiDeptName": "白内障专科", "probability": 0.20, "rank": 2},
        {"aiDeptName": "眼底病科", "probability": 0.15, "rank": 3}
      ],
      "entropy": 0.89
    },
    "currentRound": 2,
    "maxRounds": 8,
    "hint": "继续收集信息以提高匹配准确度"
  }
}
```

#### 达到阈值
```http
Response:
{
  "code": 200,
  "data": {
    "sessionId": "abc123",
    "status": "threshold_reached",  // ⭐ 关键状态
    "confidenceInfo": {
      "confidence": 0.85,  // 已达到0.8
      "threshold": 0.8,
      "reachedThreshold": true,
      "topAiDeptName": "角膜病与眼表疾病科"
    },
    "recommendations": [
      {
        "aiDeptId": 3,
        "aiDeptName": "角膜病与眼表疾病科",
        "realDeptCode": "1141",
        "realDeptName": "干眼门诊(思北院区)",
        "campus": "思北",
        "isSpecialistClinic": true,
        "finalScore": 115.0,
        "matchPercentage": 96,
        "confidence": 0.85,
        "reason": "专病门诊，针对性强"
      },
      {
        "realDeptCode": "114",
        "realDeptName": "眼表及角膜病专科（思北）",
        "finalScore": 95.0,
        "matchPercentage": 79
      }
    ],
    "currentRound": 3,
    "maxRounds": 8,
    "hint": "已匹配到合适科室，可查看推荐结果"
  }
}
```

---

## 六、后端核心实现

### 6.1 文件结构
```
java/hospital-triage-backend/src/main/java/com/hospital/triage/
├── controller/
│   └── OphthalConversationTriageV3Controller.java  [新增]
├── service/
│   ├── OphthalConversationTriageV3Service.java  [新增接口]
│   └── impl/
│       └── OphthalConversationTriageV3ServiceImpl.java  [新增实现]
├── entity/
│   ├── TriageConfig.java  [新增]
│   ├── TriageQuestion.java  [新增]
│   ├── QuestionDeptImpact.java  [新增]
│   └── TriageSessionV3.java  [新增]
├── dto/
│   ├── OphthalConversationTriageV3ResponseDTO.java  [新增]
│   └── AiDeptConfidenceInfo.java  [新增]
└── mapper/
    ├── TriageConfigMapper.java  [新增]
    ├── TriageQuestionMapper.java  [新增]
    └── TriageSessionV3Mapper.java  [新增]
```

### 6.2 核心流程
```java
@Service
public class OphthalConversationTriageV3ServiceImpl
    implements OphthalConversationTriageV3Service {

    @Autowired
    private OphthalTriageService ophthalTriageServiceV2;  // 复用2.0

    @Autowired
    private TriageConfigMapper configMapper;

    @Override
    public OphthalConversationTriageV3ResponseDTO continueConversation(
        ConversationTriageRequestDTO requestDTO, Long userId
    ) {
        // 1. 获取会话
        TriageSessionV3 session = getSession(requestDTO.getSessionId());

        // 2. 记录回答
        session.addAnswer(requestDTO.getAnswer());

        // 3. 提取症状，计算AI标准科室得分（复用2.0）
        List<Long> symptomIds = extractSymptomIds(session.getAllAnswers());
        Map<Long, Double> aiDeptScores = ophthalTriageServiceV2.calculateAiDeptScore(
            symptomIds, buildTriageDTO(session)
        );

        // 4. 计算AI标准科室置信度 ⭐
        Double threshold = getConfidenceThreshold();  // 从配置读取，默认0.8
        ConfidenceResult confidence = calculateAiDeptConfidence(aiDeptScores, threshold);

        // 5. 更新会话
        session.setCurrentConfidence(confidence.getConfidence());
        session.setTopAiDeptId(confidence.getTopAiDeptId());
        session.incrementRound();

        // 6. 判断是否达到阈值 ⭐
        if (confidence.isReachedThreshold()) {
            // 达到阈值，映射到实际科室并返回推荐
            return generateRecommendations(session, aiDeptScores, confidence);
        }

        // 7. 判断是否达到最大轮数
        if (session.getRoundNumber() >= getMaxRounds()) {
            return generateRecommendations(session, aiDeptScores, confidence);
        }

        // 8. 智能选择下一个问题
        QuestionDTO nextQuestion = selectNextQuestion(
            confidence.getAiDeptProbabilities(),
            session.getAskedQuestions()
        );

        // 9. 保存会话
        saveSession(session);

        // 10. 返回继续对话
        return buildOngoingResponse(session, nextQuestion, confidence);
    }

    /**
     * 生成最终推荐（映射到实际科室）
     */
    private OphthalConversationTriageV3ResponseDTO generateRecommendations(
        TriageSessionV3 session,
        Map<Long, Double> aiDeptScores,
        ConfidenceResult confidence
    ) {
        // 映射到实际科室（复用2.0算法）
        List<DeptRecommendation> recommendations =
            ophthalTriageServiceV2.mapToRealDepartments(
                aiDeptScores,
                session.getPreferredCampus(),
                session.getAge(),
                session.getAllAnswersText()
            );

        // 保存分诊记录
        saveTriageRecord(session, recommendations, confidence);

        return OphthalConversationTriageV3ResponseDTO.builder()
            .sessionId(session.getSessionId())
            .status(confidence.isReachedThreshold() ? "threshold_reached" : "completed")
            .recommendations(recommendations)
            .confidenceInfo(buildConfidenceInfo(confidence))
            .currentRound(session.getRoundNumber())
            .maxRounds(getMaxRounds())
            .hint("已为您推荐合适的科室")
            .build();
    }

    /**
     * 从配置表读取置信度阈值
     */
    private Double getConfidenceThreshold() {
        TriageConfig config = configMapper.selectByKey("ai_dept_confidence_threshold");
        return config != null ? Double.parseDouble(config.getConfigValue()) : 0.8;
    }
}
```

---

## 七、前端实现

### 7.1 文件结构
```
uni/
├── pages/
│   └── conversation-triage-v3/
│       ├── conversation-triage-v3.vue  [新增]
│       └── components/
│           ├── confidence-meter.vue  [置信度展示组件]
│           └── ai-dept-preview.vue  [AI科室预览组件]
├── api/
│   └── index.js  [新增V3接口]
└── config/
    └── triage-config.js  [版本切换配置]
```

### 7.2 置信度展示组件
```vue
<!-- uni/pages/conversation-triage-v3/components/confidence-meter.vue -->
<template>
  <view class="confidence-card">
    <!-- 置信度进度条 -->
    <view class="confidence-header">
      <text class="title">AI匹配度</text>
      <text class="value" :style="{ color: confidenceColor }">
        {{ (confidenceInfo.confidence * 100).toFixed(0) }}%
      </text>
    </view>

    <view class="progress-bar">
      <view
        class="progress-fill"
        :style="{
          width: (confidenceInfo.confidence * 100) + '%',
          background: confidenceGradient
        }"
      />
      <!-- 阈值标记线 -->
      <view class="threshold-line" :style="{ left: (confidenceInfo.threshold * 100) + '%' }">
        <text class="threshold-label">目标{{ (confidenceInfo.threshold * 100) }}%</text>
      </view>
    </view>

    <!-- Top3 AI标准科室预览 -->
    <view class="ai-depts-preview" v-if="confidenceInfo.topAiDepts?.length">
      <text class="preview-title">可能科室：</text>
      <view class="dept-chips">
        <view
          v-for="dept in confidenceInfo.topAiDepts"
          :key="dept.aiDeptId"
          class="dept-chip"
          :class="{ 'is-top': dept.rank === 1 }"
        >
          <text class="dept-name">{{ dept.aiDeptName }}</text>
          <text class="dept-prob">{{ (dept.probability * 100).toFixed(0) }}%</text>
        </view>
      </view>
    </view>

    <!-- 达到阈值提示 -->
    <view class="threshold-reached-tip" v-if="confidenceInfo.reachedThreshold">
      <view class="tip-icon">✓</view>
      <text class="tip-text">已成功匹配到标准科室</text>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  confidenceInfo: Object
})

const confidenceColor = computed(() => {
  const c = props.confidenceInfo.confidence
  if (c >= props.confidenceInfo.threshold) return '#00C853'
  if (c >= 0.6) return '#FFC107'
  return '#FF6B6B'
})

const confidenceGradient = computed(() => {
  const c = props.confidenceInfo.confidence
  if (c >= props.confidenceInfo.threshold) {
    return 'linear-gradient(90deg, #00C853 0%, #69F0AE 100%)'
  }
  if (c >= 0.6) {
    return 'linear-gradient(90deg, #FFC107 0%, #FFD54F 100%)'
  }
  return 'linear-gradient(90deg, #FF6B6B 0%, #FF8A80 100%)'
})
</script>
```

---

## 八、后台管理界面设计（新增需求）

### 8.1 管理功能模块
```
后台管理系统
├── 配置管理
│   ├── 置信度阈值配置
│   ├── 最大轮数配置
│   └── 算法参数配置（Softmax温度、熵权重）
├── 问题库管理
│   ├── 问题列表（增删改查）
│   ├── 问题-科室影响配置
│   └── 问题优先级调整
└── 分诊数据统计
    ├── 3.0版本使用统计
    ├── 平均问答轮数分析
    └── AI科室匹配准确率
```

### 8.2 后台管理API接口
```java
// 配置管理
POST /admin/triage-config/update  // 更新配置
GET  /admin/triage-config/list    // 配置列表

// 问题库管理
GET    /admin/triage-question/list    // 问题列表
POST   /admin/triage-question/add     // 新增问题
PUT    /admin/triage-question/update  // 更新问题
DELETE /admin/triage-question/delete  // 删除问题
POST   /admin/triage-question/import  // 批量导入

// 科室影响管理
GET  /admin/question-dept-impact/list    // 影响列表
POST /admin/question-dept-impact/batch   // 批量配置

// 数据统计
GET /admin/triage-stats/overview         // 总览数据
GET /admin/triage-stats/round-analysis   // 轮数分析
GET /admin/triage-stats/accuracy         // 准确率统计
```

### 8.3 后台管理界面文件（需要实现）
```
uni/pages/admin/
├── triage-config/
│   └── triage-config.vue  [配置管理页面]
├── question-manage/
│   ├── question-list.vue  [问题列表]
│   ├── question-edit.vue  [问题编辑]
│   └── dept-impact-config.vue  [科室影响配置]
└── triage-stats/
    └── triage-stats.vue  [数据统计页面]
```

---

## 九、版本切换UI设计（新增需求）

### 9.1 前端版本选择入口
```vue
<!-- uni/pages/triage/triage.vue 或首页 -->
<view class="version-selector">
  <view class="version-tips">
    <text>请选择智能分诊版本</text>
  </view>
  <view class="version-cards">
    <!-- 2.0版本卡片 -->
    <view class="version-card" @tap="selectVersion('2.0')">
      <view class="version-badge">经典版</view>
      <text class="version-title">智能分诊 2.0</text>
      <text class="version-desc">固定8步问答，全面采集症状信息</text>
      <view class="version-features">
        <text>✓ 8个标准问题</text>
        <text>✓ 全面症状采集</text>
        <text>✓ 多科室推荐</text>
      </view>
    </view>

    <!-- 3.0版本卡片 -->
    <view class="version-card version-card-new" @tap="selectVersion('3.0')">
      <view class="version-badge version-badge-new">智能版 NEW</view>
      <text class="version-title">智能分诊 3.0</text>
      <text class="version-desc">AI动态问答，智能匹配科室</text>
      <view class="version-features">
        <text>✓ 3-5轮快速匹配</text>
        <text>✓ 实时置信度反馈</text>
        <text>✓ 精准科室推荐</text>
      </view>
    </view>
  </view>
</view>
```

### 9.2 版本选择逻辑
```javascript
// uni/utils/version-manager.js [新增]
export const VersionManager = {
  // 保存用户版本选择
  setVersion(version) {
    uni.setStorageSync('triage_version', version)
  },

  // 获取当前版本
  getVersion() {
    return uni.getStorageSync('triage_version') || '3.0' // 默认3.0
  },

  // 获取对应版本的API
  getTriageApi() {
    const version = this.getVersion()
    return version === '3.0'
      ? conversationTriageV3Api
      : conversationTriageApi
  },

  // 获取对应版本的页面路径
  getTriagePage() {
    const version = this.getVersion()
    return version === '3.0'
      ? '/pages/conversation-triage-v3/conversation-triage-v3'
      : '/pages/conversation-triage/conversation-triage'
  }
}
```

---

## 十、问题库数据迁移方案（新增需求）

### 10.1 从2.0迁移问题数据
```sql
-- 迁移脚本：v3.0_question_migration.sql
-- 将2.0固定的8个问题导入问题库

-- Q001: 主要眼部症状
INSERT INTO t_triage_question (question_code, question_content, question_type, options, is_multi_select, priority_score, is_active)
VALUES ('Q001', '请问您现在眼睛主要有什么不舒服？（可多选）', 'SYMPTOM',
'["视力下降、看不清","眼痛、眼胀","眼红、充血","眼干、异物感","飞蚊症、黑影","畏光、流泪","眼痒","眼睑肿胀","复视、重影","视物变形","其他"]',
1, 100, 1);

-- Q002: 症状开始时间
INSERT INTO t_triage_question (question_code, question_content, question_type, options, is_multi_select, priority_score, is_active)
VALUES ('Q002', '症状从什么时候开始的？', 'DURATION',
'["今天刚出现","1-3天内","3-7天","1周-1个月","1个月以上"]',
0, 90, 1);

-- Q003: 症状严重程度
INSERT INTO t_triage_question (question_code, question_content, question_type, options, is_multi_select, priority_score, is_active)
VALUES ('Q003', '您觉得症状严重程度如何？', 'SEVERITY',
'["轻微，不太影响生活","中等，有些影响生活","严重，明显影响生活","非常严重，无法正常生活"]',
0, 85, 1);

-- Q004: 眼病史/全身病史
INSERT INTO t_triage_question (question_code, question_content, question_type, options, is_multi_select, priority_score, is_active)
VALUES ('Q004', '您是否有以下病史？（可多选）', 'HISTORY',
'["高血压","糖尿病","既往眼部手术史","青光眼家族史","高度近视","无"]',
1, 80, 1);

-- Q005: 单眼还是双眼
INSERT INTO t_triage_question (question_code, question_content, question_type, options, is_multi_select, priority_score, is_active)
VALUES ('Q005', '症状出现在哪只眼睛？', 'LOCATION',
'["单眼","双眼"]',
0, 75, 1);

-- Q006: 伴随症状
INSERT INTO t_triage_question (question_code, question_content, question_type, options, is_multi_select, priority_score, is_active)
VALUES ('Q006', '是否伴有以下症状？（可多选）', 'SYMPTOM',
'["头痛","恶心呕吐","眼周疼痛","视野缺损","无"]',
1, 70, 1);

-- Q007: 年龄段
INSERT INTO t_triage_question (question_code, question_content, question_type, options, is_multi_select, priority_score, is_active)
VALUES ('Q007', '患者年龄段？', 'AGE',
'["儿童（0-12岁）","青少年（13-17岁）","青年（18-40岁）","中年（41-60岁）","老年（60岁以上）"]',
0, 95, 1);

-- Q008: 补充信息
INSERT INTO t_triage_question (question_code, question_content, question_type, options, is_multi_select, priority_score, is_active)
VALUES ('Q008', '是否需要补充其他信息？', 'SUPPLEMENT',
'["近期用眼过度","长期佩戴隐形眼镜","眼部外伤史","近期服用特殊药物","无需补充"]',
1, 60, 1);
```

### 10.2 问题-科室影响关系配置
```sql
-- 示例：Q001（主要症状）对AI标准科室的影响
-- 选择"视力下降、看不清" → 多个科室都可能
INSERT INTO t_question_dept_impact (question_code, option_text, ai_dept_id, weight_adjustment, is_positive) VALUES
('Q001', '视力下降、看不清', 1, 15.0, 1),  -- 白内障专科 +15
('Q001', '视力下降、看不清', 4, 12.0, 1),  -- 眼底病科 +12
('Q001', '视力下降、看不清', 8, 10.0, 1);  -- 屈光专科 +10

-- 选择"眼干、异物感" → 角膜病科
INSERT INTO t_question_dept_impact (question_code, option_text, ai_dept_id, weight_adjustment, is_positive) VALUES
('Q001', '眼干、异物感', 3, 25.0, 1);  -- 角膜病与眼表 +25

-- 选择"眼红、充血" → 急诊/角膜病
INSERT INTO t_question_dept_impact (question_code, option_text, ai_dept_id, weight_adjustment, is_positive) VALUES
('Q001', '眼红、充血', 3, 20.0, 1),  -- 角膜病 +20
('Q001', '眼红、充血', 6, 15.0, 1);  -- 青光眼科 +15

-- Q007（年龄）对科室的影响
INSERT INTO t_question_dept_impact (question_code, option_text, ai_dept_id, weight_adjustment, is_positive) VALUES
('Q007', '儿童（0-12岁）', 7, 20.0, 1),    -- 斜弱视与小儿眼科 +20
('Q007', '老年（60岁以上）', 1, 15.0, 1);  -- 白内障专科 +15

-- 更多影响关系根据实际业务逐步配置...
```

---

## 十一、实现步骤（更新）

### Phase 1: 数据库准备（1天）
1. 创建配置表 `t_triage_config`
2. 创建问题库表 `t_triage_question`
3. 创建问题-科室影响表 `t_question_dept_impact`
4. 创建会话表 `t_triage_session_v3`
5. 执行问题迁移脚本（从2.0迁移8个问题）⭐
6. 配置问题-科室影响关系（初始数据）⭐

**关键文件**：
- `java/hospital-triage-backend/src/main/resources/sql/v3.0_init.sql`
- `java/hospital-triage-backend/src/main/resources/sql/v3.0_question_migration.sql` [新增]

### Phase 2: 实体和Mapper层（0.5天）
1. 创建实体类：TriageConfig, TriageQuestion, QuestionDeptImpact, TriageSessionV3
2. 创建Mapper接口和XML

**关键文件**：
- `java/hospital-triage-backend/src/main/java/com/hospital/triage/entity/*.java`
- `java/hospital-triage-backend/src/main/java/com/hospital/triage/mapper/*.java`

### Phase 3: 核心算法实现（1天）
1. 实现Softmax置信度计算方法
2. 实现信息增益问题选择算法
3. 单元测试验证数学模型

**关键文件**：
- `java/hospital-triage-backend/src/main/java/com/hospital/triage/service/impl/OphthalConversationTriageV3ServiceImpl.java`

### Phase 4: 服务层实现（1天）
1. 实现continueConversation主流程
2. 集成2.0算法（复用calculateAiDeptScore和mapToRealDepartments）
3. 实现配置读取和会话管理

**关键文件**：
- `java/hospital-triage-backend/src/main/java/com/hospital/triage/service/impl/OphthalConversationTriageV3ServiceImpl.java`

### Phase 5: 控制器和DTO（0.5天）
1. 创建V3控制器
2. 定义响应DTO
3. Swagger文档

**关键文件**：
- `java/hospital-triage-backend/src/main/java/com/hospital/triage/controller/OphthalConversationTriageV3Controller.java`
- `java/hospital-triage-backend/src/main/java/com/hospital/triage/dto/OphthalConversationTriageV3ResponseDTO.java`

### Phase 6: 前端核心页面实现（1.5天）
1. 创建conversation-triage-v3.vue页面
2. 实现置信度展示组件（confidence-meter.vue）
3. 实现动态问答交互
4. 集成V3 API

**关键文件**：
- `uni/pages/conversation-triage-v3/conversation-triage-v3.vue`
- `uni/pages/conversation-triage-v3/components/confidence-meter.vue`
- `uni/api/index.js` [修改，新增V3接口]

### Phase 7: 版本切换UI实现（0.5天）⭐
1. 创建版本选择页面或组件
2. 实现版本管理工具类（VersionManager）
3. 修改分诊入口，支持版本切换
4. 测试版本切换逻辑

**关键文件**：
- `uni/pages/triage/triage.vue` [修改，添加版本选择]
- `uni/utils/version-manager.js` [新增]
- `uni/pages/version-selector/version-selector.vue` [可选，独立版本选择页]

### Phase 8: 后台管理界面实现（2-3天）⭐
**子任务1：配置管理（0.5天）**
1. 实现后端配置管理接口
2. 实现前端配置管理页面
3. 支持置信度阈值、最大轮数等参数调整

**子任务2：问题库管理（1天）**
1. 实现后端问题库CRUD接口
2. 实现前端问题列表、编辑页面
3. 支持问题的增删改查

**子任务3：科室影响配置（0.5天）**
1. 实现后端科室影响管理接口
2. 实现前端科室影响配置页面
3. 支持批量配置问题-科室影响关系

**子任务4：数据统计（0.5-1天）**
1. 实现后端统计接口（使用率、平均轮数、准确率）
2. 实现前端数据统计页面（图表展示）

**关键文件**：
- `java/hospital-triage-backend/src/main/java/com/hospital/triage/controller/admin/*` [新增控制器]
- `uni/pages/admin/triage-config/triage-config.vue` [新增]
- `uni/pages/admin/question-manage/question-list.vue` [新增]
- `uni/pages/admin/question-manage/question-edit.vue` [新增]
- `uni/pages/admin/question-manage/dept-impact-config.vue` [新增]
- `uni/pages/admin/triage-stats/triage-stats.vue` [新增]

### Phase 9: 测试和优化（1-2天）
1. 后端单元测试（算法验证）
2. 前后端联调（3.0核心功能）
3. 版本切换测试（2.0/3.0切换）
4. 后台管理功能测试
5. 性能测试和优化
6. 用户体验调优

---

## 十二、关键文件清单（完整版）

### 后端核心文件（需要新建/修改）

**数据库脚本**
1. `java/hospital-triage-backend/src/main/resources/sql/v3.0_init.sql` - 数据库初始化脚本
2. `java/hospital-triage-backend/src/main/resources/sql/v3.0_question_migration.sql` - 问题迁移脚本 ⭐

**实体类**
3. `java/hospital-triage-backend/src/main/java/com/hospital/triage/entity/TriageConfig.java`
4. `java/hospital-triage-backend/src/main/java/com/hospital/triage/entity/TriageQuestion.java`
5. `java/hospital-triage-backend/src/main/java/com/hospital/triage/entity/QuestionDeptImpact.java`
6. `java/hospital-triage-backend/src/main/java/com/hospital/triage/entity/TriageSessionV3.java`

**核心服务**
7. `java/hospital-triage-backend/src/main/java/com/hospital/triage/service/impl/OphthalConversationTriageV3ServiceImpl.java` - **核心算法实现**

**控制器**
8. `java/hospital-triage-backend/src/main/java/com/hospital/triage/controller/OphthalConversationTriageV3Controller.java` - V3分诊接口
9. `java/hospital-triage-backend/src/main/java/com/hospital/triage/controller/admin/TriageConfigController.java` - 配置管理接口 ⭐
10. `java/hospital-triage-backend/src/main/java/com/hospital/triage/controller/admin/TriageQuestionController.java` - 问题库管理接口 ⭐
11. `java/hospital-triage-backend/src/main/java/com/hospital/triage/controller/admin/QuestionDeptImpactController.java` - 影响配置接口 ⭐
12. `java/hospital-triage-backend/src/main/java/com/hospital/triage/controller/admin/TriageStatsController.java` - 数据统计接口 ⭐

**DTO**
13. `java/hospital-triage-backend/src/main/java/com/hospital/triage/dto/OphthalConversationTriageV3ResponseDTO.java`
14. `java/hospital-triage-backend/src/main/java/com/hospital/triage/dto/AiDeptConfidenceInfo.java`

**Mapper**
15. `java/hospital-triage-backend/src/main/java/com/hospital/triage/mapper/TriageConfigMapper.java`
16. `java/hospital-triage-backend/src/main/java/com/hospital/triage/mapper/TriageQuestionMapper.java`
17. `java/hospital-triage-backend/src/main/java/com/hospital/triage/mapper/QuestionDeptImpactMapper.java`

### 前端核心文件（需要新建/修改）

**3.0分诊页面**
1. `uni/pages/conversation-triage-v3/conversation-triage-v3.vue` - 主页面
2. `uni/pages/conversation-triage-v3/components/confidence-meter.vue` - 置信度组件

**版本切换** ⭐
3. `uni/utils/version-manager.js` - 版本管理工具类
4. `uni/pages/triage/triage.vue` - [修改] 添加版本选择入口
5. `uni/pages/version-selector/version-selector.vue` - [可选] 独立版本选择页

**后台管理界面** ⭐
6. `uni/pages/admin/triage-config/triage-config.vue` - 配置管理页面
7. `uni/pages/admin/question-manage/question-list.vue` - 问题列表页面
8. `uni/pages/admin/question-manage/question-edit.vue` - 问题编辑页面
9. `uni/pages/admin/question-manage/dept-impact-config.vue` - 科室影响配置页面
10. `uni/pages/admin/triage-stats/triage-stats.vue` - 数据统计页面

**API接口**
11. `uni/api/index.js` - [修改] 新增V3接口、后台管理接口

### 复用2.0文件（无需修改）
- `java/hospital-triage-backend/src/main/java/com/hospital/triage/service/impl/OphthalTriageServiceImpl.java` - 复用算法
- 数据库表：`t_ophthal_standard_dept`, `t_standard_symptom`, `t_ophthal_symptom_dept_relation`, `t_dept_mapping`

---

## 十、版本兼容性

### 并存策略
- 2.0路由：`/ophthal-conversation-triage/*`（保持不变）
- 3.0路由：`/ophthal-conversation-triage/v3/*`（新增）
- 前端可通过配置切换版本

### 数据共享
- 共用：AI标准科室表、症状表、权重表、映射表
- 隔离：会话表、配置表、问题库表

---

## 十一、配置管理（后台可调）

### 可配置项
| 配置Key | 默认值 | 说明 |
|---------|--------|------|
| ai_dept_confidence_threshold | 0.8 | AI标准科室置信度阈值 |
| max_question_rounds | 8 | 最大问答轮数 |
| softmax_temperature | 1.5 | Softmax温度参数 |
| entropy_weight | 0.3 | 信息熵权重系数 |

### 后台管理接口（可选）
```java
@RestController
@RequestMapping("/admin/triage-config")
public class TriageConfigController {

    @PutMapping("/update")
    public Result updateConfig(
        @RequestParam String configKey,
        @RequestParam String configValue
    ) {
        // 更新配置
        triageConfigService.updateConfig(configKey, configValue);
        return Result.success();
    }

    @GetMapping("/list")
    public Result listConfigs() {
        return Result.success(triageConfigService.getAllConfigs());
    }
}
```

---

## 十三、总结

### 核心改进
1. **两阶段匹配**：先匹配AI标准科室（置信度驱动），再映射实际科室
2. **置信度可配置**：默认0.8，后台可动态调整
3. **智能问答**：根据AI标准科室置信度决定是否继续提问
4. **数学严谨**：Softmax + 信息熵 + 信息增益算法
5. **版本并存**：2.0/3.0共存，用户可选择 ⭐
6. **后台管理**：完整的配置和问题库管理系统 ⭐

### 技术优势
- 复用2.0算法和数据，开发成本低
- 数学模型严谨，结果可解释
- 配置灵活，可持续优化
- 向下兼容，2.0/3.0并存
- 后台可视化管理，运营友好

### 预期效果
- 平均问答轮数：3-5轮（vs 2.0固定8轮）
- AI标准科室匹配准确率：>90%
- 实际科室推荐准确率：>85%
- 用户体验：实时反馈，透明可控
- 运营效率：配置调整无需改代码

### 预估工作量（按Phase）
| Phase | 工作内容 | 预估时间 | 优先级 |
|-------|---------|---------|--------|
| Phase 1 | 数据库准备 + 问题迁移 | 1天 | P0 |
| Phase 2 | 实体和Mapper层 | 0.5天 | P0 |
| Phase 3 | 核心算法实现 | 1天 | P0 |
| Phase 4 | 服务层实现 | 1天 | P0 |
| Phase 5 | 控制器和DTO | 0.5天 | P0 |
| Phase 6 | 前端核心页面 | 1.5天 | P0 |
| Phase 7 | 版本切换UI | 0.5天 | P1 |
| Phase 8 | 后台管理界面 | 2-3天 | P1 |
| Phase 9 | 测试和优化 | 1-2天 | P0 |
| **总计** | **核心功能（P0）** | **7-8天** | - |
| **总计** | **完整版（P0+P1）** | **10-12天** | - |

**说明**：
- **P0（核心功能）**：3.0动态问答核心功能，必须实现
- **P1（扩展功能）**：版本切换 + 后台管理，可分期实现

### 分期实施建议
**第一期（MVP）**：实现3.0核心功能（Phase 1-6 + Phase 9测试）
- 置信度驱动的动态问答
- 实时置信度展示
- 直接替换2.0（不做版本切换）
- **预估时间：7-8天**

**第二期（增强）**：添加版本切换和基础后台管理
- 2.0/3.0版本并存
- 基础配置管理（置信度阈值调整）
- **预估时间：+2-3天**

**第三期（完善）**：完整后台管理系统
- 问题库管理
- 科室影响配置
- 数据统计分析
- **预估时间：+2-3天**
