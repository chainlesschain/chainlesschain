# 交互式任务规划系统使用指南

**版本**: v1.0
**日期**: 2026-01-05
**Claude Plan模式** - 提供更智能、更友好的任务规划体验

---

## 📋 目录

1. [概述](#概述)
2. [核心功能](#核心功能)
3. [使用流程](#使用流程)
4. [API接口](#api接口)
5. [前端集成示例](#前端集成示例)
6. [数据结构](#数据结构)
7. [最佳实践](#最佳实践)
8. [常见问题](#常见问题)

---

## 概述

交互式任务规划系统是对原有任务规划系统的重大升级，模仿Claude Code的Plan模式，提供以下核心改进：

### ✨ 主要特性

1. **📝 Plan先行**: 生成任务计划后先展示给用户，等待确认后再执行
2. **🎯 智能推荐**: 自动推荐相关模板、技能和工具
3. **⚙️ 灵活调整**: 支持用户调整参数、应用模板、重新生成
4. **📊 质量评估**: 执行完成后自动评估生成质量（A-F等级）
5. **💬 反馈机制**: 收集用户反馈，持续改进

### 🔄 交互流程

```
用户输入需求
    ↓
生成任务计划 + 推荐资源
    ↓
展示Plan等待用户确认
    ↓
用户选择：确认 | 调整 | 使用模板 | 重新生成 | 取消
    ↓
执行任务（实时进度反馈）
    ↓
质量评估 + 收集反馈
    ↓
完成
```

---

## 核心功能

### 1. 任务计划生成

**自动生成包含以下内容的计划：**

- **任务概述**: 标题、类型、预估时长、总步骤数
- **执行步骤**: 详细的子任务列表（tool、action、输出文件等）
- **最终输出**: 期望的交付物描述
- **可调整参数**: 支持用户自定义的参数

### 2. 智能推荐

#### 模板推荐

系统会根据用户需求自动推荐相关模板（最多3个），包括：
- 模板名称、分类、描述
- 相关度评分（0-1.0）
- 推荐理由

#### 技能推荐

推荐可用的技能（最多5个），包括：
- 技能名称、类别、描述
- 推荐评分
- 推荐理由

#### 工具推荐

列出任务所需的所有工具，包括：
- 工具名称、描述
- 功能说明
- 推荐理由

### 3. 用户交互

用户可以执行以下操作：

| 操作 | 说明 | 场景 |
|------|------|------|
| **确认** | 直接执行当前Plan | 对Plan满意 |
| **调整** | 修改参数（标题、详细程度等） | 需要微调 |
| **使用模板** | 应用推荐的模板重新生成 | 推荐的模板更合适 |
| **重新生成** | 基于反馈重新生成Plan | 对Plan不满意 |
| **取消** | 取消任务 | 不需要了 |

### 4. 质量评估

执行完成后，系统会自动评估质量（0-100分），评估维度：

1. **完成度** (30分): 子任务完成比例
2. **文件输出** (20分): 文件生成成功率
3. **执行时间** (15分): 是否在预估时间内完成
4. **错误率** (20分): 子任务失败比例
5. **资源使用** (15分): CPU、内存使用效率

**等级划分**:
- A级: 90-100分（优秀）
- B级: 80-89分（良好）
- C级: 70-79分（中等）
- D级: 60-69分（及格）
- F级: <60分（不及格）

### 5. 用户反馈

支持用户提交反馈，包括：
- **评分**: 1-5星
- **评论**: 文字描述
- **问题**: 遇到的具体问题（数组）
- **建议**: 改进建议（数组）

---

## 使用流程

### Step 1: 开始Plan会话

```javascript
// 前端调用
const response = await window.electron.invoke('interactive-planning:start-session', {
  userRequest: '写一份2024年度工作总结报告',
  projectContext: {
    projectId: 'proj-123',
    projectType: 'document',
    subType: 'word',
    projectName: '年度总结',
    projectPath: '/path/to/project'
  }
});

// 返回结果
{
  success: true,
  sessionId: 'session-abc-123',
  status: 'awaiting_confirmation',
  plan: {
    overview: {
      title: '2024年度工作总结报告',
      type: 'create',
      estimatedDuration: '10分钟',
      totalSteps: 3
    },
    steps: [...],
    finalOutput: {...},
    recommendations: {
      templates: [...],
      skills: [...],
      tools: [...]
    },
    adjustableParameters: [...]
  },
  message: '已生成任务计划，请确认或调整'
}
```

### Step 2: 展示Plan供用户查看

前端应该展示：
1. **任务概述**: 清晰显示标题、类型、预估时间
2. **执行步骤**: 列表形式展示每个子任务
3. **推荐资源**: 分组展示模板、技能、工具
4. **操作按钮**: 确认、调整、使用模板、重新生成、取消

### Step 3: 用户响应

#### 3a. 确认执行

```javascript
const response = await window.electron.invoke('interactive-planning:respond', {
  sessionId: 'session-abc-123',
  userResponse: {
    action: 'confirm'
  }
});

// 返回结果
{
  success: true,
  sessionId: 'session-abc-123',
  status: 'executing',
  message: '任务执行中...'
}
```

#### 3b. 调整参数

```javascript
const response = await window.electron.invoke('interactive-planning:respond', {
  sessionId: 'session-abc-123',
  userResponse: {
    action: 'adjust',
    adjustments: {
      title: '2024年度工作总结及2025年计划',
      detailLevel: 'detailed',  // brief | standard | detailed | comprehensive
      includeExamples: true
    }
  }
});

// 返回更新后的Plan
{
  success: true,
  sessionId: 'session-abc-123',
  status: 'awaiting_confirmation',
  plan: {...},  // 更新后的计划
  message: 'Plan已更新，请确认'
}
```

#### 3c. 应用模板

```javascript
const response = await window.electron.invoke('interactive-planning:respond', {
  sessionId: 'session-abc-123',
  userResponse: {
    action: 'use_template',
    selectedTemplate: 'template-456'  // 从推荐中选择的模板ID
  }
});

// 返回基于模板的新Plan
{
  success: true,
  sessionId: 'session-abc-123',
  status: 'awaiting_confirmation',
  plan: {...},  // 基于模板生成的计划
  message: '已应用模板"年度总结报告模板"，请确认'
}
```

#### 3d. 重新生成

```javascript
const response = await window.electron.invoke('interactive-planning:respond', {
  sessionId: 'session-abc-123',
  userResponse: {
    action: 'regenerate',
    feedback: '希望增加数据统计和图表部分'
  }
});

// 返回重新生成的Plan
{
  success: true,
  sessionId: 'session-abc-123',
  status: 'awaiting_confirmation',
  plan: {...},  // 重新生成的计划
  message: 'Plan已重新生成，请确认'
}
```

### Step 4: 监听执行进度

```javascript
// 监听进度事件
window.electron.on('interactive-planning:execution-progress', (data) => {
  const { sessionId, progress } = data;

  console.log('执行进度:', progress);
  // progress.type: 'subtask-started' | 'subtask-completed' | 'subtask-failed'
  // progress.step: 当前步骤
  // progress.total: 总步骤数
  // progress.subtask: 当前子任务信息
});

// 监听完成事件
window.electron.on('interactive-planning:execution-completed', (data) => {
  const { sessionId, result, qualityScore } = data;

  console.log('执行完成!');
  console.log('质量评分:', qualityScore);
  // qualityScore.percentage: 百分比分数
  // qualityScore.grade: A/B/C/D/F等级
  // qualityScore.breakdown: 各维度分数
});

// 监听失败事件
window.electron.on('interactive-planning:execution-failed', (data) => {
  const { sessionId, error } = data;

  console.error('执行失败:', error);
});
```

### Step 5: 提交用户反馈

```javascript
const response = await window.electron.invoke('interactive-planning:submit-feedback', {
  sessionId: 'session-abc-123',
  feedback: {
    rating: 5,  // 1-5星
    comment: '生成的报告质量很高，非常满意！',
    issues: [],  // 遇到的问题（如有）
    suggestions: ['希望能支持更多图表类型']  // 改进建议
  }
});

// 返回结果
{
  success: true,
  message: '感谢您的反馈'
}
```

---

## API接口

### IPC接口列表

| 接口 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `interactive-planning:start-session` | `{userRequest, projectContext}` | `{sessionId, status, plan}` | 开始Plan会话 |
| `interactive-planning:respond` | `{sessionId, userResponse}` | `{sessionId, status, plan?}` | 用户响应 |
| `interactive-planning:submit-feedback` | `{sessionId, feedback}` | `{success, message}` | 提交反馈 |
| `interactive-planning:get-session` | `{sessionId}` | `{success, session}` | 获取会话信息 |
| `interactive-planning:cleanup` | `{maxAge}` | `{success, cleanedCount}` | 清理过期会话 |

### 事件列表

| 事件 | 数据 | 说明 |
|------|------|------|
| `interactive-planning:plan-generated` | `{sessionId, planPresentation}` | Plan生成完成 |
| `interactive-planning:execution-started` | `{sessionId}` | 开始执行 |
| `interactive-planning:execution-progress` | `{sessionId, progress}` | 执行进度更新 |
| `interactive-planning:execution-completed` | `{sessionId, result, qualityScore}` | 执行完成 |
| `interactive-planning:execution-failed` | `{sessionId, error}` | 执行失败 |
| `interactive-planning:feedback-submitted` | `{sessionId, feedback}` | 反馈已提交 |

---

## 前端集成示例

### Vue组件示例

```vue
<template>
  <div class="interactive-planning">
    <!-- Step 1: 输入用户需求 -->
    <div v-if="step === 'input'" class="input-stage">
      <h2>创建项目</h2>
      <a-textarea
        v-model="userRequest"
        :rows="4"
        placeholder="请描述您的需求，例如：写一份2024年度工作总结报告"
      />
      <a-button type="primary" @click="startPlanning">生成计划</a-button>
    </div>

    <!-- Step 2: 展示Plan等待确认 -->
    <div v-if="step === 'plan'" class="plan-stage">
      <h2>任务计划</h2>

      <!-- 任务概述 -->
      <a-card title="概述">
        <p><strong>标题:</strong> {{ plan.overview.title }}</p>
        <p><strong>类型:</strong> {{ plan.overview.type }}</p>
        <p><strong>预估时长:</strong> {{ plan.overview.estimatedDuration }}</p>
        <p><strong>总步骤:</strong> {{ plan.overview.totalSteps }}</p>
      </a-card>

      <!-- 执行步骤 -->
      <a-card title="执行步骤" style="margin-top: 16px;">
        <a-steps :current="-1" direction="vertical">
          <a-step
            v-for="step in plan.steps"
            :key="step.step"
            :title="step.title"
            :description="step.description"
          />
        </a-steps>
      </a-card>

      <!-- 推荐资源 -->
      <a-tabs v-if="hasRecommendations" style="margin-top: 16px;">
        <!-- 推荐模板 -->
        <a-tab-pane key="templates" tab="推荐模板">
          <a-list
            :data-source="plan.recommendations.templates"
            :render-item="(template) => renderTemplate(template)"
          />
        </a-tab-pane>

        <!-- 推荐技能 -->
        <a-tab-pane key="skills" tab="推荐技能">
          <a-list
            :data-source="plan.recommendations.skills"
            :render-item="(skill) => renderSkill(skill)"
          />
        </a-tab-pane>

        <!-- 推荐工具 -->
        <a-tab-pane key="tools" tab="所需工具">
          <a-list
            :data-source="plan.recommendations.tools"
            :render-item="(tool) => renderTool(tool)"
          />
        </a-tab-pane>
      </a-tabs>

      <!-- 操作按钮 -->
      <div class="actions" style="margin-top: 24px;">
        <a-space>
          <a-button type="primary" @click="confirmPlan">确认执行</a-button>
          <a-button @click="showAdjustModal">调整参数</a-button>
          <a-button @click="regeneratePlan">重新生成</a-button>
          <a-button danger @click="cancelPlan">取消</a-button>
        </a-space>
      </div>
    </div>

    <!-- Step 3: 执行中 -->
    <div v-if="step === 'executing'" class="executing-stage">
      <h2>执行中...</h2>
      <a-progress :percent="progress" />
      <div class="current-task">
        <p>当前任务: {{ currentSubtask?.title }}</p>
      </div>
    </div>

    <!-- Step 4: 完成并展示结果 -->
    <div v-if="step === 'completed'" class="completed-stage">
      <a-result
        status="success"
        title="任务执行完成！"
        :sub-title="`质量评分: ${qualityScore.percentage}分 (${qualityScore.grade}级)`"
      >
        <template #extra>
          <a-button type="primary" @click="viewResult">查看结果</a-button>
          <a-button @click="showFeedbackModal">提交反馈</a-button>
        </template>
      </a-result>

      <!-- 质量评分详情 -->
      <a-card title="质量评估" style="margin-top: 16px;">
        <a-descriptions :column="2">
          <a-descriptions-item label="总分">
            {{ qualityScore.totalScore }} / {{ qualityScore.maxScore }}
          </a-descriptions-item>
          <a-descriptions-item label="等级">
            <a-tag :color="getGradeColor(qualityScore.grade)">
              {{ qualityScore.grade }}
            </a-tag>
          </a-descriptions-item>
        </a-descriptions>
      </a-card>
    </div>

    <!-- 调整参数弹窗 -->
    <a-modal
      v-model:visible="adjustModalVisible"
      title="调整参数"
      @ok="submitAdjustments"
    >
      <a-form :model="adjustments">
        <a-form-item label="文档标题">
          <a-input v-model:value="adjustments.title" />
        </a-form-item>
        <a-form-item label="详细程度">
          <a-select v-model:value="adjustments.detailLevel">
            <a-select-option value="brief">简要</a-select-option>
            <a-select-option value="standard">标准</a-select-option>
            <a-select-option value="detailed">详细</a-select-option>
            <a-select-option value="comprehensive">全面</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="包含示例">
          <a-switch v-model:checked="adjustments.includeExamples" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 反馈弹窗 -->
    <a-modal
      v-model:visible="feedbackModalVisible"
      title="提交反馈"
      @ok="submitFeedback"
    >
      <a-form :model="feedback">
        <a-form-item label="评分">
          <a-rate v-model:value="feedback.rating" />
        </a-form-item>
        <a-form-item label="评论">
          <a-textarea v-model:value="feedback.comment" :rows="4" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';

// 状态
const step = ref('input');  // input | plan | executing | completed | failed
const userRequest = ref('');
const sessionId = ref('');
const plan = ref(null);
const progress = ref(0);
const currentSubtask = ref(null);
const qualityScore = ref(null);

// 弹窗
const adjustModalVisible = ref(false);
const feedbackModalVisible = ref(false);

// 表单
const adjustments = ref({
  title: '',
  detailLevel: 'standard',
  includeExamples: true
});
const feedback = ref({
  rating: 5,
  comment: ''
});

// 计算属性
const hasRecommendations = computed(() => {
  return plan.value?.recommendations &&
    (plan.value.recommendations.templates.length > 0 ||
     plan.value.recommendations.skills.length > 0 ||
     plan.value.recommendations.tools.length > 0);
});

// 方法
const startPlanning = async () => {
  const response = await window.electron.invoke('interactive-planning:start-session', {
    userRequest: userRequest.value,
    projectContext: {
      projectType: 'document',
      // ... 其他上下文
    }
  });

  if (response.success) {
    sessionId.value = response.sessionId;
    plan.value = response.plan;
    step.value = 'plan';
  }
};

const confirmPlan = async () => {
  step.value = 'executing';

  const response = await window.electron.invoke('interactive-planning:respond', {
    sessionId: sessionId.value,
    userResponse: { action: 'confirm' }
  });
};

const showAdjustModal = () => {
  adjustments.value.title = plan.value.overview.title;
  adjustModalVisible.value = true;
};

const submitAdjustments = async () => {
  const response = await window.electron.invoke('interactive-planning:respond', {
    sessionId: sessionId.value,
    userResponse: {
      action: 'adjust',
      adjustments: adjustments.value
    }
  });

  if (response.success) {
    plan.value = response.plan;
    adjustModalVisible.value = false;
  }
};

const regeneratePlan = async () => {
  const response = await window.electron.invoke('interactive-planning:respond', {
    sessionId: sessionId.value,
    userResponse: {
      action: 'regenerate',
      feedback: '请生成更详细的计划'
    }
  });

  if (response.success) {
    plan.value = response.plan;
  }
};

const cancelPlan = async () => {
  await window.electron.invoke('interactive-planning:respond', {
    sessionId: sessionId.value,
    userResponse: { action: 'cancel' }
  });

  step.value = 'input';
};

const showFeedbackModal = () => {
  feedbackModalVisible.value = true;
};

const submitFeedback = async () => {
  await window.electron.invoke('interactive-planning:submit-feedback', {
    sessionId: sessionId.value,
    feedback: feedback.value
  });

  feedbackModalVisible.value = false;
};

const getGradeColor = (grade) => {
  const colors = { A: 'green', B: 'blue', C: 'orange', D: 'red', F: 'red' };
  return colors[grade] || 'default';
};

// 事件监听
window.electron.on('interactive-planning:execution-progress', (data) => {
  progress.value = Math.round((data.progress.step / data.progress.total) * 100);
  currentSubtask.value = data.progress.subtask;
});

window.electron.on('interactive-planning:execution-completed', (data) => {
  qualityScore.value = data.qualityScore;
  step.value = 'completed';
});

window.electron.on('interactive-planning:execution-failed', (data) => {
  step.value = 'failed';
});
</script>

<style scoped>
.interactive-planning {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.actions {
  display: flex;
  justify-content: center;
}
</style>
```

---

## 数据结构

### Plan结构

```typescript
interface Plan {
  overview: {
    title: string;
    type: string;
    estimatedDuration: string;
    totalSteps: number;
    description: string;
  };

  steps: Array<{
    step: number;
    title: string;
    description: string;
    tool: string;
    action: string;
    estimatedTokens: number;
    dependencies: number[];
    outputFiles: string[];
  }>;

  finalOutput: {
    type: string;
    description: string;
    files: string[];
  };

  recommendations: {
    templates: Array<{
      id: string;
      title: string;
      category: string;
      description: string;
      relevanceScore: number;
      reason: string;
    }>;

    skills: Array<{
      id: string;
      name: string;
      category: string;
      description: string;
      recommendationScore: number;
      reason: string;
    }>;

    tools: Array<{
      tool: string;
      name: string;
      description: string;
      capability: string;
      reason: string;
    }>;
  };

  adjustableParameters: Array<{
    key: string;
    label: string;
    currentValue: any;
    type: 'string' | 'select' | 'boolean' | 'number';
    options?: any[];
    editable: boolean;
  }>;
}
```

### QualityScore结构

```typescript
interface QualityScore {
  totalScore: number;     // 实际得分
  maxScore: number;       // 最高分
  percentage: number;     // 百分比 (0-100)
  grade: 'A' | 'B' | 'C' | 'D' | 'F';  // 等级
  breakdown: {
    completion: number;   // 完成度分数
    fileOutput: number;   // 文件输出分数
    executionTime: number;  // 执行时间分数
    errorRate: number;    // 错误率分数
    resourceUsage: number;  // 资源使用分数
  };
}
```

---

## 最佳实践

### 1. 用户体验优化

✅ **DO**:
- 清晰展示Plan的每个步骤
- 提供易懂的推荐理由
- 实时显示执行进度
- 完成后展示质量评分

❌ **DON'T**:
- 不要隐藏Plan的细节
- 不要在用户不知情的情况下执行
- 不要忽略用户反馈

### 2. 参数调整建议

- **标题**: 应简洁明确，不超过50个字符
- **详细程度**:
  - `brief`: 适用于快速原型
  - `standard`: 一般项目
  - `detailed`: 正式文档
  - `comprehensive`: 重要报告
- **包含示例**: 适用于教学、演示类文档

### 3. 模板使用建议

- 优先使用系统推荐的模板（相关度高）
- 应用模板后仍可调整参数
- 模板可作为起点，不必完全照搬

### 4. 质量改进建议

- 如果质量评分低于C级，建议：
  1. 检查是否有子任务失败
  2. 调整参数重新生成
  3. 使用更合适的模板
  4. 提供详细的用户反馈

---

## 常见问题

### Q1: 生成的Plan不满意怎么办？

A: 有三种方式：
1. **调整参数**: 修改标题、详细程度等
2. **应用模板**: 选择推荐的模板
3. **重新生成**: 提供反馈后重新生成

### Q2: 执行过程中可以取消吗？

A: 目前执行一旦开始就不能取消。建议在确认阶段仔细检查Plan。未来版本会支持中途取消。

### Q3: 质量评分是如何计算的？

A: 综合评估5个维度：
- 完成度 (30%)
- 文件输出 (20%)
- 执行时间 (15%)
- 错误率 (20%)
- 资源使用 (15%)

### Q4: 反馈会被如何使用？

A: 用户反馈会被保存到数据库，用于：
1. 改进LLM提示词
2. 优化推荐算法
3. 修复已知问题
4. 指导功能开发

### Q5: 会话会保留多久？

A: 完成/取消/失败的会话默认保留24小时，之后自动清理。可以手动调用清理接口。

---

## 总结

交互式任务规划系统提供了更智能、更友好的用户体验，主要优势：

1. ✅ **透明**: Plan先展示，用户心中有数
2. ✅ **灵活**: 支持调整、应用模板、重新生成
3. ✅ **智能**: 自动推荐模板、技能、工具
4. ✅ **可控**: 用户确认后才执行
5. ✅ **高质**: 自动评估质量，收集反馈

**开始使用吧！🚀**
