# 意图识别优化和对话式创建修复

## 问题描述

1. **意图识别错误**：用户输入"帮我做个logo"时，系统错误地识别为要创建项目，实际上用户只是想咨询/聊天
2. **创建流程体验不佳**：创建项目时弹出单独的Modal窗口，用户体验不够流畅

## 解决方案

### 1. 优化意图识别逻辑

**文件**：`src/renderer/pages/projects/ProjectsPage.vue`

**修改位置**：`handleConversationalCreate` 函数开始处

**新增逻辑**：
- 区分"聊天咨询"和"创建项目"两种意图
- 聊天咨询意图识别：
  - logo/标志/图标设计类
  - 纯设计类（不涉及网页/网站/页面）
  - 咨询类问题（什么是、如何、怎么、为什么等）
  - 明确的聊天意图（聊聊、咨询、问一下）

- 项目创建意图识别：
  - 创建项目/网页/网站/应用
  - 新建文件
  - 生成网页/文件

**代码示例**：
```javascript
// 检测是否是纯聊天/咨询意图
const isChatIntent =
  (textLower.includes('logo') || textLower.includes('标志')) ||
  (textLower.includes('设计') && !textLower.includes('网页')) ||
  textLower.includes('什么是') ||
  textLower.includes('如何') ||
  // ...更多规则

// 检测是否是明确的项目创建意图
const isProjectCreationIntent =
  textLower.includes('创建项目') ||
  textLower.includes('做个网站') ||
  // ...更多规则

// 如果是纯聊天意图且不是项目创建意图，则不创建项目
if (isChatIntent && !isProjectCreationIntent) {
  // 展示AI对话回复
  return;
}
```

### 2. 在AI对话框中展示创建过程

**文件**：`src/renderer/pages/projects/ProjectsPage.vue`

**主要修改**：

#### 2.1 新增对话消息区域（Template）

在对话输入框下方添加消息展示区域：
```vue
<div v-if="conversationMessages.length > 0" class="conversation-messages-area">
  <!-- 用户消息 -->
  <!-- AI消息 -->
  <!-- 进度消息 -->
  <!-- 成功消息 -->
  <!-- 错误消息 -->
</div>
```

#### 2.2 新增数据和方法（Script）

```javascript
// 对话消息列表
const conversationMessages = ref([]);

// 辅助方法
const formatTime = (timestamp) => { /* 格式化时间 */ };
const getStageColor = (stage) => { /* 获取阶段颜色 */ };
const clearConversation = () => { /* 清空对话 */ };
const addMessage = (type, content, options = {}) => { /* 添加消息 */ };
```

#### 2.3 修改创建流程

**不再显示Modal**：
```javascript
// 注释掉Modal显示
// showStreamProgress.value = true;

// 改为添加用户消息到对话
addMessage('user', text);
```

**修改进度回调**：
```javascript
const project = await projectStore.createProjectStream(projectData, (progressUpdate) => {
  // 将进度添加到对话消息中
  if (progressUpdate.type === 'progress') {
    addMessage('progress', progressUpdate.message, {
      stage: progressUpdate.stage,
      stageName: stageNames[progressUpdate.stage],
    });
  } else if (progressUpdate.type === 'complete') {
    addMessage('success', '项目创建成功！', {
      projectId: progressUpdate.result.projectId,
    });
  } else if (progressUpdate.type === 'error') {
    addMessage('error', '创建项目失败', {
      error: progressUpdate.error,
    });
  }
});
```

#### 2.4 新增样式（Style）

添加对话消息区域的完整样式：
```scss
.conversation-messages-area {
  max-width: 900px;
  margin: 0 auto 32px;
  padding: 20px;
  background: #F9FAFB;
  border-radius: 12px;

  .user-message { /* 用户消息样式 */ }
  .assistant-message { /* AI消息样式 */ }
  .progress-message { /* 进度消息样式 */ }
  .success-message { /* 成功消息样式 */ }
  .error-message { /* 错误消息样式 */ }
}
```

## 测试场景

### 场景1：聊天咨询（不创建项目）

**输入**：
- "帮我做个logo"
- "设计一个图标"
- "什么是响应式设计"

**预期结果**：
- 不创建项目
- 在对话框中显示AI回复
- 提供建议和引导

### 场景2：创建项目（显示进度）

**输入**：
- "创建一个网站"
- "做个HTML页面"
- "新建一个项目"

**预期结果**：
- 不弹出Modal窗口
- 在对话框中展示创建进度
- 显示各阶段进度（意图识别、引擎选择、生成规格、生成HTML/CSS/JS）
- 完成后显示"查看项目"按钮

## 用户体验提升

1. **更智能的意图识别**：减少误判，用户输入更自然
2. **对话式交互**：创建过程像聊天一样流畅
3. **实时进度反馈**：在对话框中看到每一步进展
4. **统一的交互界面**：不再有突兀的弹窗

## 后续优化建议

1. 集成真实的AI对话服务（目前是模拟回复）
2. 支持多轮对话（用户可以继续追问）
3. 添加对话历史记录
4. 支持编辑和重新发送消息
5. 添加打字机效果（流式显示AI回复）

## 技术栈

- Vue 3 Composition API
- Ant Design Vue 4.1
- SCSS (scoped)
- Reactive state management

## 文件清单

修改的文件：
1. `desktop-app-vue/src/renderer/pages/projects/ProjectsPage.vue`
   - 新增：意图识别逻辑
   - 新增：对话消息区域模板
   - 新增：对话辅助方法
   - 修改：创建流程不再显示Modal
   - 新增：对话消息样式

新增的文档：
1. `desktop-app-vue/INTENT_RECOGNITION_FIX.md` （本文档）

## 兼容性说明

- 不影响现有的模板创建功能
- 不影响快速创建功能
- Modal创建窗口保留但不再使用（可以后续删除）
- 完全向后兼容

## 总结

通过这次修改，我们实现了：
1. ✅ 更智能的意图识别，减少误判
2. ✅ 对话式的项目创建流程
3. ✅ 实时的进度反馈
4. ✅ 更好的用户体验

用户现在可以更自然地与系统交互，系统也能更准确地理解用户意图！
